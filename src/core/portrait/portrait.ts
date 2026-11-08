/**
 * Portrait (glossary): the image a Story Element shows, sheet image and token. Owns real
 * vs shown for actors/items (spec §8 Appearance, v1.1 §C.2, §C.4, §G.3) and every write to
 * `img`, the prototype/placed token texture and ring and `flags.silk.img` / `token` /
 * `pose` / `hood`. Pure: a doc as it is → the update data, plus the ring subject to render
 * (`subject.ts` turns that into the file and its writes). Journal Covers are not here.
 *
 * Hooded: `img` and the token textures show `flags.silk.hood` (the world's hooded image, or
 * the class icon once the Appearance block is deleted), centred; the real image, token
 * texture and pose wait in the flags. The ring is not hidden: it always applies at once.
 * The texture scale is the actor's size factor and never Silk's (#168).
 */
import { elementClass } from '../elements/classes';
import { appearanceBlock, type StoryElement } from '../elements/element';
import type { SilkDocFlags } from '../materialize/port';
import { CENTRED, clampScale, hoodPose, tokenData, type Order, type Pose } from './geometry';

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

/** Everything the image & token editor shows: the real look, hooded or not. */
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
  texture?: {
    src?: string | null;
    anchorX?: number;
    anchorY?: number;
    scaleX?: number;
    scaleY?: number;
    fit?: string;
  };
  lockRotation?: boolean;
  ring?: {
    enabled?: boolean;
    colors?: { ring?: string | null; background?: string | null };
    subject?: { scale?: number; texture?: string | null };
  };
}

/** The slice of an actor/item doc a Portrait lives in. */
export interface PortraitDoc {
  img?: string | null;
  prototypeToken?: TokenData;
  flags: {
    silk: Pick<
      SilkDocFlags,
      'img' | 'token' | 'hood' | 'pose' | 'subject' | 'order' | 'original' | 'unhooded'
    >;
  };
}

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
 * Update data for a Portrait change. `doc`: dotted keys for the actor/item update. `tokens`:
 * for every placed token of the actor (the adapter skips unchanged ones). `subject`: the ring
 * subject file to write (ring on), `null` to clear Silk's (ring off), absent: unchanged.
 */
export interface PortraitWrites {
  doc: Record<string, unknown>;
  tokens?: Record<string, unknown>;
  subject?: SubjectRequest | null;
}

/** v1.1 §C.4: Foundry core's icon replaces the image Silk 1.0 shipped. */
export const HOODED_DEFAULT = 'icons/svg/mystery-man-black.svg';
/** Silk 1.0's shipped hooded image, removed in 1.1. */
const HOODED_1_0 = 'modules/silk/assets/hooded.svg';

/** Foundry's token defaults (common/documents/token.mjs). */
const TOKEN_DEFAULTS: Record<string, unknown> = {
  'texture.fit': 'contain',
  'texture.anchorX': 0.5,
  'texture.anchorY': 0.5,
  'texture.scaleX': 1,
  'texture.scaleY': 1,
  'ring.enabled': false,
  'ring.colors.ring': null,
  'ring.colors.background': null,
  'ring.subject.scale': 1,
  'ring.subject.texture': null,
  lockRotation: false,
};

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
export function lookOf(doc: PortraitDoc, recordImg?: string, sizeFactor = 1): Look {
  const real = realPortrait(doc, recordImg);
  return {
    ...real,
    sameAsImage: real.token === real.img,
    hooded: isHooded(doc),
    ring: ringOf(doc.prototypeToken),
    pose: realPose(doc),
    lockRotation: !!doc.prototypeToken?.lockRotation,
    order: orderOf(doc),
    sizeFactor,
  };
}

/**
 * Makes `doc` show `shown`. No-op doc writes are left out. An actor without a Silk look (no
 * hood, pose or subject file of Silk's) keeps its own look; only its placed tokens follow
 * the token image. `sizeFactor`: the actor's size factor, for the round 2 migration
 * (v1.1 §G.3.2).
 */
