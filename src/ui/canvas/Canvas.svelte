<script lang="ts">
  /**
   * World Canvas (spec §10). Svelte Flow over the working copy. Every action runs a command;
   * this component only maps Svelte Flow events to commands and pipeline calls.
   * Never set `onlyRenderVisibleElements`: it makes fast panning worse (§10.2).
   */
  import {
    SvelteFlow,
    Background,
    useSvelteFlow,
    type Edge,
    type NodeTypes,
    type Viewport,
  } from '@xyflow/svelte';
  import { onDestroy, setContext, untrack } from 'svelte';
  import ClassBox from './ClassBox.svelte';
  import ElementCard from './ElementCard.svelte';
  import { CANVAS_CONTEXT, type CanvasContext } from './context';
  import { lodForZoom, toFlowNodes, type ElementNode } from './flow-model';

  let props: { ctx: CanvasContext } = $props();
  /** Fixed for the window's lifetime. */
  const ctx = untrack(() => props.ctx);
  setContext(CANVAS_CONTEXT, ctx);
  const { pipeline, state: canvasState, workingCopy, viewState } = ctx;

  const nodeTypes = { element: ElementCard } as unknown as NodeTypes;
  const flow = useSvelteFlow();
  const saved = viewState.get().viewport;

  let nodes = $state.raw<ElementNode[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let root: HTMLDivElement | undefined = $state();
  let zoom = $state(saved?.zoom ?? 1);
  let moving = $state(false);
  const lod = $derived(lodForZoom(zoom));

  const fail = (error: unknown) => console.error(error);
  const run = (name: string, args?: object) => ctx.run(name, args).catch(fail);

  // Working copy + selection → Nodes.
  $effect(() => {
    const refresh = () => {
      nodes = toFlowNodes(
        workingCopy.records(),
        canvasState.get().selection,
        untrack(() => nodes),
      );
    };
    const offRecords = workingCopy.subscribe(refresh);
    const offState = canvasState.subscribe(refresh);
    return () => {
      offRecords();
      offState();
    };
  });

  // Detail drop while moving (§10.2): blank blocks until 150 ms after the viewport stops.
  let moveEnd: ReturnType<typeof setTimeout> | undefined;
  let saveView: ReturnType<typeof setTimeout> | undefined;
  let pendingViewport: Viewport | undefined;
  function onMoveStart() {
    clearTimeout(moveEnd);
    if (ctx.detailDrop) moving = true;
  }
  function onMoveEnd(_event: unknown, viewport: Viewport) {
    zoom = viewport.zoom;
    clearTimeout(moveEnd);
    moveEnd = setTimeout(() => (moving = false), 150);
    pendingViewport = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
    clearTimeout(saveView);
    saveView = setTimeout(flushView, 500);
  }
  function flushView() {
    clearTimeout(saveView);
    if (!pendingViewport) return;
    const viewport = pendingViewport;
    pendingViewport = undefined;
    viewState.update({ viewport }).catch(fail);
  }
  onDestroy(() => {
    clearTimeout(moveEnd);
    flushView();
  });

  function onPaneContextMenu({ event }: { event: MouseEvent }) {
    event.preventDefault();
    if (!root) return;
    const rect = root.getBoundingClientRect();
    pipeline.open({
      at: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      anchor: { x: event.clientX - rect.left, y: event.clientY - rect.top },
    });
  }

  function onNodeDragStop({ nodes: dragged }: { nodes: ElementNode[] }) {
    const moves = dragged.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
    if (moves.length) void run('canvas.moveNodes', { moves });
  }

  function onSelectionChange({ nodes: selected }: { nodes: ElementNode[] }) {
    const ids = selected.map((n) => n.id);
    const current = canvasState.get().selection;
    if (ids.length === current.length && ids.every((id) => current.includes(id))) return;
    void run('canvas.select', { ids });
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="silk-canvas lod-{lod}"
  class:moving
  bind:this={root}
  tabindex="0"
  data-silk-canvas
  data-silk-lod={lod}
>
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    initialViewport={saved}
    fitView={!saved}
    minZoom={0.05}
    maxZoom={2}
    zoomOnDoubleClick={false}
    deleteKey={null}
    colorMode="light"
    onmovestart={onMoveStart}
    onmoveend={onMoveEnd}
    onpanecontextmenu={onPaneContextMenu}
    onpaneclick={() => pipeline.cancel()}
    onnodedragstop={onNodeDragStop}
    onselectionchange={onSelectionChange}
  >
    <Background gap={40} />
  </SvelteFlow>
  <ClassBox />
</div>

<style>
  .silk-canvas {
    position: relative;
    width: 100%;
    height: 100%;
    outline: none;
    color: #222;
    background: #f4efe4;
  }
  .silk-canvas :global(.svelte-flow) {
    background: #f4efe4;
  }
  /* Detail drop: paint only, no reflow; Connections and labels hidden. */
  .silk-canvas.moving :global(.silk-card) {
    background: var(--silk-class);
    border-color: var(--silk-class);
    box-shadow: none;
  }
  .silk-canvas.moving :global(.silk-card > *) {
    visibility: hidden;
  }
  .silk-canvas.moving :global(.svelte-flow__edges),
  .silk-canvas.moving :global(.svelte-flow__edgelabel-renderer) {
    visibility: hidden;
  }
</style>
