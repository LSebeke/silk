<script lang="ts">
  /** Where the Canon has a moved Node (spec §11.4 "Layout: shown as outlines"). */
  let { data }: { data: { label: string } } = $props();
</script>

<div class="silk-merge-outline" data-silk-merge-outline>{data.label}</div>

<style>
  .silk-merge-outline {
    width: 190px;
    height: 48px;
    border: 1px dashed #6fa8dc;
    border-radius: 6px;
    color: #6fa8dc;
    font-size: 10px;
    padding: 0.2rem 0.4rem;
    pointer-events: none;
  }
</style>
