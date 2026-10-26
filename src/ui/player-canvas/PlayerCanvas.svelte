<script lang="ts">
  /**
   * Player Canvas (spec §9): the Player View at Canon positions, read-only, pan/zoom only.
   * No Focus View, Filters, Status or Reveal UI. View state is per client.
   */
  import {
    SvelteFlow,
    Background,
    type EdgeTypes,
    type NodeTypes,
    type Viewport,
  } from '@xyflow/svelte';
  import { onDestroy, setContext, untrack } from 'svelte';
  import { lodForZoom } from '../canvas/flow-model';
  import { PLAYER_CANVAS_CONTEXT, type PlayerCanvasContext } from './context';
  import PlayerCard from './PlayerCard.svelte';
  import PlayerEdge from './PlayerEdge.svelte';
  import {
    toPlayerEdges,
    toPlayerNodes,
    type PlayerEdge as FlowEdge,
    type PlayerNode,
  } from './player-flow';

  let props: { ctx: PlayerCanvasContext } = $props();
  /** Fixed for the window's lifetime. */
  const ctx = untrack(() => props.ctx);
  setContext(PLAYER_CANVAS_CONTEXT, ctx);

  const nodeTypes = { player: PlayerCard } as unknown as NodeTypes;
  const edgeTypes = { player: PlayerEdge } as unknown as EdgeTypes;
  const saved = ctx.viewport.get();

  let nodes = $state.raw<PlayerNode[]>([]);
  let edges = $state.raw<FlowEdge[]>([]);
  let zoom = $state(untrack(() => saved?.zoom ?? 1));
  const lod = $derived(lodForZoom(zoom));

  function refresh() {
    const view = ctx.view();
    // Keep Svelte Flow's bookkeeping (`measured`) so cards are not re-measured.
    const prev = new Map(nodes.map((n) => [n.id, n]));
    nodes = toPlayerNodes(view, ctx.resolve).map((n) => {
      const old = prev.get(n.id);
      return old ? { ...old, ...n } : n;
    });
    edges = toPlayerEdges(view);
  }
  refresh();
  const off = ctx.watch(refresh);

  let saveView: ReturnType<typeof setTimeout> | undefined;
  let pending: Viewport | undefined;
  function onMoveEnd(_event: unknown, viewport: Viewport) {
    zoom = viewport.zoom;
    pending = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
    clearTimeout(saveView);
    saveView = setTimeout(flush, 500);
  }
  function flush() {
    clearTimeout(saveView);
    if (!pending) return;
    const viewport = pending;
    pending = undefined;
    ctx.viewport.save(viewport).catch((error: unknown) => console.error(error));
  }
  onDestroy(() => {
    off();
    flush();
  });

  function onNodeClick({ node }: { node: PlayerNode }) {
    ctx
      .run('playerCanvas.openDoc', { id: node.id })
      .catch((error: unknown) => console.error(error));
  }
</script>

<div class="silk-player-canvas lod-{lod}" data-silk-player-canvas data-silk-lod={lod}>
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    {edgeTypes}
    nodesDraggable={false}
    nodesConnectable={false}
    elementsSelectable={false}
    onnodeclick={onNodeClick}
    initialViewport={saved}
    fitView={!saved}
    minZoom={0.05}
    maxZoom={2}
    zoomOnDoubleClick={false}
    deleteKey={null}
    colorMode="light"
    onmoveend={onMoveEnd}
  >
    <Background gap={40} />
  </SvelteFlow>
  {#if !nodes.length}
    <div class="empty" data-silk-player-empty>{ctx.localize('SILK.PlayerCanvas.Empty')}</div>
  {/if}
</div>

<style>
  .silk-player-canvas {
    position: relative;
    width: 100%;
    height: 100%;
    color: #222;
    background: #f4efe4;
  }
  .silk-player-canvas :global(.svelte-flow) {
    background: #f4efe4;
  }
  .empty {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-style: italic;
    color: #666;
    pointer-events: none;
  }
</style>
