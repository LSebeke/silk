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
  import { TWEEN_MS } from '../../core/canvas/tween';
  import type { RelativeDirection } from '../../core/connections';
  import {
    ELEMENT_CLASSES,
    hasStatus,
    nextStatus,
    readElement,
    statusLabelKey,
    type ElementClassId,
    type Point,
    type Status,
  } from '../../core/elements';
  import ClassBox from './ClassBox.svelte';
  import ConnectionEdge from './ConnectionEdge.svelte';
  import ElementCard from './ElementCard.svelte';
  import FilterBar from './FilterBar.svelte';
  import Palette from './Palette.svelte';
  import SearchBox from './SearchBox.svelte';
  import GroupFrame from './GroupFrame.svelte';
  import { pointKind } from './connection-points';
  import { CANVAS_CONTEXT, PALETTE_MIME, type CanvasContext } from './context';
  import { toFlowEdges, type ConnectionEdge as FlowEdge } from './flow-edges';
  import {
    lodForZoom,
    toFlowNodes,
    toGroupNodes,
    type ElementNode,
    type GroupNode,
  } from './flow-model';
  import { canvasKey, confirmKey } from './keys';
  import { STATUS_PROMPT, type StatusPrompt } from './status-prompt';

  let props: { ctx: CanvasContext } = $props();
  /** Fixed for the window's lifetime. */
  const ctx = untrack(() => props.ctx);
  setContext(CANVAS_CONTEXT, ctx);
  const { pipeline, state: canvasState, workingCopy, viewState } = ctx;

  const nodeTypes = { element: ElementCard, frame: GroupFrame } as unknown as NodeTypes;
  const edgeTypes = { connection: ConnectionEdge } as unknown as EdgeTypes;
  const flow = useSvelteFlow();
  const saved = viewState.get().viewport;

  let nodes = $state.raw<(ElementNode | GroupNode)[]>([]);
  let edges = $state.raw<FlowEdge[]>([]);
  /** Canvas Filters (§10.5): only these render. */
  let filtered = $state.raw(ctx.filter.result());
  /** `c` (§10.3): picking the target for a Connection from this Node. */
  let connectFrom = $state<string | undefined>();
  /** Search box open (§10.8, `Ctrl+F`). */
  let searching = $state(false);
  /** Palette open (§10.3). */
  let paletteOpen = $state(false);
  let root: HTMLDivElement | undefined = $state();
  let zoom = $state(saved?.zoom ?? 1);
  let moving = $state(false);
  const lod = $derived(lodForZoom(zoom));

  const fail = (error: unknown) => console.error(error);
  const run = (name: string, args?: object) => ctx.run(name, args).catch(fail);

  // Status toggle, y/n confirm with default n (§10.3 `s`, card chip).
  let statusAsk = $state<{ id: string; name: string; status: Status } | undefined>();
  let statusBox: HTMLDivElement | undefined = $state();
  const statusPrompt: StatusPrompt = {
    ask(id) {
      const element = readElement(workingCopy.get(id));
      if (!element || !hasStatus(element.class) || !ctx.available('element.setStatus')) return;
      statusAsk = { id, name: element.name, status: nextStatus(element) };
      queueMicrotask(() => statusBox?.focus());
    },
  };
  setContext(STATUS_PROMPT, statusPrompt);
  function answerStatus(yes: boolean) {
    const ask = statusAsk;
    statusAsk = undefined;
    root?.focus();
    if (yes && ask) void run('element.setStatus', { id: ask.id, status: ask.status });
  }

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

  // Working copy + selection + filters → Nodes (frames first: parents before children).
  function refresh() {
    const records = workingCopy.records();
    const selection = canvasState.get().selection;
    const filter = ctx.filter.result();
    filtered = filter;
    const prev = untrack(() => nodes);
    nodes = [
      ...toGroupNodes(
        records,
        selection,
        prev.filter((n): n is GroupNode => n.type === 'frame'),
        filter.frames,
      ),
      ...toFlowNodes(
        records,
        selection,
        prev.filter((n): n is ElementNode => n.type === 'element'),
        tween && tweenAt,
        filter,
      ),
    ];
  }
  function refreshEdges() {
    edges = toFlowEdges(
      workingCopy.records(),
      untrack(() => edges),
      ctx.filter.result().visible,
    );
  }
  $effect(() => {
    // Working copy and filter changes (commands, Revealed source) both arrive here.
    const offFilter = ctx.filter.subscribe(() => {
      refresh();
      refreshEdges();
    });
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
      offFilter();
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
    // Absolute: a Node in a frame is positioned relative to it.
    const at = flow.getInternalNode(origin)?.internals.positionAbsolute ?? node?.position;
    const count = edges.filter((e) => e.source === origin || e.target === origin).length;
    return {
      x: (at?.x ?? 0) + 280,
      y: (at?.y ?? 0) + ((count % 5) - 2) * 110,
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
    if (statusAsk) {
      const answer = confirmKey(event);
      event.preventDefault();
      event.stopPropagation();
      if (answer) answerStatus(answer === 'yes');
      return;
    }
    if (event.key === 'Escape' && (connectFrom || searching)) {
      closeSearch();
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
        searching = false;
        connectFrom = node;
        break;
      case 'search':
        connectFrom = undefined;
        searching = true;
        break;
      case 'rename': {
        const current = nodes.find((n): n is ElementNode => n.id === node && n.type === 'element');
        if (node && current) pipeline.rename(node, current.data.name);
        break;
      }
      case 'status':
        if (node) statusPrompt.ask(node);
        break;
      case 'editConnection':
        if (edge) pipeline.editConnection(edge.id);
        break;
      case 'delete':
        void run('element.delete', { ids: canvasState.get().selection });
        break;
      case 'command':
        if (edge) void run(action.name, { id: edge.id });
        break;
      case 'layout':
        // Ctrl+Z with nothing to undo is a no-op (not an error).
        if (ctx.available(action.name)) void run(action.name, {});
        break;
    }
  }

  // --- Search (§10.8), `c` connect search, palette (T25) ---

  function closeSearch() {
    searching = false;
    connectFrom = undefined;
    root?.focus();
  }

  function jumpTo(id: string) {
    closeSearch();
    void run('canvas.jumpTo', { id });
  }

  function connectTo(id: string) {
    const from = connectFrom;
    closeSearch();
    if (from && id !== from) connect(from, id).catch(fail);
  }

  /** "New Node" (§10.3 `c`): direction chosen, the pipeline runs from its class box. */
  function connectNew(direction: RelativeDirection) {
    const from = connectFrom;
    closeSearch();
    if (!from) return;
    const rect = root?.getBoundingClientRect();
    pipeline.open({
      at: besideNode(from),
      anchor: { x: (rect?.width ?? 400) / 2 - 100, y: 80 },
      from,
      connection: { direction },
    });
  }

  // Jumping moves the camera to the Node, keeping the zoom.
  $effect(() =>
    ctx.search.onJump((id) => {
      const p = readElement(workingCopy.get(id))?.position;
      if (p) void flow.setCenter(p.x + 95, p.y + 40, { zoom: flow.getZoom(), duration: 300 });
    }),
  );

  /** Palette drag: the Node under the pointer highlights as the connect target. */
  let dropEl: HTMLElement | undefined;
  function dropTarget(event: DragEvent) {
    const el = (root?.ownerDocument ?? document)
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-silk-node]');
    if (el !== dropEl) {
      dropEl?.classList.remove('silk-drop-target');
      el?.classList.add('silk-drop-target');
      dropEl = el ?? undefined;
    }
    return el?.dataset['silkNode'];
  }
  function onDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes(PALETTE_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    dropTarget(event);
  }
  function onDragLeave(event: DragEvent) {
    if (event.relatedTarget && root?.contains(event.relatedTarget as Node)) return;
    dropEl?.classList.remove('silk-drop-target');
    dropEl = undefined;
  }
  function onDrop(event: DragEvent) {
    const cls = event.dataTransfer?.getData(PALETTE_MIME) as ElementClassId | undefined;
    if (!cls || !ELEMENT_CLASSES.some((c) => c.id === cls)) return;
    event.preventDefault();
    const target = dropTarget(event);
    dropEl?.classList.remove('silk-drop-target');
    dropEl = undefined;
    const origin = target
      ? { at: besideNode(target), from: target }
      : { at: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }) };
    pipeline.create(origin, cls).catch(fail);
  }

  function onNodeClick({ node }: { node: ElementNode | GroupNode }) {
    if (connectFrom) connectTo(node.id);
  }

  function onPaneClick({ event }: { event: MouseEvent }) {
    if (!connectFrom) return pipeline.cancel();
    // "New Node" (§10.3 `c`): the class box at the spot, connected to the origin.
    const from = connectFrom;
    closeSearch();
    pipeline.open({
      at: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      anchor: local(event),
      from,
    });
  }

  /** Node context menu (§10.3): a class box beside the Node creates a connected Node. */
  function onNodeContextMenu({
    event,
    node,
  }: {
    event: MouseEvent;
    node: ElementNode | GroupNode;
  }) {
    // Inside a frame: create there, as on the canvas (the new Node joins the frame).
    if (node.type === 'frame') return onPaneContextMenu({ event });
    event.preventDefault();
    pipeline.open({ at: besideNode(node.id), anchor: local(event), from: node.id });
  }

  function onNodeDragStop({ nodes: dragged }: { nodes: (ElementNode | GroupNode)[] }) {
    // Records hold absolute positions; Nodes in a frame are relative to it.
    const moves = dragged.map((n) => {
      const p = flow.getInternalNode(n.id)?.internals.positionAbsolute ?? n.position;
      return { id: n.id, x: p.x, y: p.y };
    });
    if (moves.length) void run('canvas.moveNodes', { moves });
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
  class:connecting={!!connectFrom}
  bind:this={root}
  tabindex="0"
  onkeydown={onKeydown}
  data-silk-canvas
  data-silk-lod={lod}
  data-silk-connecting={connectFrom}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
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
  <FilterBar {ctx} result={filtered} />
  <div class="silk-canvas-tools">
    <button
      type="button"
      title="{ctx.localize('SILK.Canvas.Search')} (Ctrl+F)"
      onclick={() => {
        connectFrom = undefined;
        searching = !searching;
      }}
      data-silk-action="search"
    >
      <i class="fa-solid fa-magnifying-glass"></i>
    </button>
    <button
      type="button"
      class:active={paletteOpen}
      title={ctx.localize('SILK.Canvas.Palette')}
      onclick={() => (paletteOpen = !paletteOpen)}
      data-silk-action="palette"
    >
      <i class="fa-solid fa-palette"></i>
    </button>
  </div>
  {#if paletteOpen}
    <Palette {ctx} onjump={jumpTo} />
  {/if}
  {#if searching}
    <SearchBox {ctx} mode="search" onpick={jumpTo} onclose={closeSearch} />
  {:else if connectFrom}
    {#key connectFrom}
      <SearchBox
        {ctx}
        mode="connect"
        exclude={connectFrom}
        onpick={connectTo}
        onnew={connectNew}
        onclose={closeSearch}
      />
    {/key}
  {/if}
  {#if selectedAny && !connectFrom}
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
  {#if statusAsk}
    <div
      class="silk-status-confirm"
      role="alertdialog"
      tabindex="-1"
      bind:this={statusBox}
      data-silk-status-confirm={statusAsk.id}
    >
      <span>
        {ctx
          .localize('SILK.Canvas.StatusConfirm')
          .replace('{name}', statusAsk.name)
          .replace('{status}', ctx.localize(statusLabelKey(statusAsk.status)))}
      </span>
      <button type="button" onclick={() => answerStatus(true)} data-silk-action="status-yes">
        {ctx.localize('SILK.Canvas.Yes')}
      </button>
      <button type="button" onclick={() => answerStatus(false)} data-silk-action="status-no">
        {ctx.localize('SILK.Canvas.No')}
      </button>
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
  .silk-canvas-tools {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 15;
    display: flex;
    gap: 4px;
  }
  .silk-canvas-tools button {
    width: 28px;
    height: 28px;
    min-height: 0;
    padding: 0;
    background: #fffdf8;
    border: 1px solid #c9bfa8;
    border-radius: 6px;
  }
  .silk-canvas-tools button.active {
    border-color: #2b6cb0;
  }
  .silk-canvas :global(.silk-drop-target) {
    outline: 3px solid #2b6cb0;
    outline-offset: 2px;
  }
  .silk-status-confirm {
    position: absolute;
    bottom: 12px;
    left: 50%;
    z-index: 30;
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 4px 8px;
    font-size: 12px;
    white-space: nowrap;
    background: #fffdf8;
    border: 1px solid #b5533c;
    border-radius: 6px;
    outline: none;
    box-shadow: 0 1px 3px #0003;
    transform: translateX(-50%);
  }
  .silk-status-confirm button {
    width: auto;
    padding: 0 8px;
    font-size: 12px;
    line-height: 20px;
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
