/**
 * Imported images (v1.1 §G.3.1): the Original look kept at import, and `element.restoreImages`
 * putting it back. Pure.
 */
import type { OriginalLook } from './flags';
import { DEFAULT_ORDER } from './geometry';
import { hoodSnapshot, unhoodedFlag } from './hood';
import {
  HOODED_DEFAULT,
  isHooded,
  ringOf,
  type LookSource,
  type PortraitDoc,
  type PortraitWrites,
} from './portrait';
import { flatten } from '../util/objects';
import {
  TOKEN_DEFAULTS,
  hoodSubject,
  hoodTokenData,
  orderFlag,
  prototypeUpdate,
  ringFlag,
} from './writes';

/** The look to keep as `flags.garn.original` when `doc` is imported (v1.1 §G.3.1). */
export function originalLook(doc: Pick<PortraitDoc, 'img' | 'prototypeToken'>): OriginalLook {
  const { texture = {}, ring = {} } = structuredClone(doc.prototypeToken ?? {});
  return { ...(doc.img ? { img: doc.img } : {}), texture, ring };
}

/** Keys Garn's look writes on a token, with Foundry's defaults: a restore resets them all. */
const LOOK_DEFAULTS = Object.fromEntries(
  Object.entries(TOKEN_DEFAULTS).filter(([k]) => k.startsWith('texture.') || k.startsWith('ring.')),
);
/** Keys the hood overwrites (#182: its ring too); the rest of the look applies at once while hooded. */
const HOODED_KEYS = new Set([
  'texture.src',
  'ring.enabled',
  'ring.colors.ring',
  'ring.colors.background',
  'texture.fit',
  'texture.anchorX',
  'texture.anchorY',
  'ring.subject.scale',
  'ring.subject.texture',
]);
/** The size factor (#168): set at token creation, never written to placed tokens. */
const SIZE_KEYS = new Set(['texture.scaleX', 'texture.scaleY']);

const without = (keys: Record<string, unknown>, drop: ReadonlySet<string>) =>
  Object.fromEntries(Object.entries(keys).filter(([k]) => !drop.has(k)));

/**
 * `element.restoreImages` (v1.1 §G.3.1): the original look back on `img`, the prototype and
 * every placed token (their size factor stays), Garn's pose, draw order and subject file
 * cleared. Hooded: the originals become the real look; the hood stays until Reveal.
 */
export function restoreWrites({ doc }: LookSource): PortraitWrites {
  const flags = doc.flags.garn;
  const original = flags.original;
  if (!original) throw new Error('Garn: no imported images to restore');
  const img = original.img ?? '';
  const token = {
    texture: { src: img, ...original.texture },
    ring: original.ring,
  };
  const originalKeys = { ...LOOK_DEFAULTS, ...flatten(token) };
  // After the restore the draw order is the default; the hood's subject is cut for it.
  const order = DEFAULT_ORDER;
  const cleared = {
    ...(flags.pose ? { 'flags.garn.-=pose': null } : {}),
    ...orderFlag(doc, order),
  };
  if (!isHooded(doc)) {
    return {
      doc: {
        ...(doc.img !== img ? { img } : {}),
        ...prototypeUpdate(doc, originalKeys),
        ...cleared,
        ...(flags.subject ? { 'flags.garn.-=subject': null } : {}),
      },
      tokens: without(originalKeys, SIZE_KEYS),
    };
  }
  // Hooded: the originals wait as the real look; Reveal restores them like any Unhooded.
  const hood = flags.hood ?? HOODED_DEFAULT;
  const hooded = {
    ...without(originalKeys, HOODED_KEYS),
    ...hoodTokenData(hood),
  };
  return {
    doc: {
      'flags.garn.img': img,
      'flags.garn.token': token.texture.src ?? img,
      ...unhoodedFlag(doc, hoodSnapshot(token, false)),
      ...ringFlag(doc, ringOf(token)),
      ...prototypeUpdate(doc, hooded),
      ...cleared,
    },
    tokens: without(hooded, SIZE_KEYS),
    snapshot: 'drop',
    subject: hoodSubject(hood, order),
  };
}