export function showWrites(
  doc: PortraitDoc,
  shown: Shown,
  recordImg?: string,
  sizeFactor = 1,
): PortraitWrites {
  const flags = doc.flags.silk;
  const real = realPortrait(doc, recordImg);
  const pose = realPose(doc);
  const order = orderOf(doc);
  const ring = ringOf(doc.prototypeToken).enabled;
  const migrate = migration(doc, sizeFactor);
  if (shown === 'real') {
    const restore = flags.hood
      ? {
          img: real.img,
          'flags.silk.-=img': null,
          'flags.silk.-=token': null,
          'flags.silk.-=hood': null,
        }
      : {};
    if (flags.hood && flags.unhooded) return unhood(doc, flags.unhooded, real, restore);
    // v1.1 §G.3.1: an imported look is never changed on its own, its tokens neither.
    if (!hasSilkLook(doc))
      return flags.original ? { doc: {} } : { doc: {}, tokens: { 'texture.src': real.token } };
    const token = { 'texture.src': real.token, ...tokenData(pose, ring), ...migrate };
    return {
      doc: { ...restore, ...proto(doc, token), ...poseFlag(doc, pose) },
      tokens: token,
      subject: ring ? { src: real.token, pose, order } : null,
    };
  }
  const { hood } = shown;
  const done =
    isHooded(doc) && flags.img === real.img && flags.token === real.token && flags.hood === hood;
  const data = done
    ? {}
    : {
        img: hood,
        'flags.silk.img': real.img,
        'flags.silk.token': real.token,
        'flags.silk.hood': hood,
        ...(isHooded(doc) ? {} : { 'flags.silk.unhooded': unhoodedOf(doc) }),
      };
  const token = { 'texture.src': hood, ...tokenData(hoodPose(ring), ring), ...migrate };
  return {
    doc: { ...data, ...proto(doc, token), ...poseFlag(doc, pose) },
    tokens: token,
    subject: ring ? { src: hood, pose: hoodPose(true), order } : null,
  };
}

/**
 * `element.setImage` on an actor/item doc (v1.1 §G.3). Hooded: the image, token texture and
 * pose wait in the flags, players keep seeing the hood; the ring applies at once. `tokens`
 * only when the edit touches the token, or a new image the token follows (#166).
 */
export function imageWrites(
  doc: PortraitDoc,
  edit: ImageEdit,
  recordImg?: string,
  sizeFactor = 1,
): PortraitWrites {
  const hooded = isHooded(doc);
  const flags = doc.flags.silk;
  const look = lookOf(doc, recordImg);
  const img = edit.img ?? look.img;
  const data: Record<string, unknown> = {};
  if (edit.img !== undefined && edit.img !== (hooded ? flags.img : doc.img))
    data[hooded ? 'flags.silk.img' : 'img'] = edit.img;
  // #166: a token "same as sheet image" follows a new sheet image. The doc, not the record,
  // says what the token follows: on the merge path the record already has the new image.
  const onDoc = realPortrait(doc);
  const follows = onDoc.token === onDoc.img && edit.img !== undefined && edit.img !== onDoc.img;
  const t = edit.token ?? (follows ? { sameAsImage: true } : undefined);
  if (!t) return { doc: data };

  const ring: Ring = {
    enabled: t.ring?.enabled ?? look.ring.enabled,
    colors: { ...look.ring.colors, ...t.ring?.colors },
  };
  const pose: Pose = {
    anchorX: t.anchor?.x ?? look.pose.anchorX,
    anchorY: t.anchor?.y ?? look.pose.anchorY,
    scale: t.scale !== undefined ? clampScale(t.scale) : look.pose.scale,
  };
  const order = t.order ?? look.order;
  const same = t.sameAsImage ?? (t.src === undefined && look.sameAsImage);
  const src = same ? img : (t.src ?? look.token);
  const on = ring.enabled;
  const keys = {
    ...ringData(ring),
    ...(t.lockRotation !== undefined ? { lockRotation: t.lockRotation } : {}),
    ...migration(doc, sizeFactor),
  };

  if (hooded) {
    if (src !== flags.token) data['flags.silk.token'] = src;
    // A token edit (the editor) makes the real look Silk's: Reveal builds it, no restore.
    if (edit.token && flags.unhooded) data['flags.silk.-=unhooded'] = null;
    const token = { ...keys, ...tokenData(hoodPose(on), on) };
    return {
      doc: { ...data, ...proto(doc, token), ...poseFlag(doc, pose), ...orderFlag(doc, order) },
      tokens: token,
      subject: on ? { src: flags.hood ?? HOODED_DEFAULT, pose: hoodPose(true), order } : null,
    };
  }
  const token = { 'texture.src': src, ...keys, ...tokenData(pose, on) };
  return {
    doc: { ...data, ...proto(doc, token), ...poseFlag(doc, pose), ...orderFlag(doc, order) },
    tokens: token,
    subject: on ? { src, pose, order } : null,
  };
}

