import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  plugins: [svelte({ compilerOptions: { css: 'injected' } })],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: { lib: { entry: 'src/main.js', formats: ['es'], fileName: () => 'silk-proto.js', cssFileName: 'silk-proto' }, outDir: 'dist', minify: false, sourcemap: true },
});
