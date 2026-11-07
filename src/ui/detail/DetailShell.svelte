<script lang="ts">
  /**
   * Shell of every detail window (Element Detail; Connection Detail, v1.1 §F.2): a fixed
   * header and a scrolling body (§G.1). Extra attributes (`data-*`) go on the root.
   */
  import type { Snippet } from 'svelte';

  let {
    header,
    children,
    root = $bindable(),
    ...rest
  }: {
    header?: Snippet;
    children: Snippet;
    /** The root element, e.g. to find a field to focus. */
    root?: HTMLElement;
    [attr: `data-${string}`]: unknown;
  } = $props();
</script>

<div class="silk-detail" bind:this={root} {...rest}>
  {#if header}
    <header>{@render header()}</header>
  {/if}
  <div class="body" data-silk-detail-body>{@render children()}</div>
</div>

<style>
  .silk-detail {
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-sizing: border-box;
    height: 100%;
    min-height: 0;
    /* §G.1; every detail window (Connection Detail, image editor) gets it. */
    padding: 4px 16px;
  }
  header {
    display: flex;
    flex: none;
    gap: 8px;
    align-items: center;
  }
  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    overflow-y: auto;
  }
</style>
