/**
 * The look's flags (v1.1 §C.2, §G.3, §G.3.1): the exceptions to v1 §2 "`flags.silk` holds
 * ids only" that the Portrait owns. Types only; `SilkDocFlags` (materialize/port) extends it.
 */
import type { Edges, Order, Pose } from './geometry';
import type { Ring } from './portrait';

/**
 * Subject file (glossary): the file Silk wrote to `ring.subject.texture` and what it was
 * rendered from: image, pose, draw order and the ring style's edges (a changed style
 * rebuilds it). Files from before the draw order have none: Ring in front.
 */
export interface SubjectFlag {
  file: string;
  src: string;
  pose: Pose;
  order?: Order;
  edges: Edges;
}

/** A token's `texture`, as far as the Portrait uses it (other keys kept as they are). */
export interface TokenTexture {
  src?: string | null;
  anchorX?: number;
  anchorY?: number;
  scaleX?: number;
  scaleY?: number;
  fit?: string;
  [key: string]: unknown;
}

/** A token's `ring`, as far as the Portrait uses it. */
export interface TokenRing {
  enabled?: boolean;
  colors?: { ring?: string | null; background?: string | null };
  subject?: { scale?: number; texture?: string | null };
  [key: string]: unknown;
}

/** Original look (glossary): an imported actor's look as it came in (v1.1 §G.3.1). */
export interface OriginalLook {
  img?: string;
  texture: TokenTexture;
  ring: TokenRing;
}

/**
 * What showing the hood overwrites on one token (prototype or placed), to put back exactly.
 * `src` and `ring` only for a placed token's own; the actor's wait in `flags.silk.token` and
 * `flags.silk.ring`.
 */
export interface HoodSnapshot {
  texture: { src?: string | null; fit: string; anchorX: number; anchorY: number };
  subject: { scale: number; texture: string | null };
  ring?: Ring;
}

/**
 * Unhooded (glossary) on the actor: what the hood overwrote on the prototype, and Silk's
 * flags it replaced. Dropped by a token edit while hooded (the real look is then Silk's).
 */
export interface Unhooded extends HoodSnapshot {
  pose?: Pose;
  silkSubject?: SubjectFlag;
}

export interface LookFlags {
  /**
   * Person/Creature until Appearance is Revealed (§8): `img` and the prototype token show
   * `hood`; the real image and token texture wait here.
   */
  img?: string;
  token?: string;
  hood?: string;
  /** The real ring (on/off, colours) while hooded (#182): the hood always shows the ring. */
  ring?: Ring;
  /**
   * The real token position and scale (v1.1 §G.3), when not centred; the token itself shows
   * the hood centred, or the pose baked into the subject file.
   */
  pose?: Pose;
  /** Draw order (v1.1 §G.3, #170): only `illustration` is kept; absent: Ring in front. */
  order?: Order;
  subject?: SubjectFlag;
  /** Adopt, Compendium pick, NSC Zucht (a fifth exception to v1 §2). */
  original?: OriginalLook;
  /** An eighth exception to v1 §2. */
  unhooded?: Unhooded;
}

/** `flags.silk` on a placed token: its own Unhooded snapshot while the hood shows. */
export interface PlacedTokenFlags {
  unhooded?: HoodSnapshot;
}
