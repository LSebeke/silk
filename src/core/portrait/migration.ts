/**
 * Round 3 migration (v1.1 §G.3.2): 1.1 round 2 wrote the pose into the token texture (ring
 * on: fit cover, ring off: fit contain; the pose scale as texture scale, its anchor as
 * texture anchor) and made no subject file. Such a look gets its pose back as the flag, the
 * subject file (ring on), `ring.subject.scale` 1, the prototype's texture scale 1 and the
 * placed tokens' the size factor (#168; DSA5 sets it only at token creation). Pure.
 */
import { CENTRED, type Pose } from './geometry';
import { hoodWrites } from './hood';
import {
  HOODED_DEFAULT,
  isHooded,
  ringOf,
  type LookSource,
  type PortraitDoc,
  type PortraitWrites,
} from './portrait';
import { silkLookWrites } from './unhood';
import { poseFlag, prototypeUpdate, samePose } from './writes';

/**
 * A round 2 look: Silk's (no Original look, no subject file), the pose in the texture. Ring
 * on: fit cover. Ring off: a texture scale other than 1 (Silk 1.1 round 3 never writes one
 * to the prototype), or a pose flag.
 */
export function isRound2Look(doc: PortraitDoc): boolean {
  const { subject, original, pose } = doc.flags.silk;
  if (subject || original) return false;
  const texture = doc.prototypeToken?.texture;
  if (ringOf(doc.prototypeToken).enabled) return texture?.fit === 'cover';
  return Math.abs(texture?.scaleX ?? 1) !== 1 || !!pose;
}

/** The real pose of a round 2 look: the flag (hooded), else the texture's anchor and scale. */
function round2Pose(doc: PortraitDoc): Pose {
  const { pose } = doc.flags.silk;
  if (pose) return { ...pose };
  if (isHooded(doc)) return { ...CENTRED };
  const texture = doc.prototypeToken?.texture;
  return {
    anchorX: texture?.anchorX ?? CENTRED.anchorX,
    anchorY: texture?.anchorY ?? CENTRED.anchorY,
    scale: Math.abs(texture?.scaleX ?? CENTRED.scale),
  };
}

/** The migration of a round 2 look, as it is shown now; `undefined` for any other look. */
export function round2Writes(source: LookSource): PortraitWrites | undefined {
  const { doc, sizeFactor } = source;
  if (!isRound2Look(doc)) return undefined;
  const pose = round2Pose(doc);
  // Read as if the pose were already in its flag: the look writes then build it as for 1.1.
  const posed: LookSource = samePose(pose, CENTRED)
    ? source
    : { ...source, doc: { ...doc, flags: { silk: { ...doc.flags.silk, pose } } } };
  const writes = isHooded(doc)
    ? hoodWrites(posed, doc.flags.silk.hood ?? HOODED_DEFAULT)
    : silkLookWrites(posed);
  const texture = doc.prototypeToken?.texture;
  const sign = (n: number | undefined) => (n !== undefined && n < 0 ? -1 : 1);
  const scale = (factor: number) => ({
    'texture.scaleX': sign(texture?.scaleX) * factor,
    'texture.scaleY': sign(texture?.scaleY) * factor,
  });
  return {
    ...writes,
    doc: { ...writes.doc, ...prototypeUpdate(doc, scale(1)), ...poseFlag(doc, pose) },
    tokens: { ...writes.tokens, ...scale(sizeFactor) },
  };
}
