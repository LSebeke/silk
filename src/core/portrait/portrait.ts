/**
 * Portrait (glossary): the image a Story Element shows, sheet image and token. Owns real
 * vs shown for actors/items (spec §8 Appearance, v1.1 §C.2, §C.4, §G.3) and every write to
 * `img`, the prototype/placed token texture and ring and the look's flags (`flags.ts`).
 * Pure: a doc as it is → the update data, plus the ring subject to render (`subject.ts`
 * turns that into the file and its writes). Journal Covers are not here.
 *
 * This module reads a Look; the writes are split by seam: `show.ts` (hood / Reveal, with
 * `hood.ts` and `unhood.ts`), `edit.ts` (the editor), `restore.ts` (the Original look),
 * `migration.ts` (round 2), `placed.ts` (each placed token).
 *
 * Hooded: `img` and the token textures show `flags.silk.hood` (the world's hooded image, or
 * the class icon once the Appearance block is deleted), centred in its ring (world style,
 * default colours, #182); the real image, token texture, ring and pose wait in the flags.
 * The texture scale is the actor's size factor and never Silk's (#168).
 */
import { elementClass } from '../elements/classes';
import { appearanceBlock, type StoryElement } from '../elements/element';
import type { LookFlags, PlacedTokenFlags, TokenRing, TokenTexture } from './flags';
import { CENTRED, DEFAULT_ORDER, tokenSize, type Order, type Pose } from './geometry';

/** The real Portrait: sheet image and prototype token texture. */
export interface Portrait {
  img: string;
  token: string;
}

/** What players see: the real Portrait, or a hood image in its place. */
export type Shown = 'real' | { hood: string };

/** Token ring colours; `null`: the world ring style decides. */
export interface RingColors {
  ring: string | null;
  background: string | null;
}

export interface Ring {
  enabled: boolean;
  colors: RingColors;
}

/** Look (glossary): everything the image & token editor shows, hooded or not. */
export interface Look extends Portrait {
  /** Players see the hood; edits to the image, token and pose wait for the Reveal. */
  hooded: boolean;
  /** The token uses the sheet image. */
  sameAsImage: boolean;
  ring: Ring;
  pose: Pose;
  /** Foundry's `lockRotation` (#136). */
  lockRotation: boolean;
  /** Draw order (#170): which shows in front, the ring or the illustration. */
  order: Order;
  /** The actor's size factor (its texture scale, #168): the preview draws at it. */
  sizeFactor: number;
  /** The token's size in grid units: the ring frame of the preview and the file. */
  size: number;
  /** Imported: `element.restoreImages` can bring its original look back (v1.1 §G.3.1). */
  restorable: boolean;
}

/** `element.setImage` (v1.1 §D): what to change; the rest stays. */
export interface ImageEdit {
  img?: string;
  token?: {
    src?: string;
    sameAsImage?: boolean;
    ring?: { enabled?: boolean; colors?: Partial<RingColors> };
    anchor?: { x: number; y: number };
    /** 0.5 to 8 (#137, #167); clamped. */
    scale?: number;
    lockRotation?: boolean;
    /** Default `ring` (#170). */
    order?: Order;
  };
}

/** A token's (prototype or placed) data, as far as the Portrait uses it. */
export interface TokenData {
  width?: number;
  height?: number;
  texture?: TokenTexture;
  lockRotation?: boolean;
  ring?: TokenRing;
}

/** A placed token's source data (plain: colours as CSS strings), with its own snapshot. */
export interface PlacedToken extends TokenData {
  flags?: { silk?: PlacedTokenFlags };
  [key: string]: unknown;
}

/** The slice of an actor/item doc a Portrait lives in. */
export interface PortraitDoc {
  img?: string | null;
  prototypeToken?: TokenData;
  flags: { silk: LookFlags };
}

/**
 * What every Portrait read and write starts from: the doc, the element's record image (a
 * known one wins) and the actor's size factor (#168).
 */
export interface LookSource {
  doc: PortraitDoc;
  recordImg?: string;
  sizeFactor: number;
}

/** The `LookSource` of `doc`, its size factor from the Game System. */
export const lookSource = (
  doc: PortraitDoc & { system?: unknown },
  sizes: { sizeFactor(system: unknown): number },
  recordImg?: string,
): LookSource => ({
  doc,
  ...(recordImg !== undefined ? { recordImg } : {}),
  sizeFactor: sizes.sizeFactor(doc.system),
});

/**
 * The ring subject a write needs (v1.1 §G.3): the image and its pose, cut to the ring at the
 * edge the draw order picks.
 */
export interface SubjectRequest {
  src: string;
  pose: Pose;
  order: Order;
}

