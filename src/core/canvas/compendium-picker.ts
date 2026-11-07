/**
 * Compendium picker (spec 1.1 §B.2, §B.2.1): the Source Step's ↑ choice. A search over World
 * docs and packs of the class's `PickerKind` (Person: Actor `npc`), with a side list of sources.
 * Pure: the adapter reads Foundry into a `PickerCatalog`, the UI renders `get()` and forwards keys.
 */
import type { Command } from '../commands/registry';
import type { ElementClassId } from '../elements/classes';
import type { SourcePick, SourceProvider } from './pipeline';

/** The Foundry documents a picker offers: a document name, optionally narrowed to a subtype. */
export interface PickerKind {
  documentName: 'Actor' | 'Scene';
  /** The subtype entries must have (Actor `npc`); undefined = every entry. */
  type?: string;
}

export interface PickerEntry {
  uuid: string;
  name: string;
  /** The document's subtype, if it has one. */
  type?: string;
  img?: string;
}

export interface PickerPack {
  /** `pack.collection`. */
  id: string;
  label: string;
  /** `metadata.flags.dsalang`, if set. */
  lang?: string;
  entries: PickerEntry[];
}

export interface PickerCatalog {
  /** What the class picks (Person: Actor `npc`, Creature: Actor `creature`). */
  kind: PickerKind;
  /** `game.i18n.lang`. */
  lang: string;
  /** Localised "World": the source label of World docs. */
  worldLabel: string;
  /** World docs of the kind's document name that are not Story Elements. */
  world: PickerEntry[];
  /** Packs of the kind's document name. */
  packs: PickerPack[];
}

export type PickerSourceId = 'all' | 'world' | (string & {});

/** A side-list entry; World and packs carry their label, All is localised by the UI. */
export interface PickerSource {
  id: PickerSourceId;
  label?: string;
  count: number;
}

export interface PickerRow {
  uuid: string;
  name: string;
  img?: string;
  /** `world` or the pack id. */
  source: PickerSourceId;
  /** Source label: the pack's, or the localised World. */
  label: string;
  /** A merged row (All, §B.2 #87): how many same-name entries it stands for ("×N"). */
  count?: number;
}

export interface PickerState {
  sources: PickerSource[];
  source: PickerSourceId;
  query: string;
  rows: PickerRow[];
  /** Index of the highlighted row. */
  active: number;
  /** The merged row's name while `rows` is its source list (§B.2 "Choosing a source"). */
  choosing?: string;
}

/** A pick: a Source Step pick, or a merged row's entries to choose from (`{ choose }`). */
export type PickerPick = SourcePick | { choose: string[] };

export interface CompendiumPicker {
  get(): PickerState;
  subscribe(run: (state: PickerState) => void): () => void;
  setQuery(query: string): void;
  setSource(id: PickerSourceId): void;
  /** ↑ (-1) / ↓ (+1), clamped to the results. */
  move(delta: number): void;
  /** Highlights a row (mouse). */
  activate(index: number): void;
  /**
   * Enter: row `uuid` (default: the active one) as a Source Step pick; a merged row turns the
   * results into its source list instead. Undefined = no such row.
   */
  pick(uuid?: string): PickerPick | undefined;
  /** Esc in the source list: back to the results. False = not in a source list. */
  back(): boolean;
}

export interface CompendiumProviderDeps {
  /** What a class picks; undefined = not for this class. */
  kind(cls: ElementClassId): PickerKind | undefined;
  /** Reads the World docs and packs of a kind (adapter). */
  catalog(kind: PickerKind): Promise<PickerCatalog>;
  /** Shows the picker window; resolves with the function that closes it. */
  open(picker: CompendiumPicker): Promise<() => void>;
}

/**
 * The Source Step's Compendium choice (`CreationPipelineDeps.sources.compendium`). While it is
 * open, the picker commands (`pickerCommands`) drive it: search, source, pick, cancel.
 */
