import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
// #17: Foundry makes Array.prototype.equals non-writable; Cytoscape's collection prototype (Object.create(Array.prototype))
// gets its methods by assignment and throws on `equals`. Define them instead.
const cytoscapeFoundryPatch = { name: 'cytoscape-foundry-patch', transform(code, id) {
  if (!id.includes('cytoscape.esm')) return;
  return code.replace('extend(elesfn$1, props);', 'for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(props))) Object.defineProperty(elesfn$1, k, d);');
} };
export default defineConfig({
  plugins: [svelte({ compilerOptions: { css: 'injected' } }), cytoscapeFoundryPatch],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: { lib: { entry: 'src/main.js', formats: ['es'], fileName: () => 'silk-proto.js', cssFileName: 'silk-proto' }, outDir: 'dist', minify: false, sourcemap: true },
});
