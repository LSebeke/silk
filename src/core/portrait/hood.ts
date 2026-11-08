/**
 * Showing the hood (spec §8, v1.1 §C.2, §G.3.1): `img` and every token show the hood; the
 * real image, token and pose wait in the flags, and what the hood overwrites is kept as
 * Unhooded (glossary), the prototype's on the actor and each placed token's on itself, so
 * Reveal restores all of it exactly. Pure.
 */
import type { HoodSnapshot, Unhooded } from './flags';
import { CENTRED } from './geometry';
import {
  isHooded,
  orderOf,
  realPortrait,
  realPose,
  ringOf,
  type LookSource,
  type PortraitDoc,
  type PortraitWrites,
  type TokenData,
} from './portrait';
import { hoodSubject, hoodTokenData, poseFlag, prototypeUpdate } from './writes';

/**
 * What the hood is about to overwrite on `token` (prototype or placed). `withSrc`: the
 * image too (a placed token's own; the actor's real one waits in `flags.silk.token`).
 */
export function hoodSnapshot(token: TokenData | undefined, withSrc = true): HoodSnapshot {
  return {
    texture: {
      ...(withSrc ? { src: token?.texture?.src ?? null } : {}),
      fit: token?.texture?.fit ?? 'contain',
      anchorX: token?.texture?.anchorX ?? CENTRED.anchorX,
      anchorY: token?.texture?.anchorY ?? CENTRED.anchorY,
    },
    subject: {
      scale: token?.ring?.subject?.scale ?? 1,
      texture: token?.ring?.subject?.texture ?? null,
    },
  };
}

/** A snapshot as token update keys (unprefixed); its `src` only if it has one. */
export function snapshotData(snapshot: HoodSnapshot): Record<string, unknown> {
  const { src, fit, anchorX, anchorY } = snapshot.texture;
  return {
    ...(src ? { 'texture.src': src } : {}),
    'texture.fit': fit,
    'texture.anchorX': anchorX,
    'texture.anchorY': anchorY,
    'ring.subject.scale': snapshot.subject.scale,
    'ring.subject.texture': snapshot.subject.texture,
  };
}

/** The actor's Unhooded: the prototype's snapshot and the Silk flags the hood replaces. */
export function unhoodedOf(doc: PortraitDoc): Unhooded {
  const { pose, subject } = doc.flags.silk;
  return {
    ...hoodSnapshot(doc.prototypeToken, false),
    ...(pose ? { pose: { ...pose } } : {}),
    ...(subject ? { silkSubject: structuredClone(subject) } : {}),
  };
}

/** `flags.silk.unhooded` set to `value`: an update merges, so stale optional keys go. */
export function unhoodedFlag(doc: PortraitDoc, value: Unhooded): Record<string, unknown> {
  const stale = (['pose', 'silkSubject'] as const).filter(
    (k) => doc.flags.silk.unhooded?.[k] !== undefined && value[k] === undefined,
  );
  return {
    'flags.silk.unhooded': value,
    ...Object.fromEntries(stale.map((k) => [`flags.silk.unhooded.-=${k}`, null])),
  };
}

/** Makes the actor show `hood`. Hooding a hooded actor again writes only what changed. */
export function hoodWrites({ doc, recordImg }: LookSource, hood: string): PortraitWrites {
  const flags = doc.flags.silk;
  const real = realPortrait(doc, recordImg);
  const ringOn = ringOf(doc.prototypeToken).enabled;
  const hooded = isHooded(doc);
  const done =
    hooded && flags.img === real.img && flags.token === real.token && flags.hood === hood;
  const data = done
    ? {}
    : {
        img: hood,
        'flags.silk.img': real.img,
        'flags.silk.token': real.token,
        'flags.silk.hood': hood,
        ...(hooded ? {} : unhoodedFlag(doc, unhoodedOf(doc))),
      };
  const token = hoodTokenData(hood, ringOn);
  return {
    doc: { ...data, ...prototypeUpdate(doc, token), ...poseFlag(doc, realPose(doc)) },
    tokens: token,
    snapshot: 'store',
    subject: hoodSubject(hood, ringOn, orderOf(doc)),
  };
}
