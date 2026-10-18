// PROTOTYPE, throwaway. In-memory canvas state, no persistence.
import { MarkerType } from '@xyflow/svelte';
import { CLASSES, validTypes, createFromDefault, canFlip, generate } from './model.js';

let seq = 0;
const uid = p => `${p}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const ls = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };

export const VARIANTS = { A: 'Drag & hover', B: 'Keyboard-first', C: 'Right-click radial + palette' };

class Store {
  nodes = $state.raw([]);
  edges = $state.raw([]);
  variant = $state(ls('silk-proto-variant', 'A'));
  lod = $state('full');
  zoom = $state(1);
  log = $state.raw([]);
  count = $state(500);
  editing = $state(null);     // node id whose title is being edited
  connectFrom = $state(null); // node id in click-to-connect mode (B, C)
  visibleOnly = $state(false);
  // #17 fast-drag perf toggles: a move-LOD, b CSS containment, l own layer, c canvas edges; renderer 'flow' | 'cy'
  opts = $state({ moveLod: false, contain: false, layer: false, canvasEdges: false });
  renderer = $state('flow');
  moving = $state(false);
  driver = null;              // { el(), view1() } set by the mounted renderer, used by bench.js
  results = $state.raw([]);
  status = $state('');
  env = $state('');

  constructor() { this.regen(500); }

  setVariant(v) { this.variant = v; try { localStorage.setItem('silk-proto-variant', v); } catch {} this.connectFrom = null; this.editing = null; }
  regen(n) { const { nodes, edges } = generate(n, uid); this.nodes = nodes; this.edges = this.#decorate(edges); this.count = n; this.note(`generated ${n} elements, ${edges.length} connections`); }
  note(msg) { this.log = [`${new Date().toLocaleTimeString()}  ${msg}`, ...this.log].slice(0, 8); }
  node(id) { return this.nodes.find(n => n.id === id); }
  edge(id) { return this.edges.find(e => e.id === id); }
  abs(n) { const p = n.parentId && this.node(n.parentId); return p ? { x: n.position.x + p.position.x, y: n.position.y + p.position.y } : n.position; }
  #patchNode(id, fn) { this.nodes = this.nodes.map(n => n.id === id ? fn(n) : n); }
  #patchEdge(id, fn) { this.edges = this.#decorate(this.edges.map(e => e.id === id ? fn(e) : e)); }

  // Multi-edges between one pair become separate curves; arrowheads follow direction.
  #decorate(edges) {
    const pairs = new Map();
    for (const e of edges) { const k = [e.source, e.target].sort().join('|'); pairs.set(k, [...(pairs.get(k) ?? []), e.id]); }
    return edges.map(e => {
      const ids = pairs.get([e.source, e.target].sort().join('|')), i = ids.indexOf(e.id);
      const off = (i - (ids.length - 1) / 2) * 50 * (e.source < e.target ? 1 : -1);
      const arrow = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: e.data.kind === 'free' ? '#555' : '#b07a10' };
      return { ...e, data: { ...e.data, offset: off }, markerEnd: e.data.dir === 'ab' ? arrow : undefined, markerStart: e.data.dir === 'ba' ? { ...arrow, orient: 'auto-start-reverse' } : undefined };
    });
  }

  // `flowPos` is absolute; converted into `parentId`'s frame when given.
  addElement(cls, flowPos, parentId = null) {
    const id = uid('e'), p = parentId && this.node(parentId);
    const position = p ? { x: flowPos.x - p.position.x, y: flowPos.y - p.position.y } : flowPos;
    this.nodes = [...this.nodes, { id, type: 'card', position, ...(p ? { parentId } : {}), selected: true,
      data: { cls, title: `New ${cls}`, status: { dead: false, happened: false, quest: 0 }, revealed: false, blocks: 0 } }];
    this.nodes = this.nodes.map(n => n.id === id ? n : n.selected ? { ...n, selected: false } : n);
    this.editing = id;
    this.note(`+ ${cls}`);
    return id;
  }
  addConnection(source, target, kind, label = kind, dir = 'ab') {
    this.edges = this.#decorate([...this.edges, { id: uid('c'), source, target, type: 'story', data: { kind, label, dir, revealed: false } }]);
    this.note(`+ ${this.node(source).data.title} —${label}→ ${this.node(target).data.title}`);
  }
  createConnected(originId, cls, flowPos) {
    const o = this.node(originId);
    flowPos ??= (() => { const a = this.abs(o), k = this.edges.filter(e => e.source === originId || e.target === originId).length; return { x: a.x + 260, y: a.y + (k % 5 - 2) * 120 }; })();
    const id = this.addElement(cls, flowPos, o.parentId);
    const d = createFromDefault(o.data.cls, cls);
    if (d.kind === 'free') this.addConnection(originId, id, 'free', 'related to');
    else d.reverse ? this.addConnection(id, originId, d.kind) : this.addConnection(originId, id, d.kind);
    return id;
  }
  // Manual connect: first valid Behavioural type, else free-form (cycle with kind).
  connect(a, b) {
    if (!a || !b || a === b) return;
    const vt = validTypes(this.node(a).data.cls, this.node(b).data.cls);
    vt.length ? this.addConnection(a, b, vt[0]) : this.addConnection(a, b, 'free', 'related to');
  }
  rename(id, title) { this.#patchNode(id, n => ({ ...n, data: { ...n.data, title } })); }
  toggleStatus(id, key) {
    this.#patchNode(id, n => {
      if (!CLASSES[n.data.cls].status.includes(key)) return n;
      const v = key === 'quest' ? (n.data.status.quest + 1) % 3 : !n.data.status[key];
      return { ...n, data: { ...n.data, status: { ...n.data.status, [key]: v } } };
    });
  }
  statusOf(id) { return CLASSES[this.node(id)?.data.cls]?.status[0]; }
  toggleReveal(id) {
    if (this.node(id)) return this.#patchNode(id, n => ({ ...n, data: { ...n.data, revealed: !n.data.revealed } }));
    this.#patchEdge(id, e => ({ ...e, data: { ...e.data, revealed: !e.data.revealed } }));
  }
  flip(id) {
    const e = this.edge(id);
    if (!canFlip(e.data.kind, this.node(e.source).data.cls, this.node(e.target).data.cls)) return this.note(`can't flip "${e.data.kind}"`);
    this.#patchEdge(id, e => ({ ...e, source: e.target, target: e.source }));
  }
  cycleDir(id) {
    const e = this.edge(id);
    if (e.data.kind !== 'free') return this.note('Behavioural Connections have a fixed direction');
    const dir = { ab: 'ba', ba: 'mutual', mutual: 'ab' }[e.data.dir];
    this.#patchEdge(id, e => ({ ...e, data: { ...e.data, dir } }));
  }
  cycleKind(id) {
    const e = this.edge(id), opts = [...validTypes(this.node(e.source).data.cls, this.node(e.target).data.cls), 'free'];
    const kind = opts[(opts.indexOf(e.data.kind) + 1) % opts.length];
    this.#patchEdge(id, e => ({ ...e, data: { ...e.data, kind, label: kind === 'free' ? 'related to' : kind, dir: kind === 'free' ? e.data.dir : 'ab' } }));
  }
  setLabel(id, label) { this.#patchEdge(id, e => ({ ...e, data: { ...e.data, label } })); }
  remove(ids) {
    const s = new Set(ids);
    this.nodes = this.nodes.filter(n => !s.has(n.id));
    this.edges = this.#decorate(this.edges.filter(e => !s.has(e.id) && !s.has(e.source) && !s.has(e.target)));
  }
  groupSelected(title = 'New group') {
    const sel = this.nodes.filter(n => n.selected && n.type === 'card');
    if (sel.length < 2) return this.note('select ≥2 elements to group (Shift-drag)');
    const pts = sel.map(n => this.abs(n)), x = Math.min(...pts.map(p => p.x)) - 30, y = Math.min(...pts.map(p => p.y)) - 60;
    const w = Math.max(...pts.map(p => p.x)) - x + 240, h = Math.max(...pts.map(p => p.y)) - y + 140, id = uid('g'), ids = new Set(sel.map(n => n.id));
    const moved = this.nodes.filter(n => ids.has(n.id)).map((n, i) => ({ ...n, parentId: id, selected: false, position: { x: pts[i].x - x, y: pts[i].y - y } }));
    this.nodes = [{ id, type: 'frame', position: { x, y }, width: w, height: h, data: { title } }, ...this.nodes.filter(n => !ids.has(n.id)), ...moved];
    this.note(`grouped ${sel.length} elements`);
  }
}

export const store = new Store();
