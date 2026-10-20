// PROTOTYPE, throwaway. Focus View (#12): N-hop filter seeded by the active Scene + its tokens + the selection,
// plus Focus Pins and "+N" badges (#20). Three variants for follow / layout behaviour, switched from the bottom bar.
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force';
import { store } from './store.svelte.js';
import { scenes } from './model.js';

export const FOCUS_VARIANTS = { A: 'Stay-put', B: 'Focus layout (temporary)', C: 'Untangle on demand' };
export const FOCUS_HINTS = {
  A: 'Nodes keep their Canon positions; hidden Nodes just vanish. A Scene change animates the camera to fit the focus. Selecting never moves the camera.',
  B: 'The focused subgraph animates into a temporary ring layout around the seeds (hop 1, hop 2 …). Every focus change re-lays out and refits. Positions are NOT saved: dragging here is temporary, leaving focus puts everything back.',
  C: 'Nodes keep their Canon positions. The camera only moves when something new would be offscreen. Select ≥2 Nodes (Shift-drag), then "Untangle" (u): force layout of the selection only, unselected neighbours stay put as anchors; positions are SAVED (undo with Ctrl+Z).',
};
const W = 190, H = 80, ls = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };

class Focus {
  variant = $state(ls('silk-focus-variant', 'A'));
  on = $state(true);
  n = $state(2);
  scenes = $state.raw([]);
  scene = $state(0);
  sel = $state.raw([]);   // selected card ids
  pins = $state.raw([]);
  extra = $state.raw([]); // shown through a "+N" badge; cleared on Scene change
  visible = $state.raw(new Set());
  undo = $state.raw([]);  // C: stack of Map(id → relative position)
  temp = new Map();       // B: id → Canon (relative) position while the focus layout displaces it
  #anim; #edges; #adj;

  setVariant(v) { this.variant = v; try { localStorage.setItem('silk-focus-variant', v); } catch {} }
  init() { this.scenes = scenes(store.nodes, store.edges); this.scene = 0; this.sel = []; this.pins = []; this.extra = []; this.undo = []; this.temp.clear(); this.visible = new Set(); }
  get current() { return this.scenes[this.scene]; }
  get sceneSeeds() { const s = this.current; return s ? [s.id, ...s.tokens] : []; }
  get seeds() { return [...new Set([...this.sceneSeeds, ...this.sel])]; }

  adj() {
    if (this.#edges !== store.edges) {
      const m = new Map(), add = (a, b) => (m.get(a) ?? m.set(a, new Set()).get(a)).add(b);
      for (const e of store.edges) { add(e.source, e.target); add(e.target, e.source); }
      this.#edges = store.edges; this.#adj = m;
    }
    return this.#adj;
  }
  hops(seeds) {
    const adj = this.adj(), d = new Map(seeds.map(id => [id, 0])), q = [...d.keys()];
    for (let i = 0; i < q.length; i++) { const k = d.get(q[i]); if (k >= this.n) continue; for (const b of adj.get(q[i]) ?? []) if (!d.has(b)) { d.set(b, k + 1); q.push(b); } }
    return d;
  }

  // Recompute the visible set and write hidden flags, badges and seed markers. Returns the newly shown ids.
  apply() {
    const adj = this.adj(), before = this.visible, cards = store.nodes.filter(n => n.type === 'card');
    const vis = this.on ? new Set([...this.hops(this.seeds).keys(), ...this.pins, ...this.extra]) : new Set(cards.map(n => n.id));
    const pins = new Set(this.pins), sc = this.current, tokens = new Set(sc?.tokens ?? []), groups = new Set();
    for (const n of cards) if (vis.has(n.id) && n.parentId) groups.add(n.parentId);
    store.nodes = store.nodes.map(n => {
      if (n.type === 'frame') {
        const off = (this.on && this.variant === 'B') || !groups.has(n.id);
        return !!n.data.off === off ? n : { ...n, data: { ...n.data, off } };
      }
      const hidden = !vis.has(n.id), pinned = pins.has(n.id);
      const hiddenN = hidden || !this.on ? 0 : [...(adj.get(n.id) ?? [])].filter(x => !vis.has(x)).length;
      const role = !this.on ? '' : sc?.id === n.id ? 'scene' : tokens.has(n.id) ? 'token' : '';
      if (!!n.hidden === hidden && n.data.hiddenN === hiddenN && !!n.data.pinned === pinned && (n.data.role ?? '') === role) return n;
      return { ...n, hidden, data: { ...n.data, hiddenN, pinned, role } };
    });
    this.visible = vis;
    return [...vis].filter(id => !before.has(id));
  }

