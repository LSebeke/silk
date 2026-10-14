# Canvas library for a 500-node story graph

Research for [#4](https://github.com/LSebeke/silk/issues/4). Researched 2026-10-14.

**Question:** Which JS graph/canvas libraries can render ~500 Story Elements as rich cards with Connections at 60fps inside a Foundry ApplicationV2 window? Covers drag-to-connect, grouping/frames, hide/dim for Focus View, auto-layout, bundle size, licensing, and whether Foundry's bundled PIXI can be reused.

Labels: **[src]** = stated by the cited primary source. **[inf]** = my inference. Nobody publishes a "500 rich cards @ 60fps" benchmark for any of these libraries, so #11 has to confirm that number.

## TL;DR

1. **Svelte Flow (`@xyflow/svelte`)** is the best fit. Cards are real DOM, so rich content, inline editing, Foundry CSS and drag-drop all work without extra effort. It ships drag-to-connect, parent/group nodes, a per-node `hidden` flag plus classes for dimming, and documented recipes for dagre, d3-force and ELK. It is MIT. 500 DOM cards is a moderate load; pan and zoom is a single CSS transform. Main risk: the cost of DOM per card. Mitigate with `onlyRenderVisibleElements` and simpler cards at low zoom.
2. **Cytoscape.js** is the fallback if graph algorithms and built-in layouts matter more than card richness. It draws to canvas (WebGL preview since 3.31), has compound nodes, `edgehandles` and many layouts. Rich HTML cards need overlay plugins, which gives up most of its performance advantage.
3. **Do not choose** sigma.js (WebGL, built for thousands of dot-like nodes, no compound groups or card model), Konva, or raw PIXI. Konva and PIXI are drawing libraries with no graph features, so you would build edges, ports, connecting, groups, layout glue, text editing and hit-testing yourself.
4. **Foundry's PIXI** is **7.4.3** in v13 (and fvtt-types for v14 still pins a 7.4.3 fork). It is loaded globally on every page, so a module can reuse it at zero bundle cost. Choosing raw PIXI would tie Silk to Pixi v7 APIs that Foundry plans to leave (Pixi v8 was postponed, not cancelled).
5. **Layout:** ELK (`elkjs`) is the only option that lays out groups and routes edges, but it is ~433 KB gzip and licensed EPL-2.0 OR GPL-3.0. dagre is ~16 KB gzip and MIT, but weak with groups. d3-force is ~6 KB gzip and ISC, good for untangling non-trees. Plan: dagre or d3-force by default, ELK lazy-loaded for "tidy with groups".

## Foundry context

| Fact | Source |
|---|---|
| DSA5 7.4.7 compatibility is `minimum/verified/maximum: "13"`, so v1 targets Foundry v13 | local `Data/systems/dsa5/system.json` **[src]** |
| Foundry 13.351 `package.json` depends on `"pixi.js": "^7.4.3"`, `@pixi/graphics-smooth ^1.1.1`, `@pixi/particle-emitter ^5.0.8`, `@pixi/basis ^7.4.3`; the installed `node_modules/pixi.js` is `7.4.3` | local install `resources/app/package.json` **[src]** |
| `scripts/pixi.min.js` is in the server's `CORE_VIEW_SCRIPTS`, so PIXI is a page-global script on every view, and `client/global.d.mts` declares global `PIXI` | `resources/app/dist/server/express.mjs`, `client/global.d.mts` **[src]** |
| Foundry's board is `new PIXI.Application({view: canvas, ...})` | `client/canvas/board.mjs:670` **[src]** |
| v13: "we will not be moving forward with adoption of Pixi V8 just yet", because extensions (smooth-graphics, particle-emitter) don't support v8 | [Release 13.332](https://foundryvtt.com/releases/13.332) **[src]** |
| fvtt-types `main` (v14.366.0) depends on a `foundry-vtt-types/pixi.js` fork whose version is `7.4.3` | [fvtt-types package.json](https://github.com/League-of-Foundry-Developers/foundry-vtt-types/blob/main/package.json) **[src]** |

**Reusing Foundry's PIXI [inf]:** this means creating a *second* `PIXI.Application` on a `<canvas>` inside the ApplicationV2 window, not drawing into Foundry's board. It costs one more WebGL context. Browsers cap active contexts, but two is fine. No current `pixi-viewport` release supports Pixi 7: 5.1.0 peers on `@pixi/* ^6.5.8` and 6.x needs `pixi.js >=8` (npm registry **[src]**). So pan and zoom would be hand-rolled too. If Foundry later moves to v8, every line of Silk's rendering code breaks.

## Comparison

Versions, licences and unpacked sizes come from the npm registry `latest`. Min+gzip sizes come from bundlephobia (the `@xyflow/svelte` lookup failed, so `@xyflow/react` stands in as a proxy because both wrap the same `@xyflow/system` core).

| | Svelte Flow | React Flow | Cytoscape.js | sigma.js | Konva | PIXI (Foundry's) |
|---|---|---|---|---|---|---|
| Version / licence | 1.7.0 / MIT | 12.12.0 / MIT | 3.34.3 / MIT | 4.0.2 / MIT (+ graphology 0.26 MIT) | 10.8.0 / MIT | 7.4.3 / MIT |
| Size (min+gz) | ≈ React Flow, plus Svelte runtime (svelte pkg ~11 KB gz) **[inf]** | 60 KB plus React/ReactDOM | 137 KB | 97 KB plus graphology 13 KB | 56 KB | 0 extra (global); standalone v8 is 265 KB |
| Rendering | DOM/SVG (HTML nodes, SVG edges) | same | canvas 2D; WebGL preview (3.31+) | WebGL | canvas 2D | WebGL |
| Rich cards (HTML, images, editable text) | native | native | overlay plugins (`cytoscape-dom-node` 2.1.0, `node-html-label` unmaintained since 2022) | HTML overlay synced on `afterRender` | hand-drawn shapes/text | hand-drawn; `Text` per card is a canvas texture |
| Drag-to-connect | built-in handles, `onconnect`, `isValidConnection`, `connectionMode` | same, plus "add node on edge drop" example | `cytoscape-edgehandles` 4.0.1 (MIT, updated 2026-08) | build it (drag-drop guide covers nodes only) | build it | build it |
| Groups/frames | `parentId`, `group` node type, `extent: 'parent'` | same | compound nodes (docs warn they add style/render cost) | none | `Group` (visual only) | `Container` (visual only) |
| Focus View hide/dim | `node.hidden`; `class`/`style` per node for dimming | same | `display:none` (hides edges too), `visibility`, `opacity`, `cy.batch()` | node/edge `hidden` attributes, color | `visible(false)`, opacity | `visible`, `alpha` |
| Auto-layout | external: dagre / d3-hierarchy / d3-force / elkjs, each with an official example | same | built-in plus extensions (`cytoscape-elk`, `cytoscape-fcose`, dagre) | graphology-layout-forceatlas2 etc. | none | none |
| Fit to Foundry window | mount Svelte component into AppV2 element; DOM so Foundry CSS/themes and `TextEditor` drag-drop just work **[inf]** | needs React in the module (~45 KB gz extra) **[inf]** | canvas in a div; needs `cy.resize()` on window resize | canvas in a div | canvas in a div | second WebGL context; tied to Foundry's Pixi version |

### Sources per library

**Svelte Flow / React Flow (xyflow)**
- Groups: "Set `parentId`… Child nodes are positioned relative to their parent"; `extent: 'parent'` keeps children inside; built-in `group` type. [Sub flows](https://svelteflow.dev/learn/layouting/sub-flows) **[src]**
- `Node.hidden`: "Whether or not the node should be visible on the canvas". `class` and `style` exist per node. [Node type](https://svelteflow.dev/api-reference/types/node) **[src]**
- `onlyRenderVisibleElements` renders only nodes/edges in the viewport ("adds some overhead"); `onconnect`, `connectionMode`, `isValidConnection`. [SvelteFlow props](https://svelteflow.dev/api-reference/svelte-flow) **[src]**
- Layout libraries page: dagre ("fast… known issue with sub-flows"), d3-hierarchy (single root, fixed node size), d3-force ("computing the force layout every render… big performance hit"), elkjs (sub-flows and edge routing, "most complicated", much larger bundle). [Layouting libraries](https://svelteflow.dev/learn/layouting/layouting-libraries) **[src]**
- Performance guidance targets unnecessary re-renders, collapsing large trees via `hidden`, and avoiding heavy CSS (shadows, animations). No node-count thresholds are published, and the stress example is only 100 nodes. [React Flow performance](https://reactflow.dev/learn/advanced-use/performance), [Stress example](https://reactflow.dev/examples/nodes/stress) **[src]**
- Library is MIT. The paid "Pro" tier covers some *examples* (e.g. helper lines), not the library. [reactflow.dev/pro](https://reactflow.dev/pro) **[src]**

**Cytoscape.js**
- Performance section: "Edges are particularly expensive to render"; "Drawing labels is expensive"; "Compound nodes make style calculations and rendering more expensive"; options `textureOnViewport`, `hideEdgesOnViewport`, `pixelRatio: 1`. [js.cytoscape.org#performance](https://js.cytoscape.org/#performance) **[src]**
- Visibility: "A display: none node hides its connected edges… is considered a point rather than an area in layouts"; `visibility: hidden` keeps space. [js.cytoscape.org#style/visibility](https://js.cytoscape.org/#style/visibility) **[src]**
- WebGL renderer preview in 3.31, enabled with `renderer: {name:'canvas', webgl:true}`. Measured on M1: ~1.2k nodes/16k edges went from ~20 FPS (canvas) to >100 FPS (WebGL). Dashed edges are not supported, and edge types other than straight/haystack/bezier fall back to bezier. [Cytoscape blog 2025-01-13](https://blog.js.cytoscape.org/2025/01/13/webgl-preview/) **[src]**
- Drag-to-connect: [cytoscape.js-edgehandles](https://github.com/cytoscape/cytoscape.js-edgehandles) (MIT) **[src]**

**sigma.js**
- "aimed at visualizing graphs of thousands of nodes and edges using WebGL", "built on top of graphology". [README](https://github.com/jacomyal/sigma.js) **[src]**
- Node shapes are SDF circle/square/triangle/diamond/rectangle plus custom GLSL. Images come via `@sigma/node-image`. No multi-line card model. [Shapes](https://www.sigmajs.org/how-to/nodes/shapes/) **[src]**
- HTML is done as an absolutely positioned overlay re-placed on every `afterRender` via `graphToViewport()`. [Sync HTML/SVG](https://www.sigmajs.org/how-to/layers/sync-html-svg/) **[src]**
- Tuning is about GPU fragment cost: edge antialiasing off gives "up to x5", and semi-transparency is expensive, which matters for dimming. [Performance](https://www.sigmajs.org/how-to/technical/performance/) **[src]**

**Konva**
- Tips: `listening(false)`, `cache()`, `perfectDrawEnabled(false)`, move dragged shape to its own layer, cull with `visible(false)`. "A thousand nodes each with their own attributes, transform and hit region cost far more than one custom shape". [All performance tips](https://konvajs.org/docs/performance/All_Performance_Tips.html) **[src]**

**Layout engines** (npm `latest` plus bundlephobia)

| | Version | Licence | min+gz | Groups | Notes |
|---|---|---|---|---|---|
| `@dagrejs/dagre` | 3.1.1 | MIT | 16 KB | partial | layered/DAG; synchronous |
| `d3-force` | 3.0.0 | ISC | 6 KB | no | physics; good for "untangle" on cyclic story graphs |
| `elkjs` | 0.12.0 | **EPL-2.0 OR GPL-3.0-or-later** | 433 KB | yes, plus edge routing | async, can run in a Web Worker; EPL is weak copyleft (source of elkjs and any modifications must stay available), so check against Silk's licence |

## Recommendation shortlist

1. **Svelte Flow plus dagre/d3-force, with ELK lazy-loaded.** This is the primary choice. It matches every feature in the ticket with built-ins, and cards stay ordinary Foundry-styled DOM, which also suits Info Blocks and Reveal buttons. Build a 500-card stress test into #11 first, measuring drag FPS and zoom-out FPS. Use `onlyRenderVisibleElements` and level-of-detail cards (title only below a zoom threshold).
2. **Cytoscape.js (WebGL renderer) plus edgehandles and cytoscape-elk/fcose.** This is the fallback if the DOM stress test fails. Cards become styled canvas nodes, and rich content moves to a side panel or a hover overlay.
3. Rejected: sigma.js (no groups, no card model), Konva and raw/Foundry PIXI (everything would be custom; PIXI also locks Silk to Foundry's v7 pin). React Flow does the same job as Svelte Flow but needs React in the module, so prefer Svelte unless the team prefers React.

## Open points for #11

- Real FPS of 500 Svelte Flow cards inside an AppV2 window (pop-out windows in v14 are another case).
- Whether Focus View should *hide* (smaller DOM, faster) or *dim* (keeps context, costs full render plus transparency).
- Silk's licence, if ELK is bundled.
