<script lang="ts">
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/base.css';
  import Canvas from './Canvas.svelte';
  import type { CanvasContext } from './context';

  let { ctx }: { ctx: CanvasContext } = $props();
</script>

<SvelteFlowProvider>
  <Canvas {ctx} />
</SvelteFlowProvider>
