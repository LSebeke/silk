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
  import type { Point } from '../../core/elements';
  import { TWEEN_MS } from '../../core/canvas/tween';
  import ClassBox from './ClassBox.svelte';
  import ElementCard from './ElementCard.svelte';
  import GroupFrame from './GroupFrame.svelte';
  import { CANVAS_CONTEXT, type CanvasContext } from './context';
  import {
    lodForZoom,
    toFlowNodes,
    toGroupNodes,
    type ElementNode,
    type GroupNode,
  } from './flow-model';

  let props: { ctx: CanvasContext } = $props();
  /** Fixed for the window's lifetime. */
  const ctx = untrack(() => props.ctx);
  setContext(CANVAS_CONTEXT, ctx);
  const { pipeline, state: canvasState, workingCopy, viewState } = ctx;

  const nodeTypes = { element: ElementCard, frame: GroupFrame } as unknown as NodeTypes;
  const flow = useSvelteFlow();
  const saved = viewState.get().viewport;

  let nodes = $state.raw<(ElementNode | GroupNode)[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let root: HTMLDivElement | undefined = $state();
  let zoom = $state(saved?.zoom ?? 1);
  let moving = $state(false);
  const lod = $derived(lodForZoom(zoom));

  const fail = (error: unknown) => console.error(error);
  const run = (name: string, args?: object) => ctx.run(name, args).catch(fail);

  // Untangle tween (§10.7): from the announced old positions to the records' positions.
  let tween: { from: ReadonlyMap<string, Point>; start: number } | undefined;
  let tweenFrame = 0;
  function tweenAt(id: string): Point | undefined {
    const from = tween?.from.get(id);
    const to = from && workingCopy.get(id)?.data['position'];
    if (!tween || !from || !to) return undefined;
    const t = Math.min(1, (performance.now() - tween.start) / TWEEN_MS);
    const k = 1 - (1 - t) ** 3;
    const { x, y } = to as unknown as Point;
    return { x: from.x + (x - from.x) * k, y: from.y + (y - from.y) * k };
  }

  // Working copy + selection → Nodes (Visual Group frames first: parents before children).
  function refresh() {
    const records = workingCopy.records();
    const selection = canvasState.get().selection;
    const prev = untrack(() => nodes);
    nodes = [
      ...toGroupNodes(
        records,
        selection,
        prev.filter((n): n is GroupNode => n.type === 'frame'),
      ),
      ...toFlowNodes(
        records,
        selection,
        prev.filter((n): n is ElementNode => n.type === 'element'),
        tween && tweenAt,
      ),
    ];
  }
  $effect(() => {
    const offRecords = workingCopy.subscribe(refresh);
    const offState = canvasState.subscribe(refresh);
    const offTween = ctx.layoutTween.subscribe((from) => {
      const win = root?.ownerDocument.defaultView ?? window;
      tween = { from, start: performance.now() };
      win.cancelAnimationFrame(tweenFrame);
      const step = () => {
        if (!tween) return;
        if (performance.now() - tween.start >= TWEEN_MS) tween = undefined;
        refresh();
        if (tween) tweenFrame = win.requestAnimationFrame(step);
      };
      tweenFrame = win.requestAnimationFrame(step);
    });
    return () => {
      offRecords();
      offState();
      offTween();
      tween = undefined;
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

  function onNodeDragStop({ nodes: dragged }: { nodes: (ElementNode | GroupNode)[] }) {
    // Records hold absolute positions; Nodes in a frame are relative to it.
    const moves = dragged.map((n) => {
      const p = flow.getInternalNode(n.id)?.internals.positionAbsolute ?? n.position;
      return { id: n.id, x: p.x, y: p.y };
    });
    if (moves.length) void run('canvas.moveNodes', { moves });
  }

  /** Right-click inside a frame creates there (the new Node joins the frame). */
  function onNodeContextMenu({ event, node }: { event: MouseEvent; node: { type?: string } }) {
    if (node.type === 'frame') onPaneContextMenu({ event });
  }

  // Selection keys (§10.3), only while the canvas has focus: Foundry keybindings do not reach
  // a detached window, and Ctrl+Z must stay Foundry's elsewhere.
  function onKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable]')) return;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (plain && event.key === 'g') void run('canvas.group', {});
    else if (plain && event.key === 'u') void run('canvas.untangle', {});
    else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === 'z') {
      if (!ctx.available('canvas.undo')) return;
      void run('canvas.undo');
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }

  const selectedElements = $derived(nodes.filter((n) => n.selected && n.type === 'element').length);
  const selectedAny = $derived(nodes.some((n) => n.selected));

  function onSelectionChange({ nodes: selected }: { nodes: (ElementNode | GroupNode)[] }) {
    const ids = selected.map((n) => n.id);
    const current = canvasState.get().selection;
    if (ids.length === current.length && ids.every((id) => current.includes(id))) return;
    void run('canvas.select', { ids });
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions -->
<div
  class="silk-canvas lod-{lod}"
  class:moving
  bind:this={root}
  tabindex="0"
  data-silk-canvas
  data-silk-lod={lod}
  onkeydown={onKeydown}
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
    onnodecontextmenu={onNodeContextMenu}
    onselectionchange={onSelectionChange}
  >
    <Background gap={40} />
  </SvelteFlow>
  <ClassBox />
  {#if selectedAny}
    <div class="silk-selection-toolbar" data-silk-selection-toolbar>
      <button type="button" onclick={() => run('canvas.group', {})} data-silk-action="group">
        {ctx.localize('SILK.Canvas.Group')} <kbd>g</kbd>
      </button>
      {#if selectedElements >= 2}
        <button
          type="button"
          onclick={() => run('canvas.untangle', {})}
          data-silk-action="untangle"
        >
          {ctx.localize('SILK.Canvas.Untangle')} <kbd>u</kbd>
        </button>
      {/if}
    </div>
  {/if}
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
  .silk-selection-toolbar {
    position: absolute;
    top: 8px;
    left: 50%;
    z-index: 10;
    display: flex;
    gap: 4px;
    padding: 4px;
    background: #fffdf8;
    border: 1px solid #c9bfa8;
    border-radius: 6px;
    box-shadow: 0 1px 3px #0003;
    transform: translateX(-50%);
  }
  .silk-selection-toolbar button {
    width: auto;
    padding: 2px 8px;
    font-size: 12px;
    line-height: 20px;
    white-space: nowrap;
  }
  .silk-selection-toolbar kbd {
    margin-left: 4px;
    font-size: 10px;
    opacity: 0.7;
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
