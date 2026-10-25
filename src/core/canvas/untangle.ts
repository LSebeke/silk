/**
 * Untangle layout (spec §10.7): dagre, left-to-right, over the selected Nodes and the
 * Connections between them, centred on the selection's centroid. dagre loads on first use
 * so it stays out of the entry bundle.
 */
import type { Snapshot } from '../canon';
import { readConnection } from '../connections/connection';
import type { Point } from '../elements/element';
import { NODE_SIZE } from './groups';

/** New top-left positions for `ids` (elements in `records`). */
export async function untangleLayout(
  records: Snapshot,
  ids: readonly string[],
): Promise<Map<string, Point>> {
  const { graphlib, layout } = await import('@dagrejs/dagre');
  const graph = new graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90 });
  graph.setDefaultEdgeLabel(() => ({}));
  const selected = new Set(ids);
  for (const id of ids) graph.setNode(id, { ...NODE_SIZE });
  for (const record of records.values()) {
    const c = readConnection(record);
    // A mutual Connection's from/to is just an order; it still ranks left to right.
    if (!c || c.from === c.to || !selected.has(c.from) || !selected.has(c.to)) continue;
    graph.setEdge(c.from, c.to, {}, c.id);
  }
  layout(graph);

  const old = ids.map(
    (id) => (records.get(id)?.data['position'] as Point | undefined) ?? { x: 0, y: 0 },
  );
  const laid = new Map(
    ids.map((id) => {
      const node = graph.node(id);
      return [id, { x: node.x - NODE_SIZE.width / 2, y: node.y - NODE_SIZE.height / 2 }];
    }),
  );
  const mean = (ps: Point[], k: 'x' | 'y') => ps.reduce((s, p) => s + p[k], 0) / ps.length;
  const dx = mean(old, 'x') - mean([...laid.values()], 'x');
  const dy = mean(old, 'y') - mean([...laid.values()], 'y');
  return new Map([...laid].map(([id, p]) => [id, { x: p.x + dx, y: p.y + dy }]));
}
