<script lang="ts">
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/base.css';
  import MergePanel from './MergePanel.svelte';
  import type { MergePanelProps } from './MergeWindow';

  let props: MergePanelProps = $props();
</script>

<SvelteFlowProvider>
  <MergePanel {...props} />
</SvelteFlowProvider>
