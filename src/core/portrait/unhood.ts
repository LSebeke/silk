/**
 * Reveal of the real look (spec §8, v1.1 §G.3, §G.3.1): a hood that kept what it overwrote
 * (Unhooded) puts all of it back exactly, each placed token its own; otherwise Garn's look
 * is built from the real image, pose and draw order. An actor without a Garn look keeps its
 * own. Pure.
 */
import type { Unhooded } from './flags';
import { tokenData } from './geometry';
import { snapshotData } from './hood';
import {
  hasGarnLook,
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
  const flags = doc.flags.garn;
  if (flags.hood && flags.unhooded) return unhood(source, flags.unhooded);
  // v1.1 §G.3.1: an imported look is never changed on its own, its tokens neither.
  if (!hasGarnLook(doc)) {
    const { token } = realPortrait(doc, source.recordImg);
    return flags.original ? { doc: {} } : { doc: {}, tokens: { 'texture.src': token } };
  }
  return garnLookWrites(source);
}

/** The hood's flags cleared and the real image back on the sheet; nothing when unhooded. */
function hoodFlagsCleared({ doc, recordImg }: LookSource): Record<string, unknown> {
  if (!doc.flags.garn.hood) return {};
  return {
    img: realPortrait(doc, recordImg).img,
    'flags.garn.-=img': null,
    'flags.garn.-=token': null,
    'flags.garn.-=hood': null,
    ...(doc.flags.garn.ring ? { 'flags.garn.-=ring': null } : {}),
  };
}

/**
 * Garn's real look: the token image, posed (the subject file with the ring on, the texture
 * anchor without), in the actor's draw order. Placed tokens' snapshots are dropped: the real
 * look is Garn's.
 */
export function garnLookWrites(source: LookSource): PortraitWrites {
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
      ...(doc.flags.garn.unhooded ? { 'flags.garn.-=unhooded': null } : {}),
    },
    tokens: token,
    snapshot: 'drop',
    subject: ring.enabled ? { src: real.token, pose, order: orderOf(doc) } : null,
  };
}

/** Reveal of a hood that stored what it overwrote: all of it back, exactly. */
function unhood(source: LookSource, overwritten: Unhooded): PortraitWrites {
  const { doc } = source;
  const { pose, subject } = doc.flags.garn;
  const token = {
    ...snapshotData(overwritten),
    ...ringData(realRing(doc)),
    'texture.src': realPortrait(doc, source.recordImg).token,
  };
  return {
    doc: {
      ...hoodFlagsCleared(source),
      ...prototypeUpdate(doc, token),
      ...garnFlag('pose', overwritten.pose, pose),
      ...garnFlag('subject', overwritten.garnSubject, subject),
      'flags.garn.-=unhooded': null,
    },
    tokens: token,
    snapshot: 'restore',
  };
}

/** `flags.garn.<key>` back to `value`: set, or cleared when it had none. */
function garnFlag(key: string, value: unknown, now: unknown): Record<string, unknown> {
  if (value !== undefined) return { [`flags.garn.${key}`]: value };
  return now !== undefined ? { [`flags.garn.-=${key}`]: null } : {};
}
