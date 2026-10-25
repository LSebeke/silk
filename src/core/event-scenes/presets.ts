/**
 * Scene Presets (spec §4 Event Scenes): Silk generates the Scene config, the GM draws
 * walls and places the map by hand. Token placement for **present at** (§5): hidden, in the
 * box for Narrative, stacked at an edge otherwise. Pure.
 */
import type { SceneData } from './port';

export const SCENE_PRESETS = ['travel', 'battle', 'narrative', 'overview'] as const;
export type ScenePreset = (typeof SCENE_PRESETS)[number];
export const DEFAULT_PRESET: ScenePreset = 'narrative';

export const isPreset = (value: unknown): value is ScenePreset =>
  SCENE_PRESETS.includes(value as ScenePreset);

/** Foundry `CONST.GRID_TYPES` / `CONST.FOG_EXPLORATION_MODES` values. */
const GRID = { gridless: 0, square: 1, hexOddR: 2 } as const;
const FOG = { disabled: 0, individual: 1 } as const;

export const GRID_SIZE = 100;
const WIDTH = 4000;
const HEIGHT = 3000;
/** Narrative: the box holding the present actors' tokens (top left). */
export const BOX = { x: 100, y: 100, width: 1000, height: 400, pad: 50 } as const;

export interface PresetInput {
  id: string;
  name: string;
  elementId: string;
  folder: string | null;
  /** Mood image (Narrative) or map (Overview): the element image. */
  img?: string | undefined;
  /** Drawing id for the Narrative box. */
  boxId: string;
  /** Label on the Narrative box. */
  boxLabel: string;
}

export function presetScene(preset: ScenePreset, input: PresetInput): SceneData {
  const base: SceneData = {
    _id: input.id,
    name: input.name,
    folder: input.folder,
    navigation: false,
    width: WIDTH,
    height: HEIGHT,
    ownership: { default: 0 },
    flags: { silk: { sceneOf: input.elementId } },
  };
  const background = input.img ? { background: { src: input.img } } : {};
  const vision = (on: boolean) => ({
    tokenVision: on,
    fog: { mode: on ? FOG.individual : FOG.disabled },
  });
  switch (preset) {
    case 'travel':
      return { ...base, grid: { type: GRID.hexOddR, size: GRID_SIZE }, ...vision(false) };
    case 'battle':
      return { ...base, grid: { type: GRID.square, size: GRID_SIZE }, ...vision(true) };
    case 'overview':
      return {
        ...base,
        ...background,
        grid: { type: GRID.gridless, size: GRID_SIZE },
        ...vision(false),
      };
    case 'narrative':
      return {
        ...base,
        ...background,
        grid: { type: GRID.gridless, size: GRID_SIZE },
        ...vision(false),
        drawings: [
          {
            _id: input.boxId,
            x: BOX.x,
            y: BOX.y,
            shape: { type: 'r', width: BOX.width, height: BOX.height },
            text: input.boxLabel,
            fontSize: 32,
            textColor: '#ffffff',
            strokeWidth: 4,
            strokeColor: '#ffffff',
            fillType: 1,
            fillColor: '#000000',
            fillAlpha: 0.4,
            locked: true,
            flags: { silk: { box: true } },
          },
        ],
      };
  }
}

/** The Preset a Scene was made from, read off its config (for placing tokens). */
export function presetOf(scene: SceneData): ScenePreset {
  const drawings = (scene.drawings ?? []) as { flags?: { silk?: { box?: boolean } } }[];
  if (drawings.some((d) => d.flags?.silk?.box)) return 'narrative';
  const grid = (scene.grid as { type?: number } | undefined)?.type;
  if (grid === GRID.square) return 'battle';
  if (grid !== undefined && grid >= GRID.hexOddR) return 'travel';
  return 'overview';
}

/** Where the `index`-th placed token goes: a grid in the box, or a column at the left edge. */
export function tokenSlot(preset: ScenePreset, index: number): { x: number; y: number } {
  if (preset === 'narrative') {
    const cols = Math.floor((BOX.width - 2 * BOX.pad) / GRID_SIZE);
    const rows = Math.floor((BOX.height - 2 * BOX.pad) / GRID_SIZE);
    const i = index % (cols * rows);
    return {
      x: BOX.x + BOX.pad + (i % cols) * GRID_SIZE,
      y: BOX.y + BOX.pad + Math.floor(i / cols) * GRID_SIZE,
    };
  }
  return { x: 0, y: (index % Math.floor(HEIGHT / GRID_SIZE)) * GRID_SIZE };
}
