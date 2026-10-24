/**
 * Untangle layout (spec §10.7): dagre, left-to-right, over the selected Nodes and the
 * Connections between them, centred on the selection's centroid. dagre loads on first use
 * so it stays out of the entry bundle.
 */
import { CONNECTION_ENDPOINTS, type Snapshot } from '../canon';
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
  const [fromKey, toKey] = CONNECTION_ENDPOINTS;
  for (const record of records.values()) {
    if (record.kind !== 'connection') continue;
    const from = record.data[fromKey];
    const to = record.data[toKey];
    if (typeof from !== 'string' || typeof to !== 'string') continue;
    if (from === to || !selected.has(from) || !selected.has(to)) continue;
    graph.setEdge(from, to, {}, record.id);
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