  showHiddenNeighbours(id) { const adj = this.adj(); this.extra = [...new Set([...this.extra, ...[...adj.get(id) ?? []].filter(x => !this.visible.has(x))])]; }
  togglePins(ids) { const s = new Set(this.pins); const add = ids.some(id => !s.has(id)); for (const id of ids) add ? s.add(id) : s.delete(id); this.pins = [...s]; }

  // ---- positions
  #toRel(abs) { const out = new Map(); for (const [id, a] of abs) { const n = store.node(id), p = n?.parentId && store.node(n.parentId); if (n) out.set(id, p ? { x: a.x - p.position.x, y: a.y - p.position.y } : a); } return out; }
  animate(targets, ms = 450) {
    const tok = (this.#anim = {}), from = new Map();
    for (const n of store.nodes) if (targets.has(n.id)) from.set(n.id, n.position);
    return new Promise(res => {
      const t0 = performance.now();
      const step = t => {
        if (this.#anim !== tok) return res();
        const k = Math.min(1, (t - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        store.nodes = store.nodes.map(n => { const a = from.get(n.id); if (!a) return n; const b = targets.get(n.id); return { ...n, position: { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e } }; });
        k < 1 ? requestAnimationFrame(step) : res();
      };
      requestAnimationFrame(step);
    });
  }

  // B: rings around the seeds, each subtree in its own angular sector (sized by leaf count) to avoid crossings.
  radial() {
    const adj = this.adj(), vis = this.visible, roots = this.seeds.filter(id => vis.has(id));
    const depth = new Map(roots.map(id => [id, 0])), kids = new Map(), q = [...roots];
    for (let i = 0; i < q.length; i++) for (const b of adj.get(q[i]) ?? []) if (vis.has(b) && !depth.has(b)) { depth.set(b, depth.get(q[i]) + 1); (kids.get(q[i]) ?? kids.set(q[i], []).get(q[i])).push(b); q.push(b); }
    const leaves = new Map(), w = id => leaves.get(id) ?? (leaves.set(id, (kids.get(id) ?? []).reduce((s, k) => s + w(k), 0) || 1), leaves.get(id));
    const cnt = []; for (const d of depth.values()) cnt[d] = (cnt[d] ?? 0) + 1;
    const R = [roots.length > 1 ? Math.max(170, (roots.length * 240) / (2 * Math.PI)) : 0];
    for (let d = 1; d < cnt.length; d++) R[d] = Math.max(R[d - 1] + 330, (cnt[d] * 250) / (2 * Math.PI));
    const pts = roots.map(id => store.abs(store.node(id))), cx = pts.reduce((s, p) => s + p.x, 0) / (pts.length || 1) + W / 2, cy = pts.reduce((s, p) => s + p.y, 0) / (pts.length || 1) + H / 2;
    const pos = new Map();
    const place = (id, a0, a1) => {
      const a = (a0 + a1) / 2, r = R[depth.get(id)]; pos.set(id, { x: cx + r * Math.cos(a) - W / 2, y: cy + r * Math.sin(a) - H / 2 });
      let s = a0; for (const k of kids.get(id) ?? []) { const span = ((a1 - a0) * w(k)) / w(id); place(k, s, s + span); s += span; }
    };
    const total = roots.reduce((s, r) => s + w(r), 0); let s = -Math.PI / 2;
    for (const r of roots) { const span = (2 * Math.PI * w(r)) / total; place(r, s, s + span); s += span; }
    const rest = [...vis].filter(id => !pos.has(id)), y = cy + (R.at(-1) ?? 0) + 220; // pins / badge extras not reachable from a seed
    rest.forEach((id, i) => pos.set(id, { x: cx - rest.length * 110 + i * 220, y }));
    return pos;
  }
  layoutB() {
    const targets = new Map();
    for (const [id, p] of this.temp) if (!this.visible.has(id)) { targets.set(id, p); this.temp.delete(id); } // left the focus: back to Canon
    const abs = this.radial();
    for (const id of abs.keys()) if (!this.temp.has(id)) this.temp.set(id, { ...store.node(id).position });
    for (const [id, p] of this.#toRel(abs)) targets.set(id, p);
    return this.animate(targets);
  }
  restoreB() { const t = new Map(this.temp); this.temp.clear(); return t.size ? this.animate(t) : Promise.resolve(); }

  // C: force-directed (Obsidian-graph-like) over the SELECTION only, run to convergence off-screen, applied as one tween.
  // Unselected visible Nodes stay fixed: connected ones pull (anchors), nearby ones only block overlaps. Selected Nodes
  // keep their Visual Group; frames grow to fit. One Ctrl+Z undoes it all.
  untangle() {
    const sel = this.sel.filter(id => this.visible.has(id)); if (sel.length < 2) return Promise.resolve();
    const S = new Set(sel), centre = id => { const a = store.abs(store.node(id)); return { x: a.x + W / 2, y: a.y + H / 2 }; };
    const pts = sel.map(centre), m = 450;
    const box = { x0: Math.min(...pts.map(p => p.x)) - m, x1: Math.max(...pts.map(p => p.x)) + m, y0: Math.min(...pts.map(p => p.y)) - m, y1: Math.max(...pts.map(p => p.y)) + m };
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const links = store.edges.filter(e => (S.has(e.source) || S.has(e.target)) && this.visible.has(e.source) && this.visible.has(e.target));
    const fixed = new Set(links.flatMap(e => [e.source, e.target]).filter(id => !S.has(id)));
    for (const id of this.visible) if (!S.has(id)) { const c = centre(id); if (c.x > box.x0 && c.x < box.x1 && c.y > box.y0 && c.y < box.y1) fixed.add(id); }
    const sim = [...sel, ...fixed].map((id, i) => {
      const c = centre(id), n = { id, x: c.x, y: c.y, parent: store.node(id).parentId };
      if (!S.has(id)) { n.fx = c.x; n.fy = c.y; } else { n.x += Math.cos(i) * 0.5; n.y += Math.sin(i) * 0.5; } // tiny jitter: coincident Nodes
      return n;
    });
    const frameC = new Map(store.nodes.filter(n => n.type === 'frame').map(f => [f.id, { x: f.position.x + (f.width ?? 0) / 2, y: f.position.y + (f.height ?? 0) / 2 }]));
    const keepInGroup = a => { for (const n of sim) if (n.fx == null && n.parent) { const c = frameC.get(n.parent); n.vx += (c.x - n.x) * 0.04 * a; n.vy += (c.y - n.y) * 0.04 * a; } };
    const s = forceSimulation(sim).stop()
      .force('link', forceLink(links.map(e => ({ source: e.source, target: e.target }))).id(n => n.id).distance(240).strength(0.6))
      .force('charge', forceManyBody().strength(-700).distanceMax(700))
      .force('collide', forceCollide(112).strength(1).iterations(3))
      .force('x', forceX(cx).strength(n => (n.fx == null ? 0.03 : 0))).force('y', forceY(cy).strength(n => (n.fx == null ? 0.03 : 0)))
      .force('group', keepInGroup);
    s.tick(400);
    const abs = new Map(sim.filter(n => n.fx == null).map(n => [n.id, { x: n.x - W / 2, y: n.y - H / 2 }]));
    // grow frames to fit their (moved) children; re-base all children of a frame that moves
    const frames = [], targets = new Map(), pad = 30;
    for (const fid of new Set(sel.map(id => store.node(id).parentId).filter(Boolean))) {
      const f = store.node(fid), kids = store.nodes.filter(n => n.parentId === fid);
      const kAbs = kids.map(k => abs.get(k.id) ?? store.abs(k));
      const x0 = Math.min(f.position.x, ...kAbs.map(p => p.x - pad)), y0 = Math.min(f.position.y, ...kAbs.map(p => p.y - pad - 30));
      const x1 = Math.max(f.position.x + f.width, ...kAbs.map(p => p.x + W + pad)), y1 = Math.max(f.position.y + f.height, ...kAbs.map(p => p.y + H + pad));
      frames.push({ id: fid, position: { ...f.position }, width: f.width, height: f.height });
      targets.set(fid, { x: x0, y: y0 }); store.nodes = store.nodes.map(n => (n.id === fid ? { ...n, width: x1 - x0, height: y1 - y0 } : n));
      kids.forEach((k, i) => targets.set(k.id, { x: kAbs[i].x - x0, y: kAbs[i].y - y0 }));
    }
    for (const [id, p] of abs) if (!targets.has(id)) targets.set(id, p);
    this.undo = [...this.undo, { pos: new Map([...targets.keys()].map(id => [id, { ...store.node(id).position }])), frames }];
    return this.animate(targets);
  }
  undoUntangle() {
    const u = this.undo.at(-1); if (!u) return Promise.resolve(); this.undo = this.undo.slice(0, -1);
    const size = new Map(u.frames.map(f => [f.id, f]));
    return this.animate(u.pos).then(() => { store.nodes = store.nodes.map(n => (size.has(n.id) ? { ...n, width: size.get(n.id).width, height: size.get(n.id).height } : n)); });
  }
}

export const focus = new Focus();
