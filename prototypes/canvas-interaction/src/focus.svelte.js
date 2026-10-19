// PROTOTYPE, throwaway. Focus View (#12): N-hop filter seeded by the active Scene + its tokens + the selection,
// plus Focus Pins and "+N" badges (#20). Three variants for follow / layout behaviour, switched from the bottom bar.
import dagre from '@dagrejs/dagre';
import { store } from './store.svelte.js';
import { scenes } from './model.js';

export const FOCUS_VARIANTS = { A: 'Stay-put', B: 'Focus layout (temporary)', C: 'Untangle on demand' };
export const FOCUS_HINTS = {
  A: 'Nodes keep their Canon positions; hidden Nodes just vanish. A Scene change animates the camera to fit the focus. Selecting never moves the camera.',
  B: 'The focused subgraph animates into a temporary ring layout around the seeds (hop 1, hop 2 …). Every focus change re-lays out and refits. Positions are NOT saved: dragging here is temporary, leaving focus puts everything back.',
  C: 'Nodes keep their Canon positions. The camera only moves when something new would be offscreen. "Untangle" lays out the visible Nodes (dagre) and SAVES those positions (undo with Ctrl+Z).',
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

  // C: dagre left-to-right over the visible Nodes, centred where they are now; positions are kept (undoable).
  untangle() {
    const ids = [...this.visible]; if (ids.length < 2) return Promise.resolve();
    const g = new dagre.graphlib.Graph(); g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 110 }); g.setDefaultEdgeLabel(() => ({}));
    for (const id of ids) g.setNode(id, { width: W, height: H });
    for (const e of store.edges) if (this.visible.has(e.source) && this.visible.has(e.target)) g.setEdge(e.source, e.target);
    dagre.layout(g);
    const now = ids.map(id => store.abs(store.node(id))), lay = ids.map(id => g.node(id));
    const dx = now.reduce((s, p) => s + p.x, 0) / ids.length - lay.reduce((s, p) => s + p.x - W / 2, 0) / ids.length;
    const dy = now.reduce((s, p) => s + p.y, 0) / ids.length - lay.reduce((s, p) => s + p.y - H / 2, 0) / ids.length;
    this.undo = [...this.undo, new Map(ids.map(id => [id, { ...store.node(id).position }]))];
    return this.animate(this.#toRel(new Map(ids.map((id, i) => [id, { x: lay[i].x - W / 2 + dx, y: lay[i].y - H / 2 + dy }]))));
  }
  undoUntangle() { const m = this.undo.at(-1); if (!m) return Promise.resolve(); this.undo = this.undo.slice(0, -1); return this.animate(m); }
}

export const focus = new Focus();
