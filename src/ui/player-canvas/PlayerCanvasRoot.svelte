<script lang="ts">
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/base.css';
  import PlayerCanvas from './PlayerCanvas.svelte';
  import type { PlayerCanvasContext } from './context';

  let { ctx }: { ctx: PlayerCanvasContext } = $props();
</script>

<SvelteFlowProvider>
  <PlayerCanvas {ctx} />
</SvelteFlowProvider>
