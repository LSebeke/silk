/**
 * `element.setImage` on an actor/item doc (v1.1 §G.3): an editor commit. Hooded: the image,
 * token texture, ring and pose wait in the flags, players keep seeing the hood in its ring
 * (#182); Lock rotation applies at once. Pure.
 */
import { clampScale, tokenData, type Pose } from './geometry';
import {
  HOODED_DEFAULT,
  isHooded,
  lookOf,
  realPortrait,
  type ImageEdit,
  type LookSource,
  type PortraitWrites,
  type Ring,
} from './portrait';
import {
  hoodSubject,
  hoodTokenData,
  orderFlag,
  poseFlag,
  prototypeUpdate,
  ringData,
  ringFlag,
} from './writes';

/**
 * The writes for `edit`. `tokens` only when the edit touches the token, or a new image the
 * token follows (#166). Lock rotation is no look edit (#181): alone, it writes only itself.
 */
export function imageWrites(source: LookSource, edit: ImageEdit): PortraitWrites {
  const { doc } = source;
  const hooded = isHooded(doc);
  const flags = doc.flags.silk;
  const look = lookOf(source);
  const img = edit.img ?? look.img;
  const data: Record<string, unknown> = {};
  if (edit.img !== undefined && edit.img !== (hooded ? flags.img : doc.img))
    data[hooded ? 'flags.silk.img' : 'img'] = edit.img;
  // #166: a token "same as sheet image" follows a new sheet image. The doc, not the record,
  // says what the token follows: on the merge path the record already has the new image.
  const onDoc = realPortrait(doc);
  const follows = onDoc.token === onDoc.img && edit.img !== undefined && edit.img !== onDoc.img;
  const { lockRotation, ...lookEdit } = edit.token ?? {};
  const rotation = lockRotation !== undefined ? { lockRotation } : {};
  const edited = Object.keys(lookEdit).length > 0;
  const t = edited ? lookEdit : follows ? { sameAsImage: true } : undefined;
  if (!t) {
    if (lockRotation === undefined) return { doc: data };
    return { doc: { ...data, ...prototypeUpdate(doc, rotation) }, tokens: rotation };
  }

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
  const ringOn = ring.enabled;
  const flagData = { ...poseFlag(doc, pose), ...orderFlag(doc, order) };

  if (hooded) {
    if (src !== flags.token) data['flags.silk.token'] = src;
    // A token edit (the editor) makes the real look Silk's: Reveal builds it, no restore.
    const silkLook = edited;
    if (silkLook && flags.unhooded) data['flags.silk.-=unhooded'] = null;
    const hood = flags.hood ?? HOODED_DEFAULT;
    const token = { ...rotation, ...hoodTokenData(hood) };
    return {
      doc: { ...data, ...ringFlag(doc, ring), ...prototypeUpdate(doc, token), ...flagData },
      tokens: token,
      ...(silkLook ? { snapshot: 'drop' as const } : {}),
      subject: hoodSubject(hood, order),
    };
  }
  const token = { 'texture.src': src, ...ringData(ring), ...rotation, ...tokenData(pose, ringOn) };
  return {
    doc: { ...data, ...prototypeUpdate(doc, token), ...flagData },
    tokens: token,
    subject: ringOn ? { src, pose, order } : null,
  };
}
