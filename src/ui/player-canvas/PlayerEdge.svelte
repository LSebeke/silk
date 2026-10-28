<script lang="ts">
  /** Player Canvas Connection (spec §9): the GM edge's geometry and label, read-only. */
  import { BaseEdge, EdgeLabel, useStore, type EdgeProps, type InternalNode } from '@xyflow/svelte';
  import { getContext } from 'svelte';
  import { facingAnchor, type Box } from '../canvas/flow-edges';
  import { PLAYER_CANVAS_CONTEXT, type PlayerCanvasContext } from './context';
  import type { PlayerEdge } from './player-flow';

  let { id, source, target, data, markerEnd }: EdgeProps<PlayerEdge> = $props();

  const ctx = getContext<PlayerCanvasContext>(PLAYER_CANVAS_CONTEXT);
  const store = useStore();
  const internal = (id: string) => {
    void store.nodes;
    return store.nodeLookup.get(id);
  };
  const behavioural = $derived(data?.type !== 'free');
  const text = $derived(
    behavioural
      ? ctx.localize(`SILK.Connection.Type.${data?.type}`)
      : data?.label || (data?.direction === 'mutual' ? '—' : '→'),
  );
  const box = (node: InternalNode | undefined): Box | undefined =>
    node && {
      x: node.internals.positionAbsolute.x,
      y: node.internals.positionAbsolute.y,
      width: node.measured.width ?? 190,
      height: node.measured.height ?? 78,
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
</script>

{#if geometry}
  <BaseEdge
    {id}
    path={geometry.path}
    {markerEnd}
    class={['silk-edge', behavioural ? 'behavioural' : 'free']}
  />
  <EdgeLabel
    x={geometry.x}
    y={geometry.y}
    class={['silk-edge-label', 'silk-player-edge-label', behavioural ? 'behavioural' : 'free']}
    data-silk-player-edge={id}
    data-silk-edge-from={source}
    data-silk-edge-to={target}
  >
    {data?.direction === 'mutual' ? '⟷ ' : ''}{text}
  </EdgeLabel>
{/if}

<style>
  :global(.silk-player-edge-label.silk-edge-label) {
    cursor: default;
  }
</style>
