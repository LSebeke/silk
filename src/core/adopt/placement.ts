/**
 * Bulk Adopt placement (spec §6 Placement): a grid centred on a point; a folder tree becomes
 * the same tree of nested Visual Groups (§10.4). Pure, absolute canvas coordinates.
 */
import { FRAME_PAD, FRAME_TITLE, NODE_SIZE, type Size } from '../canvas/groups';
import type { Point } from '../elements';

/** Grid cell: a card plus a gap. */
const CELL = { width: NODE_SIZE.width + 30, height: NODE_SIZE.height + 30 };
/** Gap between sibling frames and between a frame's cards and its subframes. */
const GAP = 30;

/** A folder of docs to adopt. `key` names its Visual Group in the result. */
export interface FolderNode {
  key: string;
  label: string;
  /** Docs directly in this folder (ids or uuids). */
  items: string[];
  children: FolderNode[];
}

export interface PlannedGroup {
  key: string;
  label: string;
  parent: string | null;
  position: Point;
  size: Size;
}

export interface FolderLayout {
  /** Card position per item. */
  positions: Map<string, Point>;
  /** Innermost group key per item. */
  items: Map<string, string>;
  /** Outer groups before inner ones. */
  groups: PlannedGroup[];
}

const columns = (n: number) => Math.max(1, Math.ceil(Math.sqrt(n)));

function gridSize(n: number): Size {
  if (!n) return { width: 0, height: 0 };
  const cols = columns(n);
  const rows = Math.ceil(n / cols);
  return {
    width: cols * CELL.width - (CELL.width - NODE_SIZE.width),
    height: rows * CELL.height - (CELL.height - NODE_SIZE.height),
  };
}

function placeGrid(items: readonly string[], origin: Point, out: Map<string, Point>) {
  const cols = columns(items.length);
  items.forEach((id, i) =>
    out.set(id, {
      x: origin.x + (i % cols) * CELL.width,
      y: origin.y + Math.floor(i / cols) * CELL.height,
    }),
  );
}

/** Bulk Adopts without folders: a grid centred on `center`. */
export function gridLayout(items: readonly string[], center: Point): Map<string, Point> {
  const size = gridSize(items.length);
  const out = new Map<string, Point>();
  placeGrid(items, { x: center.x - size.width / 2, y: center.y - size.height / 2 }, out);
  return out;
}

/** Folder tree → nested frames: each frame holds its cards (grid) above its subframes. */
export function folderLayout(root: FolderNode, center: Point): FolderLayout {
  const layout: FolderLayout = { positions: new Map(), items: new Map(), groups: [] };

  /** Lays `node` out with its frame's top-left at `at`; returns the frame size. */
  function place(node: FolderNode, parent: string | null, at: Point): Size {
    const group: PlannedGroup = {
      key: node.key,
      label: node.label,
      parent,
      position: at,
      size: { width: 0, height: 0 },
    };
    layout.groups.push(group);
    const inner = { x: at.x + FRAME_PAD, y: at.y + FRAME_PAD + FRAME_TITLE };
    const grid = gridSize(node.items.length);
    placeGrid(node.items, inner, layout.positions);
    for (const id of node.items) layout.items.set(id, node.key);
    let x = inner.x;
    const y = inner.y + grid.height + (grid.height && node.children.length ? GAP : 0);
    let childHeight = 0;
    for (const child of node.children) {
      const size = place(child, node.key, { x, y });
      x += size.width + GAP;
      childHeight = Math.max(childHeight, size.height);
    }
    const childWidth = node.children.length ? x - GAP - inner.x : 0;
    const content = {
      width: Math.max(grid.width, childWidth, NODE_SIZE.width),
      height: y - inner.y + childHeight,
    };
    group.size = {
      width: content.width + 2 * FRAME_PAD,
      height: content.height + 2 * FRAME_PAD + FRAME_TITLE,
    };
    return group.size;
  }

  const size = place(root, null, { x: 0, y: 0 });
  // Centre the whole tree on `center`.
  const dx = Math.round(center.x - size.width / 2);
  const dy = Math.round(center.y - size.height / 2);
  for (const [id, p] of layout.positions) layout.positions.set(id, { x: p.x + dx, y: p.y + dy });
  for (const g of layout.groups) g.position = { x: g.position.x + dx, y: g.position.y + dy };
  return layout;
}
