<script lang="ts">
  /**
   * Where the side not taken has a moved Node (spec §11.4 "Layout: shown as outlines"):
   * Canon blue, Adventure orange.
   */
  let { data }: { data: { label: string; side: 'ours' | 'theirs' } } = $props();
</script>

<div class="silk-merge-outline {data.side}" data-silk-merge-outline={data.side}>{data.label}</div>

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
  .silk-merge-outline.theirs {
    border-color: #e8915a;
    color: #e8915a;
  }
</style>
