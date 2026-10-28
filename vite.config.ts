import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  plugins: [svelte()],
  // Lib mode leaves `process.env.NODE_ENV` in dependencies (@xyflow/svelte); browsers have no `process`.
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode === 'development' ? 'development' : 'production'),
    // Dev-only commands (spec §14): `npm run dev`, or `SILK_DEV=1` for a minified perf build.
    __SILK_DEV__: JSON.stringify(mode === 'development' || process.env['SILK_DEV'] === '1'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: mode === 'development',
    minify: mode !== 'development',
    lib: {
      entry: 'src/module.ts',
      formats: ['es'],
      fileName: () => 'silk.js',
      cssFileName: 'silk',
    },
    rollupOptions: {
      output: { chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'tools/**/*.test.ts', 'e2e/**/*.test.ts'],
  },
}));
