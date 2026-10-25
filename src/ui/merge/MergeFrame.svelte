<script lang="ts">
  /** Visual Group frame in the merge canvas diff (read-only). */
  import type { GroupNodeData } from '../canvas/flow-model';

  let { data }: { data: GroupNodeData } = $props();
</script>

<div class="silk-merge-frame"><span>{data.label}</span></div>

<style>
  .silk-merge-frame {
    width: 100%;
    height: 100%;
    border: 1px dashed #8a8378;
    border-radius: 8px;
    background: #ffffff06;
  }
  span {
    display: block;
    padding: 0.2rem 0.4rem;
    font-size: 11px;
    opacity: 0.8;
  }
</style>