/**
 * How a write treats each placed token's own Unhooded snapshot (v1.1 §G.3.1): `store` it
 * before the hood overwrites the token, `restore` it at Reveal, `drop` it (the real look is
 * Silk's now).
 */
export type SnapshotMode = 'store' | 'restore' | 'drop';

/**
 * Update data for a Portrait change. `doc`: dotted keys for the actor/item update. `tokens`:
 * for every placed token of the actor (the adapter skips unchanged ones), each token's own
 * snapshot handled by `snapshot`. `subject`: the ring subject file to write (ring on),
 * `null` to clear Silk's (ring off), absent: unchanged.
 */
export interface PortraitWrites {
  doc: Record<string, unknown>;
  tokens?: Record<string, unknown>;
  snapshot?: SnapshotMode;
  subject?: SubjectRequest | null;
}

/** v1.1 §C.4: Foundry core's icon replaces the image Silk 1.0 shipped. */
export const HOODED_DEFAULT = 'icons/svg/mystery-man-black.svg';
/** Silk 1.0's shipped hooded image, removed in 1.1. */
const HOODED_1_0 = 'modules/silk/assets/hooded.svg';

/** The world setting `hoodedImage` as used: empty or a saved 1.0 default → the core icon. */
export const hoodImage = (setting: string | undefined): string =>
  !setting || setting === HOODED_1_0 ? HOODED_DEFAULT : setting;

/** The hood for `element`: the world's, or without an Appearance block the class icon. */
export function hoodOf(element: Pick<StoryElement, 'class' | 'infoBlocks'>, world: string) {
  return appearanceBlock(element) ? world : (elementClass(element.class)?.icon ?? world);
}

/** `img` shows the hood; the real image waits in `flags.silk.img`. */
export function isHooded(doc: Pick<PortraitDoc, 'img' | 'flags'>): boolean {
  const { hood } = doc.flags.silk;
  return !!hood && doc.img === hood;
}

/** The real Portrait, wherever it is now. A known `recordImg` (the element's) wins. */
export function realPortrait(doc: PortraitDoc, recordImg?: string): Portrait {
  const flags = doc.flags.silk;
  const protoSrc = doc.prototypeToken?.texture?.src ?? undefined;
  const img = recordImg ?? (isHooded(doc) ? flags.img : (doc.img ?? undefined)) ?? '';
  const token = (protoSrc === flags.hood ? flags.token : protoSrc) ?? img;
  return { img, token };
}

/** The real look, wherever it is now (the image & token editor, v1.1 §G.3). */
export function lookOf({ doc, recordImg, sizeFactor }: LookSource): Look {
  const real = realPortrait(doc, recordImg);
  return {
    ...real,
    sameAsImage: real.token === real.img,
    hooded: isHooded(doc),
    ring: realRing(doc),
    pose: realPose(doc),
    lockRotation: !!doc.prototypeToken?.lockRotation,
    order: orderOf(doc),
    sizeFactor,
    size: tokenSize(doc.prototypeToken),
    restorable: !!doc.flags.silk.original,
  };
}

/** A Foundry update `changed` touches the Portrait (a hand edit may undo the hood). */
export const touchesPortrait = (changed: Record<string, unknown>): boolean =>
  'img' in changed || 'prototypeToken' in changed;

export function ringOf(token: TokenData | undefined): Ring {
  const colors = token?.ring?.colors;
  return {
    enabled: !!token?.ring?.enabled,
    colors: { ring: colors?.ring ?? null, background: colors?.background ?? null },
  };
}

/** The real ring: in the flag while hooded (#182), else the prototype's. */
export function realRing(doc: PortraitDoc): Ring {
  const { ring } = doc.flags.silk;
  return ring && isHooded(doc) ? structuredClone(ring) : ringOf(doc.prototypeToken);
}

/**
 * The real pose: in the flag when not centred. Without one, an unhooded token's anchor (the
 * texture scale is the size factor, never the pose); a hooded one is centred.
 */
export function realPose(doc: PortraitDoc): Pose {
  const { pose } = doc.flags.silk;
  if (pose) return { ...pose };
  if (isHooded(doc)) return { ...CENTRED };
  const texture = doc.prototypeToken?.texture;
  return {
    anchorX: texture?.anchorX ?? CENTRED.anchorX,
    anchorY: texture?.anchorY ?? CENTRED.anchorY,
    scale: CENTRED.scale,
  };
}

/** The actor's draw order (#170): the flag, else Ring in front. */
export const orderOf = (doc: PortraitDoc): Order => doc.flags.silk.order ?? DEFAULT_ORDER;

/** Silk wrote this actor's look: a hood, a pose, a draw order or a subject file. */
export function hasSilkLook(doc: PortraitDoc): boolean {
  const { hood, pose, subject, order } = doc.flags.silk;
  return !!(hood || pose || subject || order);
}
