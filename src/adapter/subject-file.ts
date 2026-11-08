/**
 * Ring subject files (v1.1 §G.3 "Files", #171): the image, posed and cut to the ring's edge
 * by the one subject geometry (core/portrait), as WebP in
 * `Data/silk/<worldId>/tokens/<actorId>-<hash>.webp`, named by content so no cache shows a
 * stale one. Replaced files stay (Foundry has no delete).
 */
import { sha256Hex } from '../core/canon/portability';
import { subjectBox, subjectCrop, type SubjectSpec } from '../core/portrait';

/** Side of a subject file (px): sharp at any zoom a token is seen at. */
const SUBJECT_PX = 1024;

export interface SubjectFileDeps {
  /** The subject as WebP bytes. */
  draw(spec: SubjectSpec): Promise<Uint8Array>;
  /** Writes a Data path. */
  write(path: string, bytes: Uint8Array): Promise<void>;
  worldId(): string;
}

/** `LookStage.renderSubject`: draws, names by content, uploads; the file's Data path. */
export function createSubjectFiles(deps: SubjectFileDeps) {
  return async function renderSubject(actorUuid: string, spec: SubjectSpec): Promise<string> {
    const bytes = await deps.draw(spec);
    const hash = (await sha256Hex(bytes)).slice(0, 16);
    const actorId = actorUuid.split('.').pop() ?? actorUuid;
    const path = `silk/${deps.worldId()}/tokens/${actorId}-${hash}.webp`;
    await deps.write(path, bytes);
    return path;
  };
}

/** Draws the subject on a canvas: the posed image, transparent outside the crop circle. */
export async function drawSubject(spec: SubjectSpec): Promise<Uint8Array> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = spec.src;
  await image.decode();
  const aspect = (image.naturalWidth || 1) / (image.naturalHeight || 1);
  const { box, circle = 0.5 } = subjectBox(spec.pose, subjectCrop(spec.edges), aspect);
  const n = SUBJECT_PX;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Silk: no 2D canvas for the token subject');
  ctx.drawImage(image, box.left * n, box.top * n, box.width * n, box.height * n);
  // Cut to the circle (anti-aliased, unlike a clip path).
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  ctx.arc(n / 2, n / 2, circle * n, 0, 2 * Math.PI);
  ctx.fill();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.92),
  );
  if (!blob) throw new Error('Silk: token subject not encoded');
  return new Uint8Array(await blob.arrayBuffer());
}
