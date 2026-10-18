<script>
  // PROTOTYPE, throwaway. Curved, labelled Connection; parallel ones fan out by data.offset.
  import { BaseEdge, EdgeLabel } from '@xyflow/svelte';
  let { id, sourceX, sourceY, targetX, targetY, data, selected, markerStart, markerEnd } = $props();
  const g = $derived.by(() => {
    const dx = targetX - sourceX, dy = targetY - sourceY, len = Math.hypot(dx, dy) || 1, o = data.offset * 2;
    const cx = (sourceX + targetX) / 2 - (dy / len) * o, cy = (sourceY + targetY) / 2 + (dx / len) * o;
    return { path: `M${sourceX},${sourceY} Q${cx},${cy} ${targetX},${targetY}`, x: (sourceX + 2 * cx + targetX) / 4, y: (sourceY + 2 * cy + targetY) / 4 };
  });
</script>
<BaseEdge {id} path={g.path} {markerStart} {markerEnd} class="story-edge {data.kind === 'free' ? 'free' : 'behav'} {selected ? 'sel' : ''} {data.revealed ? 'rev' : ''}" />
<EdgeLabel x={g.x} y={g.y} class="elabel {data.kind === 'free' ? 'free' : 'behav'} {selected ? 'sel' : ''}">
  {data.dir === 'mutual' ? '⟷ ' : ''}{data.label}{data.revealed ? ' 👁' : ''}
</EdgeLabel>
