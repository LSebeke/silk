/**
 * Reveal of the real look (spec §8, v1.1 §G.3, §G.3.1): a hood that kept what it overwrote
 * (Unhooded) puts all of it back exactly, each placed token its own; otherwise Silk's look
 * is built from the real image, pose and draw order. An actor without a Silk look keeps its
 * own. Pure.
 */
import type { Unhooded } from './flags';
import { tokenData } from './geometry';
import { snapshotData } from './hood';
import {
  hasSilkLook,
  orderOf,
  realPortrait,
  realPose,
  realRing,
  type LookSource,
  type PortraitWrites,
} from './portrait';
import { poseFlag, prototypeUpdate, ringData } from './writes';

/** Makes the actor show its real look. No-op doc writes are left out. */
export function revealWrites(source: LookSource): PortraitWrites {
  const { doc } = source;
  const flags = doc.flags.silk;
  if (flags.hood && flags.unhooded) return unhood(source, flags.unhooded);
  // v1.1 §G.3.1: an imported look is never changed on its own, its tokens neither.
  if (!hasSilkLook(doc)) {
    const { token } = realPortrait(doc, source.recordImg);
    return flags.original ? { doc: {} } : { doc: {}, tokens: { 'texture.src': token } };
  }
  return silkLookWrites(source);
}

/** The hood's flags cleared and the real image back on the sheet; nothing when unhooded. */
function hoodFlagsCleared({ doc, recordImg }: LookSource): Record<string, unknown> {
  if (!doc.flags.silk.hood) return {};
  return {
    img: realPortrait(doc, recordImg).img,
    'flags.silk.-=img': null,
    'flags.silk.-=token': null,
    'flags.silk.-=hood': null,
    ...(doc.flags.silk.ring ? { 'flags.silk.-=ring': null } : {}),
  };
}

/**
 * Silk's real look: the token image, posed (the subject file with the ring on, the texture
 * anchor without), in the actor's draw order. Placed tokens' snapshots are dropped: the real
 * look is Silk's.
 */
export function silkLookWrites(source: LookSource): PortraitWrites {
  const { doc } = source;
  const real = realPortrait(doc, source.recordImg);
  const pose = realPose(doc);
  const ring = realRing(doc);
  const token = { 'texture.src': real.token, ...ringData(ring), ...tokenData(pose, ring.enabled) };
  return {
    doc: {
      ...hoodFlagsCleared(source),
      ...prototypeUpdate(doc, token),
      ...poseFlag(doc, pose),
      ...(doc.flags.silk.unhooded ? { 'flags.silk.-=unhooded': null } : {}),
    },
    tokens: token,
    snapshot: 'drop',
    subject: ring.enabled ? { src: real.token, pose, order: orderOf(doc) } : null,
  };
}

/** Reveal of a hood that stored what it overwrote: all of it back, exactly. */
function unhood(source: LookSource, overwritten: Unhooded): PortraitWrites {
  const { doc } = source;
  const { pose, subject } = doc.flags.silk;
  const token = {
    ...snapshotData(overwritten),
    ...ringData(realRing(doc)),
    'texture.src': realPortrait(doc, source.recordImg).token,
  };
  return {
    doc: {
      ...hoodFlagsCleared(source),
      ...prototypeUpdate(doc, token),
      ...silkFlag('pose', overwritten.pose, pose),
      ...silkFlag('subject', overwritten.silkSubject, subject),
      'flags.silk.-=unhooded': null,
    },
    tokens: token,
    snapshot: 'restore',
  };
}

/** `flags.silk.<key>` back to `value`: set, or cleared when it had none. */
function silkFlag(key: string, value: unknown, now: unknown): Record<string, unknown> {
  if (value !== undefined) return { [`flags.silk.${key}`]: value };
  return now !== undefined ? { [`flags.silk.-=${key}`]: null } : {};
}
