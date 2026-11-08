/**
 * Portrait (glossary): the image a Story Element shows, sheet image and token. Owns real
 * vs shown for actors/items (spec §8 Appearance, v1.1 §C.2, §C.4, §G.3) and every write to
 * `img`, the prototype/placed token texture and ring and `flags.silk.img` / `token` /
 * `pose` / `hood`. Pure: a doc as it is → the update data. Journal Covers are not here.
 *
 * Hooded: `img` and the token textures show `flags.silk.hood` (the world's hooded image, or
 * the class icon once the Appearance block is deleted), centred; the real image, token
 * texture and pose wait in the flags. The ring is not hidden: it always applies at once.
 */
import { elementClass } from '../elements/classes';
import { appearanceBlock, type StoryElement } from '../elements/element';
import type { SilkDocFlags } from '../materialize/port';
import { CENTRED, clampScale, hoodPose, tokenGeometry, type Mirror, type Pose } from './geometry';

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
}

/** `element.setImage` (v1.1 §D): what to change; the rest stays. */
export interface ImageEdit {
  img?: string;
  token?: {
    src?: string;
    sameAsImage?: boolean;
    ring?: { enabled?: boolean; colors?: Partial<RingColors> };
    anchor?: { x: number; y: number };
    /** 1 to 8 (#137); clamped. */
    scale?: number;
    lockRotation?: boolean;
  };
}

/** A token's (prototype or placed) data, as far as the Portrait uses it. */
interface TokenData {
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
    subject?: { scale?: number };
  };
}

/** The slice of an actor/item doc a Portrait lives in. */
export interface PortraitDoc {
  img?: string | null;
  prototypeToken?: TokenData;
  flags: { silk: Pick<SilkDocFlags, 'img' | 'token' | 'hood' | 'pose'> };
}

/**
 * Update data for a Portrait change. `doc`: dotted keys for the actor/item update. `tokens`:
 * for every placed token of the actor (the adapter skips unchanged ones).
 */