export interface CompendiumSource extends SourceProvider {
  /** The open picker, once its window is up; undefined when none is open. */
  ready(): Promise<CompendiumPicker | undefined>;
  /**
   * Picks row `uuid` (default: the active one) and closes; a merged row opens its source list
   * (`{ choose }`) and stays open. `picked: false` = no such row.
   */
  choose(uuid?: string): Promise<{ picked: boolean } | { choose: string[] }>;
  /** Closes without a pick: back to the Source Step. */
  cancel(): Promise<void>;
}

interface PickerSession {
  picker: CompendiumPicker;
  finish(pick: SourcePick | undefined): void;
}

export function compendiumSource(deps: CompendiumProviderDeps): CompendiumSource {
  /** Resolves with the open session once its window is up (undefined = none). */
  let session: Promise<PickerSession | undefined> = Promise.resolve(undefined);
  const current = async () => {
    const open = await session;
    if (!open) throw new Error('Silk: the compendium picker is not open');
    return open;
  };

  return {
    unavailable: (cls) => (deps.kind(cls) ? undefined : 'SILK.Source.NotForClass'),
    pick({ class: cls, signal }) {
      const kind = deps.kind(cls);
      if (!kind || signal.aborted) return Promise.resolve(undefined);
      return new Promise<SourcePick | undefined>((resolve, reject) => {
        let done = false;
        let close: (() => void) | undefined;
        const finish = (pick: SourcePick | undefined) => {
          if (done) return;
          done = true;
          session = Promise.resolve(undefined);
          signal.removeEventListener('abort', onAbort);
          close?.();
          resolve(pick);
        };
        const onAbort = () => finish(undefined);
        signal.addEventListener('abort', onAbort, { once: true });
        const opening = (async () => {
          const picker = createCompendiumPicker(await deps.catalog(kind));
          if (done) return undefined;
          close = await deps.open(picker);
          if (done) {
            close();
            return undefined;
          }
          return { picker, finish };
        })();
        session = opening.catch(() => undefined);
        opening.catch((error: unknown) => {
          done = true;
          session = Promise.resolve(undefined);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
    ready: async () => (await session)?.picker,
    async choose(uuid) {
      const { picker, finish } = await current();
      const pick = picker.pick(uuid);
      if (!pick) return { picked: false };
      if ('choose' in pick) return pick;
      finish(pick);
      return { picked: true };
    },
    async cancel() {
      (await session)?.finish(undefined);
    },
  };
}

/** Picker commands (spec 1.1 §B.2, ADR 0003): the window's search bar, side list and rows. */
export function pickerCommands(source: CompendiumSource): Command[] {
  const picker = async () => {
    const open = await source.ready();
    if (!open) throw new Error('Silk: the compendium picker is not open');
    return open;
  };
  const command = <A>(name: string, run: (args: A) => Promise<unknown>): Command<A> => ({
    name,
    title: `SILK.Commands.${name}`,
    available: (ctx) => ctx.isGM,
    run,
  });
  return [
    command('picker.search', async ({ query }: { query: string }) =>
      (await picker()).setQuery(String(query ?? '')),
    ),
    command('picker.source', async ({ id }: { id: PickerSourceId }) =>
      (await picker()).setSource(id),
    ),
    command('picker.pick', ({ uuid }: { uuid?: string }) => source.choose(uuid)),
    command('picker.cancel', () => source.cancel()),
  ];
}

/** DSA5's rule (`hooks/sidebar.js`): a pack in another language is hidden; no flag = shown. */
const packShown = (pack: PickerPack, lang: string) => !pack.lang || pack.lang === lang;

const byName = (a: PickerRow, b: PickerRow) => a.name.localeCompare(b.name);

/** Same name for merging: case-insensitive, trimmed. */
const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * All's rows (§B.2 #87): same-name entries become one row with a count. Each merged row's
 * entries, World first then packs by label, are its source list, keyed by the row's uuid.
 */
function merge(world: PickerRow[], packs: PickerRow[][]) {
  const groups = new Map<string, PickerRow[]>();
  const byLabel = (a: PickerRow[], b: PickerRow[]) =>
    (a[0]?.label ?? '').localeCompare(b[0]?.label ?? '');
  for (const r of [world, ...[...packs].sort(byLabel)].flat()) {
    const key = nameKey(r.name);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const rows: PickerRow[] = [];
  const members = new Map<string, PickerRow[]>();
  for (const group of groups.values()) {
    const [first] = group as [PickerRow, ...PickerRow[]];
    if (group.length === 1) {
      rows.push(first);
      continue;
    }
    const img = group.find((r) => r.img)?.img;
    rows.push({ ...first, ...(img ? { img } : {}), count: group.length });
    members.set(first.uuid, group);
  }
  return { rows: rows.sort(byName), members };
}

function rowsOf(catalog: PickerCatalog) {
  const { type } = catalog.kind;
  const ofType = (entries: PickerEntry[]) =>
    type === undefined ? entries : entries.filter((e) => e.type === type);
  const row = (e: PickerEntry, source: PickerSourceId, label: string): PickerRow => ({
    uuid: e.uuid,
    name: e.name,
    ...(e.img ? { img: e.img } : {}),
    source,
    label,
  });
  const world = ofType(catalog.world).map((e) => row(e, 'world', catalog.worldLabel));
  const packs = catalog.packs
    .filter((p) => packShown(p, catalog.lang))
    .map((p) => ({ pack: p, rows: ofType(p.entries).map((e) => row(e, p.id, p.label)) }))
    .filter((p) => p.rows.length);
  const unmerged = [...world, ...packs.flatMap((p) => p.rows)].sort(byName);
  const sources: PickerSource[] = [
    { id: 'all', count: unmerged.length },
    { id: 'world', label: catalog.worldLabel, count: world.length },
    ...packs.map((p) => ({ id: p.pack.id, label: p.pack.label, count: p.rows.length })),
  ];
  return {
    unmerged,
    merged: merge(
      world,
      packs.map((p) => p.rows),
    ),
    sources,
  };
}

export function createCompendiumPicker(catalog: PickerCatalog): CompendiumPicker {
  const { unmerged, merged, sources } = rowsOf(catalog);
  let source: PickerSourceId = 'all';
  let query = '';
  let active = 0;
  /** The merged row whose source list is shown, and the results' active index to return to. */
  let choosing: { row: PickerRow; back: number } | undefined;
  let state = compute();
  const subscribers = new Set<(state: PickerState) => void>();

  function compute(): PickerState {
    if (choosing) {
      const rows = merged.members.get(choosing.row.uuid) ?? [];
      return { sources, source, query, rows, active, choosing: choosing.row.name };
    }
    const q = query.trim().toLowerCase();
    const rows = (source === 'all' ? merged.rows : unmerged).filter(
      (r) => (source === 'all' || r.source === source) && (!q || r.name.toLowerCase().includes(q)),
    );
    return { sources, source, query, rows, active };
  }

  function update() {
    state = compute();
    for (const s of subscribers) s(state);
  }

  const clamp = (index: number) => Math.max(0, Math.min(index, state.rows.length - 1));

  return {
    get: () => state,
    subscribe(run) {
      subscribers.add(run);
      run(state);
      return () => subscribers.delete(run);
    },
    setQuery(next) {
      query = next;
      choosing = undefined;
      active = 0;
      update();
    },
    setSource(id) {
      source = id;
      choosing = undefined;
      active = 0;
      update();
    },
    move(delta) {
      active = clamp(active + delta);
      update();
    },
    activate(index) {
      active = clamp(index);
      update();
    },
    pick(uuid) {
      const index = uuid === undefined ? active : state.rows.findIndex((r) => r.uuid === uuid);
      const row = state.rows[index];
      if (!row) return undefined;
      if (row.count && !choosing) {
        choosing = { row, back: index };
        active = 0;
        update();
        return { choose: state.rows.map((r) => r.uuid) };
      }
      if (row.source === 'world') return { adopt: { uuid: row.uuid }, name: row.name };
      return {
        source: { kind: 'compendium', uuid: row.uuid },
        name: row.name,
        ...(row.img ? { img: row.img } : {}),
      };
    },
    back() {
      if (!choosing) return false;
      active = choosing.back;
      choosing = undefined;
      update();
      return true;
    },
  };
}
