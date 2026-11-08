<script lang="ts">
  /**
   * A canvas card's name (spec 1.1 §E.1, §G.5), shared by the GM's ElementCard and the
   * PlayerCard. `title`: wrapped, no line limit at full zoom, at most 3 lines at the lower zoom
   * levels. `block`: the big name of the coloured block at the lowest zoom level, shown only
   * there (`.lod-block` on the canvas root), at most 3 lines.
   */
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    name,
    variant,
    ...rest
  }: { name: string; variant: 'title' | 'block' } & HTMLAttributes<HTMLDivElement> = $props();
</script>

<div class="silk-card-name {variant}" data-silk-card-name={variant} {...rest}>{name}</div>

<style>
  .silk-card-name {
    font-weight: 700;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .title {
    font-size: 13px;
    line-height: 1.25;
  }
  .block {
    display: none;
    font-size: 30px;
    line-height: 1.1;
    color: #fff;
  }
  :global(.lod-title) .title,
  :global(.lod-block) .block {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
  }
  :global(.lod-title) .title {
    font-size: 18px;
  }
</style>