/** `flags.silk.unhooded`: what the hood overwrote (v1.1 §G.3.1). */
type Unhooded = NonNullable<SilkDocFlags['unhooded']>;

/** The prototype keys the hood is about to overwrite, and Silk's flags it replaces. */
function unhoodedOf(doc: PortraitDoc): Unhooded {
  const token = doc.prototypeToken;
  const { pose, subject } = doc.flags.silk;
  return {
    texture: {
      fit: token?.texture?.fit ?? 'contain',
      anchorX: token?.texture?.anchorX ?? CENTRED.anchorX,
      anchorY: token?.texture?.anchorY ?? CENTRED.anchorY,
    },
    subject: {
      scale: token?.ring?.subject?.scale ?? 1,
      texture: token?.ring?.subject?.texture ?? null,
    },
    ...(pose ? { pose: { ...pose } } : {}),
    ...(subject ? { silkSubject: structuredClone(subject) } : {}),
  };
}

/** Reveal of a hood that stored what it overwrote: all of it back, exactly. */
function unhood(
  doc: PortraitDoc,
  under: Unhooded,
  real: Portrait,
  restore: Record<string, unknown>,
): PortraitWrites {
  const { pose, subject } = doc.flags.silk;
  const token = {
    'texture.src': real.token,
    'texture.fit': under.texture.fit,
    'texture.anchorX': under.texture.anchorX,
    'texture.anchorY': under.texture.anchorY,
    'ring.subject.scale': under.subject.scale,
    'ring.subject.texture': under.subject.texture,
  };
  const flag = (key: string, value: unknown, now: unknown) =>
    value !== undefined
      ? { [`flags.silk.${key}`]: value }
      : now !== undefined
        ? { [`flags.silk.-=${key}`]: null }
        : {};
  return {
    doc: {
      ...restore,
      ...proto(doc, token),
      ...flag('pose', under.pose, pose),
      ...flag('subject', under.silkSubject, subject),
      'flags.silk.-=unhooded': null,
    },
    tokens: token,
  };
}

/** `flags.silk.original`: an imported actor's look (v1.1 §G.3.1). */
export type OriginalLook = NonNullable<SilkDocFlags['original']>;

/** The look to keep as `flags.silk.original` when `doc` is imported (v1.1 §G.3.1). */
export function originalLook(doc: Pick<PortraitDoc, 'img' | 'prototypeToken'>): OriginalLook {
  const { texture = {}, ring = {} } = structuredClone(doc.prototypeToken ?? {});
  return { ...(doc.img ? { img: doc.img } : {}), texture, ring };
}

/** A Foundry update `changed` touches the Portrait (a hand edit may undo the hood). */
export const touchesPortrait = (changed: Record<string, unknown>): boolean =>
  'img' in changed || 'prototypeToken' in changed;

