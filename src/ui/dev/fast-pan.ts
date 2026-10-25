/**
 * Fast-pan driver (spec §14), ported from `prototype/canvas-fast-drag` bench.js: a synthetic
 * mouse drag on the pane, `epf` mousemoves per frame (1 ≈ 60 Hz mouse, 8 ≈ gaming mouse),
 * the cursor sweeping a triangle wave in x and a slow sine in y at `speed` px/s.
 * Resolves with the frame durations (ms), the first 3 frames dropped.
 */
export function fastPan(
  el: HTMLElement,
  { ms = 3000, epf = 1, speed = 3000 }: { ms?: number; epf?: number; speed?: number } = {},
): Promise<number[]> {
  // The canvas may sit in a detached popup: use its window.
  const win = el.ownerDocument.defaultView ?? window;
  const rect = el.getBoundingClientRect();
  const x0 = rect.left + rect.width / 2;
  const y0 = rect.top + rect.height / 2;
  const A = 1200;
  const ev = (type: string, [x, y]: [number, number], buttons: number) =>
    new win.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: win,
      clientX: x,
      clientY: y,
      button: 0,
      buttons,
    });
  const at = (t: number): [number, number] => {
    const d = ((t * speed) / 1000) % (4 * A);
    const tri = d < 2 * A ? d - A : 3 * A - d;
    return [x0 + tri, y0 + Math.sin(t / 700) * 300];
  };
  return new Promise((resolve) => {
    const dts: number[] = [];
    const t0 = win.performance.now();
    let last = t0;
    let tPrev = 0;
    el.dispatchEvent(ev('mousedown', at(0), 1));
    const step = (now: number) => {
      dts.push(now - last);
      last = now;
      const t = now - t0;
      if (t >= ms) {
        win.dispatchEvent(ev('mouseup', at(t), 0));
        resolve(dts.slice(3));
        return;
      }
      for (let i = 1; i <= epf; i++)
        win.dispatchEvent(ev('mousemove', at(tPrev + ((t - tPrev) * i) / epf), 1));
      tPrev = t;
      win.requestAnimationFrame(step);
    };
    win.requestAnimationFrame(step);
  });
}

/** Browser, viewport, GPU: the `env` string of a results file. */
export function benchEnv(win: Window = window): string {
  const browser = win.navigator.userAgent.match(/(Firefox|Chrome)\/[\d.]+/)?.[0] ?? 'unknown';
  let gpu = 'unknown GPU';
  try {
    const gl = win.document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && info) gpu = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  } catch {
    // No WebGL: keep 'unknown GPU'.
  }
  return `${browser} · ${win.innerWidth}×${win.innerHeight}@${win.devicePixelRatio} · ${gpu}`;
}
