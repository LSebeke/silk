/**
 * What Event Scenes need from Foundry Scenes (spec §4 Event Scenes, §7 present at ↔ tokens),
 * as plain data. The adapter implements it with real Scenes (`src/adapter/scenes.ts`),
 * tests with `createMemoryScenes`. Decisions live in the core; the port only executes them.
 */

/** `flags.silk` on a Silk Scene. */
export interface SilkSceneFlags {
  /** The Event (or Location, Overview Scene) owning the Scene. */
  sceneOf?: string;
  /** Set on the first activation: Happened is set once, then the GM may undo it (§7). */
  activated?: boolean;
}

export interface TokenData {
  _id: string;
  /** World Actor id. */
  actorId: string | null;
  x: number;
  y: number;
  hidden: boolean;
  [key: string]: unknown;
}

/** Scene source data. Walls, drawings etc. are kept as Foundry has them. */
export interface SceneData {
  _id: string;
  name: string;
  folder?: string | null;
  flags: { silk?: SilkSceneFlags; [scope: string]: unknown };
  tokens?: TokenData[];
  walls?: object[];
  drawings?: object[];
  [key: string]: unknown;
}

export interface SceneSnapshot extends SceneData {
  tokens: TokenData[];
  active: boolean;
}

export interface NewToken {
  actorId: string;
  x: number;
  y: number;
  hidden: boolean;
}

export interface SceneDocs {
  /** Id of Silk's Scene folder, created if missing. */
  ensureFolder(name: string): Promise<string>;
  scenes(): SceneSnapshot[];
  get(id: string): SceneSnapshot | undefined;
  /** Creates with the given `_id`s (Scene and embedded). Returns the Scene id. */
  create(data: SceneData): Promise<string>;
  delete(id: string): Promise<void>;
  /** Foundry update data; dotted keys allowed. */
  update(id: string, data: Record<string, unknown>): Promise<void>;
  /** Activates the Scene (Silk's write: Silk's own hooks skip it). */
  activate(id: string): Promise<void>;
  /** Views the Scene on this client (GM). */
  view(id: string): Promise<void>;
  /** Tokens from the actors' prototype tokens. */
  createTokens(sceneId: string, tokens: NewToken[]): Promise<void>;
  deleteTokens(sceneId: string, ids: string[]): Promise<void>;
  /**
   * Makes an embedded collection (`tokens`, `walls`, `lights`, …) match: creates (with the
   * given `_id`s), updates, deletes, as Silk's write (merge result, spec §11.4).
   */
  syncEmbedded(sceneId: string, collection: string, ops: EmbeddedOps): Promise<void>;
}

export interface EmbeddedOps {
  create: { _id: string; [key: string]: unknown }[];
  update: { _id: string; [key: string]: unknown }[];
  delete: string[];
}
