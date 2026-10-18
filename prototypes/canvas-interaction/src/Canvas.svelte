<script>
  // PROTOTYPE, throwaway. Three interaction variants on one canvas, switched from the bottom bar (Alt+←/→).
  import { SvelteFlow, Background, MiniMap, Controls, useSvelteFlow, useViewport } from '@xyflow/svelte';
  import Card from './Card.svelte';
  import Frame from './Frame.svelte';
  import StoryEdge from './StoryEdge.svelte';
  import EdgeCanvas from './EdgeCanvas.svelte';
  import { store, VARIANTS } from './store.svelte.js';
  import { CLASSES, CLASS_NAMES, canFlip } from './model.js';

  const nodeTypes = { card: Card, frame: Frame }, edgeTypes = { story: StoryEdge };
  const flow = useSvelteFlow(), viewport = useViewport();
  globalThis.silkProtoFlow = flow; // test hook
  const V = $derived(store.variant);
  let root = $state();
  let menu = $state(null); // { kind, x, y, ... } in root-local px
  let fps = $state(0), bench = $state('');

  // #17: bench driver (fast pan dispatches on the pane) + "moving" flag that ends 150 ms after the viewport stops
  $effect(() => {
    store.driver = { el: () => root.querySelector('.svelte-flow__pane'), view1: async () => {
      const fr = store.nodes.filter(n => n.type === 'frame'), x1 = Math.min(...fr.map(n => n.position.x)), y1 = Math.min(...fr.map(n => n.position.y));
      const x2 = Math.max(...fr.map(n => n.position.x + n.width)), y2 = Math.max(...fr.map(n => n.position.y + n.height)), r = root.getBoundingClientRect();
      await flow.setViewport({ x: r.width / 2 - (x1 + x2) / 2, y: r.height / 2 - (y1 + y2) / 2, zoom: 1 }); } };
    return () => { store.driver = null; };
  });
  let moveEnd;
  const onMoveStart = () => { clearTimeout(moveEnd); if (!store.moving) store.moving = true; };
  const onMoveEnd = () => { clearTimeout(moveEnd); moveEnd = setTimeout(() => (store.moving = false), 150); };

  $effect(() => { const z = viewport.current.zoom; store.zoom = z; store.lod = z > 0.75 ? 'full' : z > 0.35 ? 'mid' : 'low'; });
  $effect(() => { let n = 0, t0 = performance.now(), raf; const tick = t => { n++; if (t - t0 > 500) { fps = Math.round((n * 1000) / (t - t0)); n = 0; t0 = t; } raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf); });

  const pt = e => (e.changedTouches?.[0] ?? e);
  const local = e => { const r = root.getBoundingClientRect(), p = pt(e); return { x: p.clientX - r.left, y: p.clientY - r.top }; };
  const toFlow = e => { const p = pt(e); return flow.screenToFlowPosition({ x: p.clientX, y: p.clientY }); };
  const under = (e, type) => { const p = pt(e); return document.elementFromPoint(p.clientX, p.clientY)?.closest(`.svelte-flow__node-${type}`)?.dataset.id ?? null; };
  const selNodes = () => store.nodes.filter(n => n.selected && n.type === 'card');
  const selEdges = () => store.edges.filter(e => e.selected);
  const close = () => (menu = null);
  const focusEl = el => { queueMicrotask(() => el.focus()); };
  const edgeInfo = id => { const e = store.edge(id); return e && { e, flip: canFlip(e.data.kind, store.node(e.source).data.cls, store.node(e.target).data.cls) }; };

  function pickClass(cls) {
    const m = menu; close();
    if (m.origin) store.createConnected(m.origin, cls, m.flow);
    else store.addElement(cls, m.flow, m.parent);
  }
  function onConnectEnd(event, state) {
    if (V !== 'A' || state.isValid) return;
    const from = state.fromNode?.id, target = under(event, 'card');
    if (target && target !== from) return store.connect(from, target);
    menu = { kind: 'classes', ...local(event), origin: from, flow: toFlow(event) };
  }
  function onPaneDbl(e) {
    if (!e.target.closest('.svelte-flow__pane') && !e.target.closest('.frame')) return;
    if (V === 'B') return;
    menu = { kind: 'classes', ...local(e), flow: toFlow(e), parent: under(e, 'frame') };
  }
  function onNodeClick({ node }) {
    if (store.connectFrom && node.type === 'card') { store.connect(store.connectFrom, node.id); store.connectFrom = null; }
  }

  // Variant B: keyboard-first.
  function prompt(kind, extra = {}) {
    const n = extra.origin && store.node(extra.origin), r = root.getBoundingClientRect();
    const at = n ? flow.flowToScreenPosition(store.abs(n)) : { x: r.left + r.width / 2 - 150, y: r.top + r.height / 3 };
    menu = { kind: 'prompt', mode: kind, x: at.x - r.left + (n ? 220 : 0), y: at.y - r.top, ...extra };
  }
  function onPromptKey(e) {
    e.stopPropagation();
    if (e.key === 'Escape') return close();
    if (e.key !== 'Enter') return;
    const v = e.currentTarget.value.trim(), m = menu; close(); root.focus();
    if (m.mode === 'label') return store.setLabel(m.edge, v);
    if (m.mode === 'group') return store.groupSelected(v || 'New group');
    const cls = CLASS_NAMES[+v[0] - 1]; if (!cls) return store.note('start with a class digit 1–9');
    const title = v.slice(1).trim();
    const id = m.mode === 'connected' ? store.createConnected(m.origin, cls) : store.addElement(cls, flow.screenToFlowPosition({ x: root.getBoundingClientRect().left + m.x + 150, y: root.getBoundingClientRect().top + m.y }));
    if (title) { store.rename(id, title); store.editing = null; }
    flow.setCenter(store.abs(store.node(id)).x + 100, store.abs(store.node(id)).y + 40, { zoom: Math.max(store.zoom, 0.8), duration: 250 });
  }
  function onKey(e) {
    if (e.target.closest('input, textarea, [contenteditable]')) return;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); return cycleVariant(e.key === 'ArrowLeft' ? -1 : 1); }
    if (e.key === 'Escape') { store.connectFrom = null; close(); }
    if (e.key === 'g') { e.stopPropagation(); return V === 'B' ? prompt('group') : store.groupSelected(); }
    if (V !== 'B') return;
    e.stopPropagation(); // keep Foundry's keybindings out of the canvas
    const [n] = selNodes(), [ed] = selEdges();
    const k = e.key;
    if (k === 'Tab' && n) { e.preventDefault(); prompt('connected', { origin: n.id }); }
    else if (k === 'n' || k === '/') { e.preventDefault(); prompt('new'); }
    else if (n && k === 'c') { store.connectFrom = n.id; store.note('connect: click the target'); }
    else if (n && k === 'e') store.editing = n.id;
    else if (n && 'dhq'.includes(k)) store.toggleStatus(n.id, { d: 'dead', h: 'happened', q: 'quest' }[k]);
    else if (k === 'r' && (n || ed)) store.toggleReveal((n ?? ed).id);
    else if (ed && k === 'f') store.flip(ed.id);
    else if (ed && k === 'x') store.cycleDir(ed.id);
    else if (ed && k === 'k') store.cycleKind(ed.id);
    else if (ed && k === 'l') prompt('label', { edge: ed.id });
  }
  function cycleVariant(d) { const ks = Object.keys(VARIANTS); store.setVariant(ks[(ks.indexOf(V) + d + ks.length) % ks.length]); close(); }

  // Variant C: palette drag-drop.
  let dragCls = null;
  function onDrop(e) {
    if (V !== 'C' || !dragCls) return; e.preventDefault();
    const target = under(e, 'card'), f = toFlow(e);
    if (target) store.createConnected(target, dragCls);
    else store.addElement(dragCls, f, under(e, 'frame'));
    dragCls = null;
  }

  async function runBench() {
    const phase = (ms, fn) => new Promise(res => { const dts = []; let last = performance.now(); const t0 = last;
      const step = t => { dts.push(t - last); last = t; const k = (t - t0) / ms; if (k >= 1) return res(dts.slice(2)); fn(k); requestAnimationFrame(step); }; requestAnimationFrame(step); });
    const stat = d => { const s = [...d].sort((a, b) => b - a); return `${Math.round(1000 / (d.reduce((a, b) => a + b, 0) / d.length))} fps avg, worst-1% ${s[Math.floor(s.length / 100)].toFixed(0)} ms`; };
    bench = 'running…';
    await flow.fitView(); const fit = flow.getViewport();
    const over = await phase(4000, k => flow.setViewport({ x: fit.x + Math.sin(k * 6.28) * 300, y: fit.y, zoom: fit.zoom * (1 + 0.6 * Math.sin(k * 3.14)) }));
    const close1 = await phase(4000, k => flow.setViewport({ x: 50 - k * 3000, y: 50 - Math.sin(k * 6.28) * 400, zoom: 1 }));
    bench = `overview: ${stat(over)} · zoom 1 pan: ${stat(close1)}`;
    store.note(`bench ${store.count}: ${bench}`);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="silk-root variant-{V} lod-{store.lod}" class:connecting={store.connectFrom} class:moving={store.moving}
  class:opt-movelod={store.opts.moveLod} class:opt-contain={store.opts.contain} class:opt-layer={store.opts.layer} class:opt-canvasedges={store.opts.canvasEdges} bind:this={root} tabindex="0"
  onkeydown={onKey} ondblclick={onPaneDbl} onpointerenter={() => root.focus({ preventScroll: true })}
  ondragover={e => V === 'C' && e.preventDefault()} ondrop={onDrop}>
  <SvelteFlow bind:nodes={store.nodes} bind:edges={store.edges} {nodeTypes} {edgeTypes} fitView minZoom={0.05} maxZoom={2}
    zoomOnDoubleClick={false} nodesConnectable={V === 'A'} onlyRenderVisibleElements={store.visibleOnly}
    deleteKey={['Delete', 'Backspace']} colorMode="light"
    onbeforeconnect={c => { store.connect(c.source, c.target); return false; }}
    oninit={() => setTimeout(() => flow.fitView(), 300)}
    onconnectend={onConnectEnd}
    onmovestart={onMoveStart} onmoveend={onMoveEnd}
    onnodeclick={onNodeClick}
    onpaneclick={close}
    onedgeclick={({ event, edge }) => { if (V === 'A') menu = { kind: 'edge', ...local(event), edge: edge.id }; }}
    onnodecontextmenu={({ event, node }) => { if (V !== 'C' || node.type !== 'card') return; event.preventDefault(); menu = { kind: 'radial', ...local(event), node: node.id, flow: toFlow(event) }; }}
    onpanecontextmenu={({ event }) => { if (V !== 'C') return; event.preventDefault(); menu = { kind: 'radial', ...local(event), flow: toFlow(event), parent: under(event, 'frame') }; }}
    onedgecontextmenu={({ event, edge }) => { if (V !== 'C') return; event.preventDefault(); menu = { kind: 'edge', ...local(event), edge: edge.id }; }}
    onselectioncontextmenu={({ event }) => { if (V !== 'C') return; event.preventDefault(); menu = { kind: 'selection', ...local(event) }; }}>
    <Background gap={40} />
    <MiniMap pannable zoomable nodeColor={n => n.type === 'frame' ? 'transparent' : CLASSES[n.data.cls].color} />
    <Controls showLock={false} />
    {#if store.opts.canvasEdges && root}<EdgeCanvas host={root} />{/if}
  </SvelteFlow>

  <!-- stats / prototype controls (not part of the design under test) -->
  <div class="proto-stats">
    <b>{fps} fps</b> · zoom {store.zoom.toFixed(2)} · LOD {store.lod}
    · <select value={store.count} onchange={e => { store.regen(+e.currentTarget.value); setTimeout(() => flow.fitView(), 300); }}>{#each [100, 250, 500, 1000, 2000] as n}<option value={n}>{n} elements</option>{/each}</select>
    <label><input type="checkbox" bind:checked={store.visibleOnly} /> only render visible</label>
    <button onclick={runBench}>bench</button>
    {#if bench}<div class="bench">{bench}</div>{/if}
    <div class="log">{#each store.log as l}<div>{l}</div>{/each}</div>
  </div>

  <div class="hint">
    {#if V === 'A'}
      <b>Drag & hover.</b> Drag a card's right dot onto empty canvas, then pick a class (2 interactions). Drop it on a card to connect. Double-click the canvas to quick-add. Click status chips or 👁 on a card. Click a Connection to edit it. Shift-drag to select, then <kbd>g</kbd> to group.
    {:else if V === 'B'}
      <b>Keyboard-first.</b> Select a card, then <kbd>Tab</kbd> <kbd>1-9</kbd> (+ title) <kbd>⏎</kbd> creates a connected element. <kbd>n</kbd> quick-add · <kbd>c</kbd> connect, then click the target · <kbd>d</kbd>/<kbd>h</kbd>/<kbd>q</kbd> status · <kbd>r</kbd> reveal · <kbd>e</kbd> rename. On a selected Connection: <kbd>f</kbd> flip · <kbd>x</kbd> direction · <kbd>k</kbd> type · <kbd>l</kbd> label. <kbd>g</kbd> groups the selection.
      <div class="classkeys">{#each CLASS_NAMES as c, i}<span>{i + 1} {c}</span>{/each}</div>
    {:else}
      <b>Right-click radial + palette.</b> Drag a class from the palette onto a card to create a connected element (1 interaction), or onto empty canvas. Right-click a card, the canvas, a Connection or a selection for the radial menu.
    {/if}
    {#if store.connectFrom}<div class="connect-hint">Connecting from <b>{store.node(store.connectFrom)?.data.title}</b>. Click the target, or press Esc.</div>{/if}
  </div>

  {#if V === 'C'}
    <div class="palette">
      {#each CLASS_NAMES as c}
        <div class="tile" draggable="true" ondragstart={e => { dragCls = c; e.dataTransfer.setData('text/plain', c); }} style="--c:{CLASSES[c].color}" title={c}>
          <img src={CLASSES[c].icon} alt="" /><span>{c}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if menu?.kind === 'classes'}
    <div class="popover classes" style="left:{menu.x}px;top:{menu.y}px" role="menu">
      <div class="ph">{menu.origin ? `New element connected to ${store.node(menu.origin)?.data.title}` : 'New element'}</div>
      {#each CLASS_NAMES as c, i}<button onclick={() => pickClass(c)} style="--c:{CLASSES[c].color}"><img src={CLASSES[c].icon} alt="" />{c}</button>{/each}
    </div>
  {:else if menu?.kind === 'prompt'}
    <div class="popover prompt" style="left:{menu.x}px;top:{menu.y}px">
      <input use:focusEl onkeydown={onPromptKey} onblur={close}
        placeholder={menu.mode === 'label' ? 'Connection label ⏎' : menu.mode === 'group' ? 'Group name ⏎' : '1-9 class, then title ⏎   e.g. "1 Alrik"'} />
    </div>
  {:else if menu?.kind === 'edge'}
    {@const ei = menu?.edge && edgeInfo(menu.edge)}
    {#if ei}
      <div class="popover edge" style="left:{menu.x}px;top:{menu.y}px">
        <button onclick={() => store.cycleKind(ei.e.id)}>type: {ei.e.data.kind} ⟳</button>
        <button disabled={!ei.flip} onclick={() => store.flip(ei.e.id)}>⇄ flip</button>
        <button disabled={ei.e.data.kind !== 'free'} onclick={() => store.cycleDir(ei.e.id)}>{{ ab: 'A→B', ba: 'B→A', mutual: 'A—B' }[ei.e.data.dir]} ⟳</button>
        <button onclick={() => store.toggleReveal(ei.e.id)}>{ei.e.data.revealed ? '👁 revealed' : '◌ hidden'}</button>
        {#if ei.e.data.kind === 'free'}<input value={ei.e.data.label} onkeydown={e => { e.stopPropagation(); if (e.key === 'Enter') { store.setLabel(ei.e.id, e.currentTarget.value); close(); } }} />{/if}
        <button onclick={() => { store.remove([ei.e.id]); close(); }}>✕</button>
      </div>
    {/if}
  {:else if menu?.kind === 'radial'}
    {@const n = menu?.node && store.node(menu.node)}
    <div class="radial" style="left:{menu.x}px;top:{menu.y}px">
      {#each CLASS_NAMES as c, i}
        {@const a = (i / CLASS_NAMES.length) * Math.PI * 2 - Math.PI / 2}
        <button class="ring" style="--c:{CLASSES[c].color};transform:translate({Math.cos(a) * 95}px,{Math.sin(a) * 95}px)" title={(n ? 'New connected ' : 'New ') + c}
          onclick={() => { const m = menu; close(); m.node ? store.createConnected(m.node, c) : store.addElement(c, m.flow, m.parent); }}><img src={CLASSES[c].icon} alt="" /><span>{c}</span></button>
      {/each}
      {#if n}
        <div class="center">
          <b>{n.data.title}</b>
          {#each CLASSES[n.data.cls].status as s}<button onclick={() => store.toggleStatus(n.id, s)}>{s}</button>{/each}
          <button onclick={() => store.toggleReveal(n.id)}>{n.data.revealed ? '👁 revealed' : '◌ reveal'}</button>
          <button onclick={() => { store.connectFrom = n.id; close(); }}>connect…</button>
          <button onclick={() => { store.editing = n.id; close(); }}>rename</button>
        </div>
      {:else}
        <div class="center"><b>New element</b></div>
      {/if}
    </div>
  {:else if menu?.kind === 'selection'}
    <div class="popover" style="left:{menu.x}px;top:{menu.y}px"><button onclick={() => { store.groupSelected(); close(); }}>Group selection</button></div>
  {/if}

  <div class="proto-switcher">
    <button onclick={() => cycleVariant(-1)}>◀</button>
    <span>{V} · {VARIANTS[V]}</span>
    <button onclick={() => cycleVariant(1)}>▶</button>
    <small>Alt+←/→</small>
  </div>
</div>
