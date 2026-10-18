// PROTOTYPE, throwaway. Fast-pan bench (#17): a synthetic mouse drag on the canvas, `epf` mousemoves per frame
// (1 ≈ 60 Hz mouse, 8 ≈ high-polling-rate gaming mouse), cursor sweeping at `speed` px/s.
import { store } from './store.svelte.js';

const frame = () => new Promise(r => requestAnimationFrame(r));
const wait = ms => new Promise(r => setTimeout(r, ms));

export function fastPan(el, { ms = 3000, epf = 1, speed = 3000, origin } = {}) {
  const r = el.getBoundingClientRect(), { x: x0, y: y0 } = origin ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 }, A = 1200;
  const ev = (type, x, y, b) => new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: b });
  // triangle wave in x (reverses every 2A/speed s), slow sine in y
  const at = t => { const d = (t * speed / 1000) % (4 * A), tri = d < 2 * A ? d - A : 3 * A - d; return [x0 + tri, y0 + Math.sin(t / 700) * 300]; };
  return new Promise(res => {
    const dts = []; const t0 = performance.now(); let last = t0, tPrev = 0;
    el.dispatchEvent(ev('mousedown', ...at(0), 1));
    const step = now => {
      dts.push(now - last); last = now;
      const t = now - t0;
      if (t >= ms) { window.dispatchEvent(ev('mouseup', ...at(t), 0)); return res(dts.slice(3)); }
      for (let i = 1; i <= epf; i++) window.dispatchEvent(ev('mousemove', ...at(tPrev + (t - tPrev) * i / epf), 1));
      tPrev = t;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

export const stat = d => {
  const s = [...d].sort((a, b) => b - a), avg = d.reduce((a, b) => a + b, 0) / d.length;
  return { fps: Math.round(1000 / avg), p99: Math.round(s[Math.floor(s.length / 100)]), p95: Math.round(s[Math.floor(s.length / 20)]) };
};

export const CONFIGS = [
  ['baseline', 'flow', {}],
  ['a move-LOD', 'flow', { moveLod: true }],
  ['b contain', 'flow', { contain: true }],
  ['l layer', 'flow', { layer: true }],
  ['c canvas edges', 'flow', { canvasEdges: true }],
  ['a+b+l', 'flow', { moveLod: true, contain: true, layer: true }],
  ['a+c', 'flow', { moveLod: true, canvasEdges: true }],
  ['a+b+l+c', 'flow', { moveLod: true, contain: true, layer: true, canvasEdges: true }],
  ['d cytoscape', 'cy', {}],
  ['d cytoscape+a', 'cy', { moveLod: true }],
];
// Foundry-environment configs: does the live PIXI canvas behind the window dominate?
export const ENV_CONFIGS = [
  ['baseline', 'flow', {}],
  ['o opaque', 'flow', { opaque: true }],
  ['p pause Foundry', 'flow', { pauseFoundry: true }],
  ['o+p', 'flow', { opaque: true, pauseFoundry: true }],
  ['a+o+p', 'flow', { moveLod: true, opaque: true, pauseFoundry: true }],
  ['a+c+o', 'flow', { moveLod: true, canvasEdges: true, opaque: true }],
  ['a+c+o+p', 'flow', { moveLod: true, canvasEdges: true, opaque: true, pauseFoundry: true }],
  ['a+b+c+o+p', 'flow', { moveLod: true, contain: true, canvasEdges: true, opaque: true, pauseFoundry: true }],
  ['d cytoscape+o+p', 'cy', { opaque: true, pauseFoundry: true }],
];
const OFF = { moveLod: false, contain: false, layer: false, canvasEdges: false, opaque: false, pauseFoundry: false };

// Runs every config × count × epf; results land in store.results (rendered + copyable in the perf panel).
export async function runMatrix({ counts = [500, 1000, 2000], epfs = [1, 8], configs = CONFIGS, ms = 3000 } = {}) {
  if (configs === 'env') configs = ENV_CONFIGS;
  store.results = [];
  const env = `${navigator.userAgent.match(/(Firefox|Chrome)\/[\d.]+/)?.[0]} · ${innerWidth}×${innerHeight}@${devicePixelRatio} · Foundry canvas ${globalThis.canvas?.ready ? 'on' : 'off'}`;
  store.env = env;
  for (const n of counts) {
    if (store.count !== n) store.regen(n);
    for (const [name, renderer, opts] of configs) {
      store.opts = { ...OFF, ...opts }; store.renderer = renderer;
      await wait(400); await frame();
      while (!store.driver) await wait(50);
      await store.driver.view1(); await wait(800);
      for (const epf of epfs) {
        store.status = `${n} · ${name} · ${epf}/frame`;
        const s = stat(await fastPan(store.driver.el(), { ms, epf, origin: store.driver.origin?.() }));
        store.results = [...store.results, { n, name, epf, ...s }];
        await wait(300);
      }
    }
  }
  store.opts = { ...OFF }; store.renderer = 'flow';
  store.status = 'done';
  console.log('silk bench', env, '\n' + toMarkdown());
}

export function toMarkdown() {
  const rs = store.results, epfs = [...new Set(rs.map(r => r.epf))], ns = [...new Set(rs.map(r => r.n))];
  const head = `| config | ${ns.flatMap(n => epfs.map(e => `${n} @${e}/f`)).join(' | ')} |`;
  const sep = `|---|${ns.flatMap(() => epfs.map(() => '---')).join('|')}|`;
  const rows = [...new Set(rs.map(r => r.name))].map(name => `| ${name} | ${ns.flatMap(n => epfs.map(e => { const r = rs.find(r => r.name === name && r.n === n && r.epf === e); return r ? `${r.fps} / ${r.p99}ms` : '–'; })).join(' | ')} |`);
  return [`${store.env} · cells: avg fps / worst-1% frame`, head, sep, ...rows].join('\n');
}
