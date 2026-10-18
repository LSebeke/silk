<script>
  // PROTOTYPE, throwaway (#17 toggle c). All Connections drawn on one screen-space <canvas> under the Nodes,
  // instead of ~700 SVG paths + HTML labels. Read-only: edge clicks/selection are not wired.
  import { useSvelteFlow, useViewport } from '@xyflow/svelte';
  import { store } from './store.svelte.js';
  let { host } = $props(); // the .silk-root element
  const flow = useSvelteFlow(), viewport = useViewport();
  let cv, ctx, raf = 0;

  $effect(() => {
    const renderer = host.querySelector('.svelte-flow__pane'); // under the viewport (z-index 2), above the background
    cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:0';
    renderer.prepend(cv); ctx = cv.getContext('2d');
    const ro = new ResizeObserver(() => { const r = renderer.getBoundingClientRect(), d = devicePixelRatio; cv.width = r.width * d; cv.height = r.height * d; cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; schedule(); });
    ro.observe(renderer);
    return () => { ro.disconnect(); cv.remove(); cancelAnimationFrame(raf); };
  });
  $effect(() => { viewport.current.x; viewport.current.y; viewport.current.zoom; store.nodes; store.edges; store.moving; schedule(); });

  function schedule() { if (!raf) raf = requestAnimationFrame(draw); }
  function draw() {
    raf = 0; if (!ctx) return;
    const { x, y, zoom } = viewport.current, d = devicePixelRatio, W = cv.width / d, H = cv.height / d;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(zoom * d, 0, 0, zoom * d, x * d, y * d);
    const lo = { x: -x / zoom, y: -y / zoom }, hi = { x: (W - x) / zoom, y: (H - y) / zoom };
    const labels = zoom > 0.75 && !(store.moving && store.opts.moveLod);
    const box = id => { const n = flow.getInternalNode(id); if (!n) return null; const p = n.internals.positionAbsolute, w = n.measured.width ?? 190, h = n.measured.height ?? 80; return { l: p.x, r: p.x + w, cy: p.y + h / 2 }; };
    ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const e of store.edges) {
      const a = box(e.source), b = box(e.target); if (!a || !b) continue;
      const sx = a.r, sy = a.cy, tx = b.l, ty = b.cy;
      if (Math.max(sx, tx) < lo.x || Math.min(sx, tx) > hi.x || Math.max(sy, ty) < lo.y - 200 || Math.min(sy, ty) > hi.y + 200) continue; // cull
      const dx = tx - sx, dy = ty - sy, len = Math.hypot(dx, dy) || 1, o = e.data.offset * 2;
      const cx = (sx + tx) / 2 - (dy / len) * o, cy = (sy + ty) / 2 + (dx / len) * o, free = e.data.kind === 'free';
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(cx, cy, tx, ty);
      ctx.strokeStyle = free ? '#555' : '#b07a10'; ctx.lineWidth = free ? 1.5 : 2; ctx.setLineDash(free ? [] : [6, 3]); ctx.stroke();
      if (e.data.dir === 'ab') arrow(cx, cy, tx, ty, ctx.strokeStyle); else if (e.data.dir === 'ba') arrow(cx, cy, sx, sy, ctx.strokeStyle);
      if (labels) {
        const lx = (sx + 2 * cx + tx) / 4, ly = (sy + 2 * cy + ty) / 4, t = (e.data.dir === 'mutual' ? '⟷ ' : '') + e.data.label, w = ctx.measureText(t).width + 10;
        ctx.setLineDash([]); ctx.fillStyle = '#fffdf8'; ctx.beginPath(); ctx.roundRect(lx - w / 2, ly - 8, w, 16, 8); ctx.fill(); ctx.strokeStyle = free ? '#ccc' : '#b07a10'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = free ? '#444' : '#8a5d08'; ctx.fillText(t, lx, ly);
      }
    }
  }
  function arrow(fx, fy, tx, ty, c) {
    const a = Math.atan2(ty - fy, tx - fx), s = 9;
    ctx.setLineDash([]); ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(tx, ty);
    ctx.lineTo(tx - s * Math.cos(a - 0.4), ty - s * Math.sin(a - 0.4)); ctx.lineTo(tx - s * Math.cos(a + 0.4), ty - s * Math.sin(a + 0.4)); ctx.fill();
  }
</script>
