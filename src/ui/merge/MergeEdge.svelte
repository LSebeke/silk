<script lang="ts">
  /** Connection in the merge canvas diff: World Canvas geometry, coloured by badge. */
  import { BaseEdge, EdgeLabel, useStore, type EdgeProps, type InternalNode } from '@xyflow/svelte';
  import { facingAnchor, type Box } from '../canvas/flow-edges';
  import type { MergeEdge } from './merge-flow';

  let { id, source, target, data, selected, markerEnd }: EdgeProps<MergeEdge> = $props();

  const store = useStore();
  const internal = (nodeId: string) => {
    void store.nodes;
    return store.nodeLookup.get(nodeId);
  };
  const box = (node: InternalNode | undefined): Box | undefined =>
    node && {
      x: node.internals.positionAbsolute.x,
      y: node.internals.positionAbsolute.y,
      width: node.measured.width ?? 190,
      height: node.measured.height ?? 48,
    };
  const colour: Record<string, string> = {
    conflict: '#f1c232',
    added: '#7bbf6a',
    deleted: '#e06666',
    changed: '#e8915a',
    layout: '#e8915a',
    canonOnly: '#6fa8dc',
    same: '#8a8378',
  };
  const geometry = $derived.by(() => {
    const a = box(internal(source));
    const b = box(internal(target));
    if (!a || !b) return undefined;
    const s = facingAnchor(a, b);
    const t = facingAnchor(b, a);
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = (data?.offset ?? 0) * 2;
    const cx = (s.x + t.x) / 2 - (dy / len) * bend;
    const cy = (s.y + t.y) / 2 + (dx / len) * bend;
    return {
      path: `M${s.x},${s.y} Q${cx},${cy} ${t.x},${t.y}`,
      x: (s.x + 2 * cx + t.x) / 4,
      y: (s.y + 2 * cy + t.y) / 4,
    };
  });
  const stroke = $derived(colour[data?.badge ?? 'same'] ?? '#8a8378');
  const text = $derived(data?.label || (data?.type !== 'free' ? data?.type : '') || '');
</script>

{#if geometry}
  <BaseEdge
    {id}
    path={geometry.path}
    {markerEnd}
    interactionWidth={14}
    style="stroke: {stroke}; stroke-width: {selected
      ? 4
      : data?.badge === 'same'
        ? 1.5
        : 2.5};{data?.deleted ? ' stroke-dasharray: 6 4;' : ''}"
  />
  {#if text || data?.badge !== 'same'}
    <EdgeLabel x={geometry.x} y={geometry.y}>
      <span
        class="silk-merge-edge-label"
        style:color={stroke}
        data-silk-merge-edge={id}
        data-silk-merge-badge={data?.badge}>{text}{data?.open ? ` (${data.open}!)` : ''}</span
      >
    </EdgeLabel>
  {/if}
{/if}

<style>
  .silk-merge-edge-label {
    background: #22201dcc;
    padding: 0 0.3em;
    border-radius: 3px;
    font-size: 11px;
    cursor: pointer;
  }
</style>