function ringOf(token: TokenData | undefined): Ring {
  const colors = token?.ring?.colors;
  return {
    enabled: !!token?.ring?.enabled,
    colors: { ring: colors?.ring ?? null, background: colors?.background ?? null },
  };
}

/**
 * Round 2 wrote the pose into the texture (fit cover, scale = pose) and no subject file
 * (v1.1 §G.3.2). Such a look is migrated on its next write.
 */
const isRound2Look = (doc: PortraitDoc): boolean =>
  !!doc.prototypeToken?.ring?.enabled &&
  doc.prototypeToken.texture?.fit === 'cover' &&
  !doc.flags.silk.subject &&
  !doc.flags.silk.original;

/** Silk wrote this actor's look: a hood, a pose, a draw order, a subject file, or round 2's. */
function hasSilkLook(doc: PortraitDoc): boolean {
  const { hood, pose, subject, order } = doc.flags.silk;
  return !!(hood || pose || subject || order) || isRound2Look(doc);
}

/** Round 2 migration: the texture scale back to the size factor (a mirror stays). */
function migration(doc: PortraitDoc, sizeFactor: number): Record<string, unknown> {
  if (!isRound2Look(doc)) return {};
  const texture = doc.prototypeToken?.texture;
  const sign = (n: number | undefined) => (n !== undefined && n < 0 ? -1 : 1);
  return {
    'texture.scaleX': sign(texture?.scaleX) * sizeFactor,
    'texture.scaleY': sign(texture?.scaleY) * sizeFactor,
  };
}

/**
 * The real pose: in the flag when not centred. Without one, an unhooded token's anchor (and,
 * for a round 2 look, its texture scale); a hooded one is centred.
 */
function realPose(doc: PortraitDoc): Pose {
  const { pose } = doc.flags.silk;
  if (pose) return { ...pose };
  if (isHooded(doc)) return { ...CENTRED };
  const texture = doc.prototypeToken?.texture;
  return {
    anchorX: texture?.anchorX ?? CENTRED.anchorX,
    anchorY: texture?.anchorY ?? CENTRED.anchorY,
    scale: isRound2Look(doc) ? Math.abs(texture?.scaleX ?? CENTRED.scale) : CENTRED.scale,
  };
}

export const samePose = (a: Pose, b: Pose): boolean =>
  a.anchorX === b.anchorX && a.anchorY === b.anchorY && a.scale === b.scale;

const ringData = (ring: Ring): Record<string, unknown> => ({
  'ring.enabled': ring.enabled,
  'ring.colors.ring': ring.colors.ring,
  'ring.colors.background': ring.colors.background,
});

/** `flags.silk.pose` holding `pose`: set when not centred, cleared when centred. */
function poseFlag(doc: PortraitDoc, pose: Pose): Record<string, unknown> {
  const flag = doc.flags.silk.pose;
  if (samePose(pose, CENTRED)) return flag ? { 'flags.silk.-=pose': null } : {};
  return flag && samePose(flag, pose) ? {} : { 'flags.silk.pose': { ...pose } };
}

/** The actor's draw order (#170): the flag, else Ring in front. */
const orderOf = (doc: PortraitDoc): Order => doc.flags.silk.order ?? 'ring';

/** `flags.silk.order` holding `order`: set for Illustration in front, cleared for the default. */
function orderFlag(doc: PortraitDoc, order: Order): Record<string, unknown> {
  const flag = doc.flags.silk.order;
  if (order === 'ring') return flag ? { 'flags.silk.-=order': null } : {};
  return flag === order ? {} : { 'flags.silk.order': order };
}

/** Token data as prototype token update keys, leaving out what the prototype already has. */
export function proto(doc: PortraitDoc, token: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(token)) {
    const current = key
      .split('.')
      .reduce<unknown>(
        (o, k) => (o as Record<string, unknown> | undefined)?.[k],
        doc.prototypeToken,
      );
    if ((current ?? TOKEN_DEFAULTS[key]) !== value) out[`prototypeToken.${key}`] = value;
  }
  return out;
}
