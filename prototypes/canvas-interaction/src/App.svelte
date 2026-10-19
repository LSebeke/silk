<script>
  // PROTOTYPE, throwaway. Renderer switch (#17: Svelte Flow vs Cytoscape WebGL) + fast-drag perf panel.
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import Canvas from './Canvas.svelte';
  import CyCanvas from './CyCanvas.svelte';
  import { store } from './store.svelte.js';
  import { runMatrix, fastPan, stat, toMarkdown } from './bench.js';

  const TOGGLES = [['moveLod', 'a  detail drop while moving'], ['contain', 'b  CSS containment'], ['layer', 'l  own layer'], ['canvasEdges', 'c  canvas edges'], ['opaque', 'o  opaque window'], ['pauseFoundry', 'p  pause Foundry canvas']];
  // o + p act on Foundry, outside the canvas component
  $effect(() => { document.body.classList.toggle('silk-opaque', store.opts.opaque); });
  $effect(() => { const t = globalThis.canvas?.app?.ticker; if (!t) return; store.opts.pauseFoundry ? t.stop() : t.start(); });
  let open = $state(false), one = $state('');
  async function runOne(epf) { store.status = 'running…'; await store.driver.view1(); await new Promise(r => setTimeout(r, 500)); const s = stat(await fastPan(store.driver.el(), { epf, origin: store.driver.origin?.() })); one = `${store.count} @${epf}/f: ${s.fps} fps avg, worst-1% ${s.p99} ms`; store.status = ''; }
  globalThis.silkBench = { runMatrix, toMarkdown, store }; // test hook
  // Zen/Firefox may reject clipboard writes; fall back to a selectable text box.
  let showText = $state(false);
  const copy = () => navigator.clipboard.writeText(toMarkdown()).then(() => (store.status = 'copied'), () => (showText = true));
</script>

{#if store.renderer === 'cy'}
  <div class="silk-root-cy"><CyCanvas /></div>
{:else}
  <SvelteFlowProvider><Canvas /></SvelteFlowProvider>
{/if}

<div class="silk-perf">
  <button onclick={() => (open = !open)}>⚡ fast-drag perf (#17) {open ? '▾' : '▸'}</button>
  {#if open}
    <label><select bind:value={store.renderer}><option value="flow">Svelte Flow</option><option value="cy">d  Cytoscape WebGL</option></select>
      <select value={store.count} onchange={e => store.regen(+e.currentTarget.value)}>{#each [100, 250, 500, 1000, 2000] as n}<option value={n}>{n}</option>{/each}</select></label>
    {#each TOGGLES as [k, label]}<label><input type="checkbox" bind:checked={store.opts[k]} /> {label}</label>{/each}
    <div>moving: {store.moving ? 'yes' : 'no'}</div>
    <button onclick={() => runOne(1)}>fast pan ×1</button> <button onclick={() => runOne(8)}>fast pan ×8</button>
    <button onclick={() => runMatrix()}>run matrix (~5 min)</button> <button onclick={() => runMatrix({ configs: 'env' })}>env matrix</button> <button onclick={copy} disabled={!store.results.length}>copy results</button>
    {#if one}<div style="color:#8f8">{one}</div>{/if}
    {#if store.status}<div style="color:#fd8">{store.status}</div>{/if}
    {#if showText}<textarea readonly rows="8" style="width:100%;font:10px monospace" onfocus={e => e.currentTarget.select()}>{toMarkdown()}</textarea>{/if}
    {#if store.results.length}
      <div>{store.env}</div>
      <table><tbody><tr><th>config</th><th>n</th><th>ev/f</th><th>fps</th><th>p95</th><th>p99</th></tr>
        {#each store.results as r}<tr><td>{r.name}</td><td>{r.n}</td><td>{r.epf}</td><td>{r.fps}</td><td>{r.p95}</td><td>{r.p99}</td></tr>{/each}</tbody></table>
    {/if}
  {/if}
</div>
