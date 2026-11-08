/**
 * Token frame geometry (v1.1 §G.3 "Ring composition", #134): the maths behind Silk's ring
 * shader (src/adapter/token-frame.ts). The image mesh is padded so its quad covers the ring;
 * its corners and the ring UVs are in ring space (0 at the token centre, 1 at the ring's
 * outer edge). Pure.
 */

/** The image mesh as the frame needs it (Foundry SpriteMesh, before its world transform). */
export interface MeshShape {
  /** Texture size (px). */
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  /** Mesh scale (fit times texture scale; negative when mirrored). */
  scaleX: number;
  scaleY: number;
  paddingX: number;
  paddingY: number;
}

/** Padding (texture px) so the mesh quad covers the ring: a square of `size` px, centred. */
export function framePadding(mesh: MeshShape, size: number): { x: number; y: number } {
  const axis = (length: number, anchor: number, scale: number) =>
    Math.max(0, size / 2 / Math.abs(scale || 1) - Math.min(anchor, 1 - anchor) * length);
  return {
    x: axis(mesh.width, mesh.anchorX, mesh.scaleX),
    y: axis(mesh.height, mesh.anchorY, mesh.scaleY),
  };
}

/**
 * The quad's four corners (top left, top right, bottom right, bottom left, as Foundry's
 * vertexData) in ring space: the token centre is 0, the ring's outer edge 1.
 */
export function frameCorners(mesh: MeshShape, size: number): [number, number][] {
  const x1 = -mesh.anchorX * mesh.width - mesh.paddingX;
  const x0 = x1 + mesh.width + 2 * mesh.paddingX;
  const y1 = -mesh.anchorY * mesh.height - mesh.paddingY;
  const y0 = y1 + mesh.height + 2 * mesh.paddingY;
  const r = size / 2;
  const at = (x: number, y: number): [number, number] => [
    (x * mesh.scaleX) / r,
    (y * mesh.scaleY) / r,
  ];
  return [at(x1, y1), at(x0, y1), at(x0, y0), at(x1, y0)];
}

/** The UV of ring-space point `p` in a frame whose corner UVs (TL, TR, BR, BL) are `uvs`. */
export function ringUv(uvs: ArrayLike<number>, [px, py]: [number, number]): [number, number] {
  const u0 = uvs[0] as number;
  const u1 = uvs[2] as number;
  const v0 = uvs[1] as number;
  const v1 = uvs[7] as number;
  return [u0 + ((px + 1) / 2) * (u1 - u0), v0 + ((py + 1) / 2) * (v1 - v0)];
}
