<script lang="ts">
  /**
   * World Canvas (spec §10). Svelte Flow over the working copy. Every action runs a command;
   * this component only maps Svelte Flow events to commands and pipeline calls.
   * Never set `onlyRenderVisibleElements`: it makes fast panning worse (§10.2).
   */
  import {
    SvelteFlow,
    Background,
    ConnectionMode,
    useSvelteFlow,
    type EdgeTypes,
    type NodeTypes,
    type OnConnectEnd,
    type Viewport,
  } from '@xyflow/svelte';
  import { onDestroy, setContext, untrack } from 'svelte';
  import type { RelativeDirection } from '../../core/connections';
  import ClassBox from './ClassBox.svelte';
  import ConnectionEdge from './ConnectionEdge.svelte';
  import ElementCard from './ElementCard.svelte';
  import { pointKind } from './connection-points';
  import { CANVAS_CONTEXT, type CanvasContext } from './context';
  import { toFlowEdges, type ConnectionEdge as FlowEdge } from './flow-edges';
  import { lodForZoom, toFlowNodes, type ElementNode } from './flow-model';
  import { canvasKey } from './keys';

  let props: { ctx: CanvasContext } = $props();
  /** Fixed for the window's lifetime. */
  const ctx = untrack(() => props.ctx);
  setContext(CANVAS_CONTEXT, ctx);
  const { pipeline, state: canvasState, workingCopy, viewState } = ctx;

  const nodeTypes = { element: ElementCard } as unknown as NodeTypes;
  const edgeTypes = { connection: ConnectionEdge } as unknown as EdgeTypes;
  const flow = useSvelteFlow();
  const saved = viewState.get().viewport;

  let nodes = $state.raw<ElementNode[]>([]);
  let edges = $state.raw<FlowEdge[]>([]);
  /** `c` (§10.3): picking the target for a Connection from this Node. */
  let connectFrom = $state<string | undefined>();
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
    const offEdges = workingCopy.subscribe((records) => {
      edges = toFlowEdges(
        records,
        untrack(() => edges),
      );
    });
    return () => {
      offRecords();
      offState();
      offEdges();
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

  // --- Connections (T7) ---

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = root?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };
  const nodeAt = (event: { clientX: number; clientY: number }) =>
    (root?.ownerDocument ?? document)
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-silk-node]')?.dataset['silkNode'];

  /** Connect two existing Nodes, then open the Connection editor (§10.3). */
  async function connect(from: string, to: string, direction: RelativeDirection = 'out') {
    const { id } = (await ctx.run('connection.create', { from, to, direction })) as { id: string };
    pipeline.editConnection(id);
  }

  /** Drag-out from a Connection Point: onto a Node connects, onto the canvas opens the class box. */
  const onConnectEnd: OnConnectEnd = (event, state) => {
    const from = state.fromNode?.id;
    if (!from) return;
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    if (!point) return;
    const direction = pointKind(state.fromHandle?.id);
    const to = state.toNode?.id ?? nodeAt(point);
    if (to === from) return;
    if (to) {
      connect(from, to, direction).catch(fail);
      return;
    }
    pipeline.open({
      at: flow.screenToFlowPosition({ x: point.clientX, y: point.clientY }),
      anchor: local(point),
      from,
      connection: { direction },
    });
  };

  /** Where a Node created from `origin` goes: to its right, stacked by existing Connections. */
  function besideNode(origin: string) {
    const node = nodes.find((n) => n.id === origin);
    const count = edges.filter((e) => e.source === origin || e.target === origin).length;
    return {
      x: (node?.position.x ?? 0) + 280,
      y: (node?.position.y ?? 0) + ((count % 5) - 2) * 110,
    };
  }

  function viewCenter() {
    const rect = root?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return flow.screenToFlowPosition({
      x: rect.left + rect.width / 2 - 95,
      y: rect.top + rect.height / 2 - 40,
    });
  }

  function onKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable]')) return;
    if (event.key === 'Escape' && connectFrom) {
      connectFrom = undefined;
      return;
    }
    if ($pipeline.step !== 'idle') return;
    const node = canvasState.get().selection.at(-1);
    const edge = edges.find((e) => e.selected);
    const action = canvasKey(event, { node: !!node, edge: !!edge });
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    switch (action.kind) {
      case 'create':
        pipeline
          .create(
            node
              ? {
                  at: besideNode(node),
                  from: node,
                  ...(action.connection ? { connection: action.connection } : {}),
                }
              : { at: viewCenter() },
            action.class,
          )
          .catch(fail);
        break;
      case 'connect':
        connectFrom = node;
        break;
      case 'rename': {
        const current = nodes.find((n) => n.id === node);
        if (node && current) pipeline.rename(node, current.data.name);
        break;
      }
      case 'editConnection':
        if (edge) pipeline.editConnection(edge.id);
        break;
      case 'command':
        if (edge) void run(action.name, { id: edge.id });
        break;
    }
  }

  function onNodeClick({ node }: { node: ElementNode }) {
    if (!connectFrom) return;
    const from = connectFrom;
    connectFrom = undefined;
    if (node.id !== from) connect(from, node.id).catch(fail);
  }

  function onPaneClick({ event }: { event: MouseEvent }) {
    if (!connectFrom) return pipeline.cancel();
    // "New Node" (§10.3 `c`): the class box at the spot, connected to the origin.
    const from = connectFrom;
    connectFrom = undefined;
    pipeline.open({
      at: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      anchor: local(event),
      from,
    });
  }

  /** Node context menu (§10.3): a class box beside the Node creates a connected Node. */
  function onNodeContextMenu({ event, node }: { event: MouseEvent; node: ElementNode }) {
    event.preventDefault();
    pipeline.open({ at: besideNode(node.id), anchor: local(event), from: node.id });
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

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions -->
<div
  class="silk-canvas lod-{lod}"
  class:moving
  class:connecting={!!connectFrom}
  bind:this={root}
  tabindex="0"
  onkeydown={onKeydown}
  data-silk-canvas
  data-silk-lod={lod}
  data-silk-connecting={connectFrom}
>
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    {edgeTypes}
    connectionMode={ConnectionMode.Loose}
    onbeforeconnect={() => false}
    onconnectend={onConnectEnd}
    onnodeclick={onNodeClick}
    onnodecontextmenu={onNodeContextMenu}
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
    onpaneclick={onPaneClick}
    onnodedragstop={onNodeDragStop}
    onselectionchange={onSelectionChange}
  >
    <Background gap={40} />
  </SvelteFlow>
  <ClassBox />
  {#if connectFrom}
    <div class="silk-connect-hint" data-silk-connect-hint>
      {ctx.localize('SILK.Canvas.ConnectHint')}
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
  .silk-canvas :global(.svelte-flow) {
    background: #f4efe4;
  }
  .silk-connect-hint {
    position: absolute;
    top: 8px;
    left: 50%;
    z-index: 20;
    padding: 4px 10px;
    font-size: 12px;
    background: #fffdf8;
    border: 1px solid #2b6cb0;
    border-radius: 6px;
    transform: translateX(-50%);
  }
  .silk-canvas.connecting :global(.silk-card) {
    cursor: crosshair;
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
