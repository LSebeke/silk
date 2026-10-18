<script>
  // PROTOTYPE, throwaway (#17 variant d). Same Story graph in Cytoscape.js with the WebGL renderer, read-only,
  // to measure the fallback rather than assume it. No Creation Pipeline, chips or Connection Points.
  import { CLASSES } from './model.js';
  import { store } from './store.svelte.js';
  let box, cytoscape = $state(null);

  import('cytoscape').then(m => (cytoscape = m.default)); // lazy chunk; see cytoscapeFoundryPatch in vite.config.js

  const elements = () => [
    ...store.nodes.map(n => n.type === 'frame'
      ? { group: 'nodes', data: { id: n.id, label: n.data.title }, classes: 'frame' }
      : { group: 'nodes', data: { id: n.id, parent: n.parentId, label: `${n.data.cls.toUpperCase()}\n${n.data.title}`, c: CLASSES[n.data.cls].color }, position: { ...store.abs(n) }, classes: n.data.status.dead ? 'dead' : '' }),
    ...store.edges.map(e => ({ group: 'edges', data: { id: e.id, source: e.source, target: e.target, label: e.data.label }, classes: `${e.data.kind === 'free' ? 'free' : 'behav'} ${e.data.dir}` })),
  ];
  const style = [
    { selector: 'node', style: { shape: 'round-rectangle', width: 190, height: 78, 'background-color': '#fffdf8', 'border-width': 1, 'border-color': 'data(c)', label: 'data(label)', 'text-wrap': 'wrap', 'text-max-width': 170, 'text-valign': 'center', 'font-size': 13, 'font-weight': 700, color: '#222', 'min-zoomed-font-size': 8 } },
    { selector: 'node.dead', style: { opacity: 0.5 } },
    { selector: '.frame', style: { 'background-color': '#ece3cf', 'background-opacity': 0.5, 'border-style': 'dashed', 'border-color': '#b9a77f', 'border-width': 2, 'text-valign': 'top', 'font-size': 22, color: '#8a7444', padding: 30 } },
    { selector: 'edge', style: { 'curve-style': 'bezier', width: 1.5, 'line-color': '#555', 'target-arrow-color': '#555', 'source-arrow-color': '#555', label: 'data(label)', 'font-size': 10, 'text-background-color': '#fffdf8', 'text-background-opacity': 1, 'text-background-padding': 2, 'min-zoomed-font-size': 7 } },
    { selector: 'edge.behav', style: { 'line-style': 'dashed', width: 2, 'line-color': '#b07a10', 'target-arrow-color': '#b07a10', color: '#8a5d08' } },
    { selector: 'edge.ab', style: { 'target-arrow-shape': 'triangle' } },
    { selector: 'edge.ba', style: { 'source-arrow-shape': 'triangle' } },
  ];

  $effect(() => {
    if (!cytoscape) return;
    const cy = cytoscape({ container: box, elements: elements(), style, layout: { name: 'preset' }, minZoom: 0.05, maxZoom: 2,
      webgl: true, hideEdgesOnViewport: store.opts.moveLod, hideLabelsOnViewport: store.opts.moveLod, textureOnViewport: false });
    globalThis.silkProtoCy = cy; // test hook
    // a point on empty canvas near the centre, so the synthetic drag pans instead of grabbing a Node
    const origin = () => { const r = box.getBoundingClientRect();
      for (let k = 0; k < 400; k++) { const x = r.width / 2 + ((k % 20) - 10) * 17, y = r.height / 2 + (Math.floor(k / 20) - 10) * 13, p = { x: (x - cy.pan().x) / cy.zoom(), y: (y - cy.pan().y) / cy.zoom() };
        if (!cy.nodes(':childless').some(n => { const b = n.boundingBox(); return p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2; })) return { x: r.left + x, y: r.top + y }; }
      return null; };
    store.driver = { el: () => box, origin, view1: async () => { cy.zoom(1); cy.center(); } };
    return () => { store.driver = null; cy.destroy(); };
  });
</script>
<div class="cy-box" bind:this={box}></div>
