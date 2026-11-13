<script lang="ts">
  /** A section of a detail window body, with an optional title. `data-*` go on the section. */
  import type { Snippet } from 'svelte';

  let {
    title,
    children,
    ...rest
  }: { title?: string; children: Snippet; [attr: `data-${string}`]: unknown } = $props();
</script>

<section {...rest}>
  {#if title}<h3>{title}</h3>{/if}
  {@render children()}
</section>

<style>
  h3 {
    margin: 4px 0;
    font-size: 13px;
  }
</style>
