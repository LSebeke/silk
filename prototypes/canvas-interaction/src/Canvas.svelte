<script>
  // PROTOTYPE, throwaway. Focus View (#12): three follow/layout variants on one canvas, switched from the bottom bar (Alt+←/→).
  // Creation is reduced to #11's mouse basics (drag out a Connection, right-click the canvas) so new Nodes can be checked against the focus.
  import { SvelteFlow, Background, MiniMap, Controls, useSvelteFlow, useViewport } from '@xyflow/svelte';
  import Card from './Card.svelte';
  import Frame from './Frame.svelte';
  import StoryEdge from './StoryEdge.svelte';
  import { store } from './store.svelte.js';
  import { focus, FOCUS_VARIANTS, FOCUS_HINTS } from './focus.svelte.js';
  import { CLASSES, CLASS_NAMES } from './model.js';

  const nodeTypes = { card: Card, frame: Frame }, edgeTypes = { story: StoryEdge };
  const flow = useSvelteFlow(), viewport = useViewport();
  globalThis.silkProtoFlow = flow; globalThis.silkFocus = { focus, store, refocus: r => refocus(r), setScene: i => setScene(i) }; // test hooks
  store.variant = 'A'; // #11 interaction set
  store.opts.moveLod = true; // #17 decision, on by default
  const V = $derived(focus.variant);
  let root = $state();
  let menu = $state(null);
  let fps = $state(0);

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

  // ---- Focus View
  const fit = (ids, opts = {}) => ids.length && flow.fitView({ nodes: ids.map(id => ({ id })), duration: 600, padding: 0.2, maxZoom: 1, ...opts });
  function offscreen(ids) {
    const r = root.getBoundingClientRect(), { x, y, zoom } = flow.getViewport();
    return ids.some(id => { const n = store.node(id); if (!n) return false; const a = store.abs(n), sx = a.x * zoom + x, sy = a.y * zoom + y;
      return sx < 0 || sy < 0 || sx + 190 * zoom > r.width || sy + 80 * zoom > r.height; });
  }
  // reason: 'scene' | 'selection' | 'badge' | 'pins' | 'toggle' | 'variant' | 'init'
  async function refocus(reason) {
    const added = focus.apply(), ids = [...focus.visible], local = reason === 'selection' || reason === 'badge' || reason === 'pins';
    if (focus.on && V === 'B') { await focus.layoutB(); return fit(ids); }
    if (focus.temp.size) await focus.restoreB();
    if (!focus.on) return reason === 'toggle' && fit(ids);
    if (V === 'A') return local ? undefined : fit(ids);
    // C: move only when something new is offscreen; never zoom in for a local change
    if (!local) return (reason !== 'scene' || offscreen(focus.seeds)) && fit(ids);
    const want = [...added, ...focus.sel];
    if (added.length && offscreen(want)) fit(want, { maxZoom: flow.getViewport().zoom });
  }
  function onSelection({ nodes }) {
    const ids = nodes.filter(n => n.type === 'card').map(n => n.id).sort();
    if (ids.join() === [...focus.sel].sort().join()) return;
    focus.sel = ids; refocus('selection');
  }
  function setScene(i) {
    focus.scene = (i + focus.scenes.length) % focus.scenes.length; focus.extra = [];
    if (focus.sel.length) { store.nodes = store.nodes.map(n => (n.selected ? { ...n, selected: false } : n)); focus.sel = []; }
    refocus('scene');
  }
  function regen(n) { store.regen(n); focus.init(); setTimeout(() => refocus('init'), 300); }
  focus.init();

  // ---- creation (#11 mouse basics)
  const pt = e => (e.changedTouches?.[0] ?? e);
  const local = e => { const r = root.getBoundingClientRect(), p = pt(e); return { x: p.clientX - r.left, y: p.clientY - r.top }; };
  const toFlow = e => { const p = pt(e); return flow.screenToFlowPosition({ x: p.clientX, y: p.clientY }); };
  const under = (e, type) => { const p = pt(e); return document.elementFromPoint(p.clientX, p.clientY)?.closest(`.svelte-flow__node-${type}`)?.dataset.id ?? null; };
  const close = () => (menu = null);
  function pickClass(cls) {
    const m = menu; close();
    const id = m.origin ? store.createConnected(m.origin, cls, m.flow) : store.addElement(cls, m.flow, m.parent);
    focus.sel = [id]; refocus('selection'); // the new Node is selected, so it is a seed and stays visible
  }
  function onConnectEnd(event, state) {
    if (state.isValid) return;
    const from = state.fromNode?.id, target = under(event, 'card');
    if (target && target !== from) return store.connect(from, target);
    menu = { kind: 'classes', ...local(event), origin: from, flow: toFlow(event) };
  }

  function onKey(e) {
    if (e.target.closest('input, textarea, [contenteditable]')) return;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); return cycleVariant(e.key === 'ArrowLeft' ? -1 : 1); }
    const k = e.key, stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === 'Escape') close();
    else if (k === 'p' && focus.sel.length) { stop(); focus.togglePins(focus.sel); refocus('pins'); }
    else if (k === 'f') { stop(); focus.on = !focus.on; refocus('toggle'); }
    else if (k === '.' || k === ',') { stop(); setScene(focus.scene + (k === '.' ? 1 : -1)); }
    else if ('123'.includes(k) && k) { stop(); focus.n = +k; refocus('scene'); }
    else if (k === 'u' && V === 'C') { stop(); focus.untangle(); }
    else if (k === 'z' && (e.ctrlKey || e.metaKey) && V === 'C') { stop(); focus.undoUntangle(); }
  }
  async function cycleVariant(d) {
    const ks = Object.keys(FOCUS_VARIANTS); close();
    await focus.restoreB();
    focus.setVariant(ks[(ks.indexOf(V) + d + ks.length) % ks.length]);
    refocus('variant');
  }
  const deselect = () => { store.nodes = store.nodes.map(n => (n.selected ? { ...n, selected: false } : n)); focus.sel = []; refocus('selection'); };
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="silk-root variant-A focus-{V} lod-{store.lod}" class:focus-on={focus.on} class:moving={store.moving}
  class:opt-movelod={store.opts.moveLod} class:opt-contain={store.opts.contain} class:opt-layer={store.opts.layer} bind:this={root} tabindex="0"
  onkeydown={onKey} onpointerenter={() => root.focus({ preventScroll: true })}>
  <SvelteFlow bind:nodes={store.nodes} bind:edges={store.edges} {nodeTypes} {edgeTypes} minZoom={0.05} maxZoom={2}
    zoomOnDoubleClick={false} nodesConnectable deleteKey={['Delete', 'Backspace']} colorMode="light"
    onbeforeconnect={c => { store.connect(c.source, c.target); return false; }}
    oninit={() => setTimeout(() => refocus('init'), 300)}
    onconnectend={onConnectEnd} onselectionchange={onSelection}
    onmovestart={onMoveStart} onmoveend={onMoveEnd}
    onpaneclick={close}
    onpanecontextmenu={({ event }) => { event.preventDefault(); menu = { kind: 'classes', ...local(event), flow: toFlow(event), parent: under(event, 'frame') }; }}>
    <Background gap={40} />
    <MiniMap pannable zoomable nodeColor={n => n.type === 'frame' ? 'transparent' : CLASSES[n.data.cls].color} />
    <Controls showLock={false} />
  </SvelteFlow>

  <!-- Focus chip bar (part of the design under test) -->
  <div class="focusbar">
    <button class="tog" class:on={focus.on} onclick={() => { focus.on = !focus.on; refocus('toggle'); }} title="f">◎ Focus {focus.on ? 'on' : 'off'}</button>
    <span class="grp">N {#each [1, 2, 3] as k}<button class:on={focus.n === k} onclick={() => { focus.n = k; refocus('scene'); }}>{k}</button>{/each}</span>
    <span class="grp scene">
      <button onclick={() => setScene(focus.scene - 1)} title=",">◀</button>
      <span>🎬 <b>{focus.current?.title ?? 'no Scene'}</b> <small>{focus.scene + 1}/{focus.scenes.length} · {focus.current?.tokens.length ?? 0} tokens</small></span>
      <button onclick={() => setScene(focus.scene + 1)} title=".">▶</button>
    </span>
    {#if focus.sel.length}<span class="grp">+ selection ({focus.sel.length}) <button onclick={deselect}>✕</button></span>{/if}
    {#if focus.pins.length}<span class="grp">📌 {focus.pins.length} <button onclick={() => { focus.pins = []; refocus('pins'); }}>✕</button></span>{/if}
    {#if focus.extra.length}<span class="grp">+{focus.extra.length} via badges <button onclick={() => { focus.extra = []; refocus('badge'); }}>✕</button></span>{/if}
    <span class="grp count">{focus.visible.size} of {store.count} shown</span>
    {#if V === 'C'}<span class="grp"><button disabled={focus.sel.length < 2} onclick={() => focus.untangle()} title="u (select ≥2 Nodes)">⌗ Untangle {focus.sel.length >= 2 ? focus.sel.length : ''}</button><button disabled={!focus.undo.length} onclick={() => focus.undoUntangle()} title="Ctrl+Z">↶ Undo</button></span>{/if}
    {#if V === 'B' && focus.on}<span class="grp temp">positions temporary</span>{/if}
  </div>

  <!-- prototype chrome (not under test) -->
  <div class="proto-stats">
    <b>{fps} fps</b> · zoom {store.zoom.toFixed(2)} · LOD {store.lod}
    · <select value={store.count} onchange={e => regen(+e.currentTarget.value)}>{#each [100, 250, 500, 1000, 2000] as n}<option value={n}>{n} elements</option>{/each}</select>
    <div class="vhint"><b>{V} · {FOCUS_VARIANTS[V]}.</b> {FOCUS_HINTS[V]}</div>
    <div class="keys"><kbd>,</kbd>/<kbd>.</kbd> prev/next Scene (simulated activation) · click/Shift-drag selects (walks the focus) · click empty canvas deselects · <kbd>p</kbd> pin selection · <kbd>f</kbd> focus on/off · <kbd>1</kbd>–<kbd>3</kbd> N · "+N" badge shows hidden neighbours · drag a card's right dot out / right-click canvas to create{#if V === 'C'} · <kbd>u</kbd> untangle selection · <kbd>Ctrl+Z</kbd> undo{/if}</div>
    <div class="log">{#each store.log.slice(0, 3) as l}<div>{l}</div>{/each}</div>
  </div>

  {#if menu?.kind === 'classes'}
    <div class="popover classes" style="left:{menu.x}px;top:{menu.y}px" role="menu">
      <div class="ph">{menu.origin ? `New Node connected to ${store.node(menu.origin)?.data.title}` : 'New Node'}</div>
      {#each CLASS_NAMES as c}<button onclick={() => pickClass(c)} style="--c:{CLASSES[c].color}"><img src={CLASSES[c].icon} alt="" />{c}</button>{/each}
    </div>
  {/if}

  <div class="proto-switcher">
    <button onclick={() => cycleVariant(-1)}>◀</button>
    <span>{V} · {FOCUS_VARIANTS[V]}</span>
    <button onclick={() => cycleVariant(1)}>▶</button>
    <small>Alt+←/→</small>
  </div>
</div>