export interface PortraitWrites {
  doc: Record<string, unknown>;
  tokens?: Record<string, unknown>;
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
export function lookOf(doc: PortraitDoc, recordImg?: string): Look {
  const real = realPortrait(doc, recordImg);
  return {
    ...real,
    sameAsImage: real.token === real.img,
    hooded: isHooded(doc),
    ring: ringOf(doc.prototypeToken),
    pose: realPose(doc),
    lockRotation: !!doc.prototypeToken?.lockRotation,
  };
}

/** Makes `doc` show `shown`. No-op doc writes are left out. */
export function showWrites(doc: PortraitDoc, shown: Shown, recordImg?: string): PortraitWrites {
  const flags = doc.flags.silk;
  const real = realPortrait(doc, recordImg);
  const pose = realPose(doc);
  const ring = ringOf(doc.prototypeToken).enabled;
  if (shown === 'real') {
    const data = flags.hood
      ? {
          img: real.img,
          'prototypeToken.texture.src': real.token,
          ...proto(doc, poseData(pose, ring, doc)),
          'flags.silk.-=img': null,
          'flags.silk.-=token': null,
          'flags.silk.-=hood': null,
          ...(flags.pose ? { 'flags.silk.-=pose': null } : {}),
        }
      : {};
    return { doc: data, tokens: { 'texture.src': real.token, ...poseData(pose, ring, doc) } };
  }
  const { hood } = shown;
  const done =
    isHooded(doc) &&
    flags.img === real.img &&
    doc.prototypeToken?.texture?.src === hood &&
    flags.hood === hood;
  const data = done
    ? {}
    : {
        img: hood,
        'prototypeToken.texture.src': hood,
        'flags.silk.img': real.img,
        'flags.silk.token': real.token,
        'flags.silk.hood': hood,
      };
  return {
    doc: { ...data, ...hiddenPose(doc, pose, ring) },
    tokens: { 'texture.src': hood, ...poseData(hoodPose(ring), ring, doc) },
  };
}

/**
 * `element.setImage` on an actor/item doc (v1.1 §G.3). Hooded: the image, token texture and
 * pose wait in the flags, players keep seeing the hood; the ring applies at once. `tokens`
 * only when the edit touches the token.
 */
export function imageWrites(doc: PortraitDoc, edit: ImageEdit, recordImg?: string): PortraitWrites {
  const hooded = isHooded(doc);
  const flags = doc.flags.silk;
  const look = lookOf(doc, recordImg);
  const img = edit.img ?? look.img;
  const data: Record<string, unknown> = {};
  if (edit.img !== undefined && edit.img !== (hooded ? flags.img : doc.img))
    data[hooded ? 'flags.silk.img' : 'img'] = edit.img;
  const t = edit.token;
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
  const same = t.sameAsImage ?? (t.src === undefined && look.sameAsImage);
  const src = same ? img : (t.src ?? look.token);
  const ringKeys = {
    ...ringData(ring),
    ...(t.lockRotation !== undefined ? { lockRotation: t.lockRotation } : {}),
  };

  if (hooded) {
    if (src !== flags.token) data['flags.silk.token'] = src;
    Object.assign(data, proto(doc, ringKeys), hiddenPose(doc, pose, ring.enabled));
    return {
      doc: data,
      tokens: { ...ringKeys, ...poseData(hoodPose(ring.enabled), ring.enabled, doc) },
    };
  }
  const token = { 'texture.src': src, ...ringKeys, ...poseData(pose, ring.enabled, doc) };
  return { doc: { ...data, ...proto(doc, token) }, tokens: token };
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

/** The pose the prototype token shows now. */
function shownPose(token: TokenData | undefined): Pose {
  const texture = token?.texture;
  return {
    anchorX: texture?.anchorX ?? CENTRED.anchorX,
    anchorY: texture?.anchorY ?? CENTRED.anchorY,
    scale: Math.abs(texture?.scaleX ?? CENTRED.scale),
  };
}

const samePose = (a: Pose, b: Pose) =>
  a.anchorX === b.anchorX && a.anchorY === b.anchorY && a.scale === b.scale;

/**
 * The real pose. Under a hood the token shows the hood pose and the real one waits in the
 * flag; a hooded token posed otherwise was posed by hand, and that pose is the real one.
 */
function realPose(doc: PortraitDoc): Pose {
  const shown = shownPose(doc.prototypeToken);
  const { hood, pose } = doc.flags.silk;
  const hoodShown = hoodPose(!!doc.prototypeToken?.ring?.enabled);
  // Without a flag the real pose is centred (only a posed token stores one).
  return hood && samePose(shown, hoodShown) ? { ...(pose ?? CENTRED) } : shown;
}

/** Token update data for `pose` (keeps a mirrored texture mirrored). */
function poseData(pose: Pose, ring: boolean, doc: PortraitDoc): Record<string, unknown> {
  const texture = doc.prototypeToken?.texture;
  const sign = (n: number | undefined) => (n !== undefined && n < 0 ? -1 : 1);
  const mirror: Mirror = { x: sign(texture?.scaleX), y: sign(texture?.scaleY) };
  return tokenGeometry(pose, ring, { mirror }).data;
}

const ringData = (ring: Ring): Record<string, unknown> => ({
  'ring.enabled': ring.enabled,
  'ring.colors.ring': ring.colors.ring,
  'ring.colors.background': ring.colors.background,
});

/** While hooded: the prototype token centred, the real pose in the flag. */
function hiddenPose(doc: PortraitDoc, pose: Pose, ring: boolean): Record<string, unknown> {
  const flag = doc.flags.silk.pose;
  const data = proto(doc, poseData(hoodPose(ring), ring, doc));
  if (samePose(pose, CENTRED)) {
    if (flag) data['flags.silk.-=pose'] = null;
  } else if (!flag || !samePose(flag, pose)) data['flags.silk.pose'] = { ...pose };
  return data;
}

/** Token data as prototype token update keys, leaving out what the prototype already has. */
function proto(doc: PortraitDoc, token: Record<string, unknown>): Record<string, unknown> {
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
