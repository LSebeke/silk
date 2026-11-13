/**
 * Building blocks every Portrait write shares: Foundry's token defaults, prototype update
 * keys, the pose / draw order flags, the ring keys and the hood's subject. Pure.
 */
import { CENTRED, DEFAULT_ORDER, HOOD_POSE, tokenData, type Order, type Pose } from './geometry';
import type { PortraitDoc, Ring, SubjectRequest } from './portrait';

/** Foundry's token defaults (common/documents/token.mjs). */
export const TOKEN_DEFAULTS: Readonly<Record<string, unknown>> = {
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

/** The value at dotted `path` in `obj`. */
export const valueAt = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);

/** Token data as prototype token update keys, leaving out what the prototype already has. */
export function prototypeUpdate(
  doc: PortraitDoc,
  token: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(token)) {
    const current = valueAt(doc.prototypeToken, key);
    if ((current ?? TOKEN_DEFAULTS[key]) !== value) out[`prototypeToken.${key}`] = value;
  }
  return out;
}

export const samePose = (a: Pose, b: Pose): boolean =>
  a.anchorX === b.anchorX && a.anchorY === b.anchorY && a.scale === b.scale;

/** `flags.garn.pose` holding `pose`: set when not centred, cleared when centred. */
export function poseFlag(doc: PortraitDoc, pose: Pose): Record<string, unknown> {
  const flag = doc.flags.garn.pose;
  if (samePose(pose, CENTRED)) return flag ? { 'flags.garn.-=pose': null } : {};
  return flag && samePose(flag, pose) ? {} : { 'flags.garn.pose': { ...pose } };
}

/** `flags.garn.order` holding `order`: set for Illustration in front, cleared for the default. */
export function orderFlag(doc: PortraitDoc, order: Order): Record<string, unknown> {
  const flag = doc.flags.garn.order;
  if (order === DEFAULT_ORDER) return flag ? { 'flags.garn.-=order': null } : {};
  return flag === order ? {} : { 'flags.garn.order': order };
}

export const ringData = (ring: Ring): Record<string, unknown> => ({
  'ring.enabled': ring.enabled,
  'ring.colors.ring': ring.colors.ring,
  'ring.colors.background': ring.colors.background,
});

/** The hood's ring (#182): always on, the world ring style's own colours. */
export const HOOD_RING: Readonly<Ring> = {
  enabled: true,
  colors: { ring: null, background: null },
};

/** Token keys showing the hood: its image in its ring (#182), centred (the pose is the file's). */
export const hoodTokenData = (hood: string): Record<string, unknown> => ({
  'texture.src': hood,
  ...ringData(HOOD_RING),
  ...tokenData(HOOD_POSE, true),
});

/** The hood's own subject file (v1.1 §G.3): 0.7 of the subject, through the actor's draw order. */
export const hoodSubject = (hood: string, order: Order): SubjectRequest => ({
  src: hood,
  pose: { ...HOOD_POSE },
  order,
});

/** `flags.garn.ring` holding the real ring while hooded (#182); written only when it changes. */
export function ringFlag(doc: PortraitDoc, ring: Ring): Record<string, unknown> {
  const flag = doc.flags.garn.ring;
  return flag && JSON.stringify(flag) === JSON.stringify(ring)
    ? {}
    : { 'flags.garn.ring': structuredClone(ring) };
}
