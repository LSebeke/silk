/**
 * Scene Presets (spec §4 Event Scenes): Silk generates the Scene config, the GM draws
 * walls and places the map by hand. The Preset is stored on the Scene (`flags.silk.preset`,
 * 1.1 §I); tokens go into the Token Box (`token-box.ts`). Pure.
 */
import type { SceneData } from './port';

export const SCENE_PRESETS = ['travel', 'battle', 'narrative', 'overview'] as const;
export type ScenePreset = (typeof SCENE_PRESETS)[number];
/** `flags.silk.preset`: imported and Adopted Scenes have none (1.1 §I). */
export type StoredPreset = ScenePreset | 'none';
/** The stored Preset of imported and Adopted Scenes. */
export const NO_PRESET: StoredPreset = 'none';
export const DEFAULT_PRESET: ScenePreset = 'narrative';

export const isPreset = (value: unknown): value is ScenePreset =>
  SCENE_PRESETS.includes(value as ScenePreset);

/** Foundry `CONST.GRID_TYPES` / `CONST.FOG_EXPLORATION_MODES` values. */
const GRID = { gridless: 0, square: 1, hexOddR: 2 } as const;
const FOG = { disabled: 0, individual: 1 } as const;

/** Preset Scene size and grid; also Foundry's `Scene` field defaults. */
export const GRID_SIZE = 100;
export const WIDTH = 4000;
export const HEIGHT = 3000;
export interface PresetInput {
  id: string;
  name: string;
  elementId: string;
  folder: string | null;
  /** Mood image (Narrative) or map (Overview): the element image. */
  img?: string | undefined;
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
    flags: { silk: { sceneOf: input.elementId, preset } },
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
    case 'narrative':
      return {
        ...base,
        ...background,
        grid: { type: GRID.gridless, size: GRID_SIZE },
        ...vision(false),
      };
  }
}
