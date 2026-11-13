/**
 * Showing the hood (spec §8, v1.1 §C.2, §G.3.1): `img` and every token show the hood; the
 * real image, token and pose wait in the flags, and what the hood overwrites is kept as
 * Unhooded (glossary), the prototype's on the actor and each placed token's on itself, so
 * Reveal restores all of it exactly. The hood always shows the ring (#182). Pure.
 */
import type { HoodSnapshot, Unhooded } from './flags';
import { CENTRED } from './geometry';
import {
  isHooded,
  orderOf,
  realPortrait,
  realPose,
  realRing,
  ringOf,
  type LookSource,
  type PortraitDoc,
  type PortraitWrites,
  type TokenData,
} from './portrait';
import {
  hoodSubject,
  hoodTokenData,
  poseFlag,
  prototypeUpdate,
  ringData,
  ringFlag,
} from './writes';

/**
 * What the hood is about to overwrite on `token` (prototype or placed). `own`: the image and
 * ring too (a placed token's own; the actor's real ones wait in `flags.garn.token` / `.ring`).
 */
export function hoodSnapshot(token: TokenData | undefined, own = true): HoodSnapshot {
  return {
    ...(own ? { ring: ringOf(token) } : {}),
    texture: {
      ...(own ? { src: token?.texture?.src ?? null } : {}),
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

/** A snapshot as token update keys (unprefixed); its `src` and ring only if it has them. */
export function snapshotData(snapshot: HoodSnapshot): Record<string, unknown> {
  const { src, fit, anchorX, anchorY } = snapshot.texture;
  return {
    ...(src ? { 'texture.src': src } : {}),
    ...(snapshot.ring ? ringData(snapshot.ring) : {}),
    'texture.fit': fit,
    'texture.anchorX': anchorX,
    'texture.anchorY': anchorY,
    'ring.subject.scale': snapshot.subject.scale,
    'ring.subject.texture': snapshot.subject.texture,
  };
}

/** The actor's Unhooded: the prototype's snapshot and the Garn flags the hood replaces. */
export function unhoodedOf(doc: PortraitDoc): Unhooded {
  const { pose, subject } = doc.flags.garn;
  return {
    ...hoodSnapshot(doc.prototypeToken, false),
    ...(pose ? { pose: { ...pose } } : {}),
    ...(subject ? { garnSubject: structuredClone(subject) } : {}),
  };
}

/** `flags.garn.unhooded` set to `value`: an update merges, so stale optional keys go. */
export function unhoodedFlag(doc: PortraitDoc, value: Unhooded): Record<string, unknown> {
  const stale = (['pose', 'garnSubject'] as const).filter(
    (k) => doc.flags.garn.unhooded?.[k] !== undefined && value[k] === undefined,
  );
  return {
    'flags.garn.unhooded': value,
    ...Object.fromEntries(stale.map((k) => [`flags.garn.unhooded.-=${k}`, null])),
  };
}

/** Makes the actor show `hood`. Hooding a hooded actor again writes only what changed. */
export function hoodWrites({ doc, recordImg }: LookSource, hood: string): PortraitWrites {
  const flags = doc.flags.garn;
  const real = realPortrait(doc, recordImg);
  const ring = realRing(doc);
  const hooded = isHooded(doc);
  const done =
    hooded && flags.img === real.img && flags.token === real.token && flags.hood === hood;
  const data = done
    ? {}
    : {
        img: hood,
        'flags.garn.img': real.img,
        'flags.garn.token': real.token,
        'flags.garn.hood': hood,
        ...(hooded ? {} : unhoodedFlag(doc, unhoodedOf(doc))),
      };
  const token = hoodTokenData(hood);
  return {
    doc: {
      ...data,
      ...ringFlag(doc, ring),
      ...prototypeUpdate(doc, token),
      ...poseFlag(doc, realPose(doc)),
    },
    tokens: token,
    snapshot: 'store',
    subject: hoodSubject(hood, orderOf(doc)),
  };
}
