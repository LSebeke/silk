/**
 * Focus View (spec §10.6): the N-hop Canvas Filter seeded by the active Scene, its tokens'
 * elements and the current selection, plus Focus Pins (always shown, not seeds) and the
 * camera rules. Focus View is on while the `hops` dimension holds `FOCUS_SEEDS`.
 */
import type { Snapshot } from '../canon';
import type { Command } from '../commands/registry';
import { readElement } from '../elements/element';
import type { WorkingCopy } from '../working-copy';
import type { CanvasState } from './canvas-state';
import { DEFAULT_HOPS } from './filters';
import type { Rect } from './groups';
import type { ViewState, ViewStateStore } from './view-state';

/** `hops` dimension value standing for the live Focus View seeds. */
export const FOCUS_SEEDS = 'focus';

/** The Foundry Scene that is active, as plain data (adapter). */
export interface ActiveScene {
  id: string;
  /** Element linked to the Scene (`flags.silk.sceneOf`, Event Scenes). */
  sceneOf?: string | undefined;
  /** World Actor ids of its tokens. */
  actorIds: readonly (string | null)[];
}

/** The active Scene's element and the elements Materialized as its tokens' Actors. */
export function sceneSeeds(records: Snapshot, scene: ActiveScene | undefined): string[] {
  if (!scene) return [];
  const actors = new Set(scene.actorIds.flatMap((id) => (id ? [`Actor.${id}`] : [])));
  const seeds: string[] = [];
  for (const record of records.values()) {
    const element = readElement(record);
    if (!element) continue;
    if (element.id === scene.sceneOf || (element.uuid && actors.has(element.uuid)))
      seeds.push(element.id);
  }
  return seeds;
}

export interface Focus {
  /** Scene seeds ∪ selection (element ids). */
  seeds(): string[];
  /** N of the N-hop filter. */
  hops(): number;
  pins(): readonly string[];
  setHops(n: number): Promise<void>;
  pin(ids: readonly string[]): Promise<void>;
  unpin(ids: readonly string[]): Promise<void>;
  /** The active Scene or its tokens may have changed (adapter hooks). */
  sceneChanged(): void;
  /** After every change, with why (camera rules). */
  subscribe(run: (reason: CameraReason) => void): () => void;
}

export interface FocusDeps {
  workingCopy(): WorkingCopy;
  viewState: ViewStateStore;
  /** Selection = temporary seeds. */
  state: CanvasState;
  activeScene(): ActiveScene | undefined;
}

export function createFocus(deps: FocusDeps): Focus {
  const subscribers = new Set<(reason: CameraReason) => void>();
  const emit = (reason: CameraReason) => {
    for (const s of subscribers) s(reason);
  };
  /** Last seen active Scene; `null` = not read yet (Foundry may not be ready on creation). */
  let sceneId: string | undefined | null = null;
  const scene = () => {
    const active = deps.activeScene();
    if (sceneId === null) sceneId = active?.id;
    return active;
  };
  let selection = deps.state.get().selection;
  deps.state.subscribe(({ selection: next }) => {
    if (next === selection) return;
    selection = next;
    emit('local');
  });

  /** Unsaved changes: the canvas follows at once, not after the setting round trip. */
  let pending: Pick<ViewState, 'pins' | 'hops'> = {};
  let saving = 0;
  const view = () => ({ ...deps.viewState.get(), ...pending });
  async function save(patch: Pick<ViewState, 'pins' | 'hops'>) {
    pending = { ...pending, ...patch };
    saving++;
    emit('local');
    try {
      await deps.viewState.update(patch);
    } finally {
      if (--saving === 0) pending = {};
    }
  }

  return {
    seeds() {
      let records;
      try {
        records = deps.workingCopy().records();
      } catch {
        return [...selection];
      }
      return [...new Set([...sceneSeeds(records, scene()), ...selection])];
    },
    hops: () => view().hops ?? DEFAULT_HOPS,
    pins: () => view().pins ?? [],
    async setHops(n) {
      if (!Number.isInteger(n) || n < 0) throw new Error(`Silk: bad Focus View hops "${n}"`);
      await save({ hops: n });
    },
    async pin(ids) {
      await save({ pins: [...new Set([...(view().pins ?? []), ...ids])] });
    },
    async unpin(ids) {
      const drop = new Set(ids);
      await save({ pins: (view().pins ?? []).filter((id) => !drop.has(id)) });
    },
    sceneChanged() {
      const first = sceneId === null;
      const next = scene()?.id;
      const changed = !first && next !== sceneId;
      sceneId = next;
      emit(changed ? 'scene' : 'local');
    },
    subscribe(run) {
      subscribers.add(run);
      return () => subscribers.delete(run);
    },
  };
}

export function focusCommands(focus: Focus): Command[] {
  const setHops: Command<{ n: number }, void> = {
    name: 'focus.setHops',
    title: 'SILK.Commands.focus.setHops',
    available: (ctx) => ctx.isGM,
    run: ({ n }) => focus.setHops(n),
  };
  const pin: Command<{ ids: string[] }, void> = {
    name: 'focus.pin',
    title: 'SILK.Commands.focus.pin',
    available: (ctx) => ctx.isGM,
    run: ({ ids }) => focus.pin(ids ?? []),
  };
  const unpin: Command<{ ids: string[] }, void> = {
    name: 'focus.unpin',
    title: 'SILK.Commands.focus.unpin',
    available: (ctx) => ctx.isGM,
    run: ({ ids }) => focus.unpin(ids ?? []),
  };
  return [setHops, pin, unpin];
}

/** Why the focus changed: a Scene change (or Focus View turned on) vs. everything else. */
export type CameraReason = 'scene' | 'local';

export interface CameraInput {
  reason: CameraReason;
  /** Shift is down: the camera holds and the move is dropped. */
  shift: boolean;
  /** Shown element ids now. */
  visible: readonly string[];
  /** Shown now, not before. */
  added: readonly string[];
  selection: readonly string[];
  viewport: { x: number; y: number; zoom: number };
  /** Canvas size in screen pixels. */
  size: { width: number; height: number };
  /** Node box in flow coordinates. */
  rect(id: string): Rect | undefined;
}

/** `fitView` over `ids`; `maxZoom` keeps it from zooming in. */
export interface CameraMove {
  ids: string[];
  maxZoom?: number;
}

/**
 * Camera rules (§10.6): Nodes stay at Canon positions, only the camera moves. A Scene change
 * fits the new focus; any other change pans only if newly shown Nodes are offscreen, and
 * never zooms in. Nothing moves while Shift is down.
 */
export function cameraMove(input: CameraInput): CameraMove | undefined {
  if (input.shift) return undefined;
  if (input.reason === 'scene')
    return input.visible.length ? { ids: [...input.visible] } : undefined;
  const { x, y, zoom } = input.viewport;
  const offscreen = (id: string) => {
    const r = input.rect(id);
    if (!r) return false;
    const sx = r.x * zoom + x;
    const sy = r.y * zoom + y;
    return (
      sx < 0 ||
      sy < 0 ||
      sx + r.width * zoom > input.size.width ||
      sy + r.height * zoom > input.size.height
    );
  };
  if (!input.added.some(offscreen)) return undefined;
  const shown = new Set(input.visible);
  const ids = [...new Set([...input.added, ...input.selection.filter((id) => shown.has(id))])];
  return { ids, maxZoom: zoom };
}
