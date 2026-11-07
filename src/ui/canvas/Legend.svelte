<script lang="ts">
  /**
   * Canvas legend (spec 1.1 §E.3): bottom left, open by default; the "?" button and the `?` key
   * run `legend.toggle`. Rows come from `legendGroups` (the canvas's own tables). Foundry
   * keybindings are read each time it opens, so rebinds show. The panel is see-through to
   * the pointer: canvas gestures (right-drag, clicks, wheel) work under it.
   */
  import { legendGroups, type LegendRow } from './legend';
  import { untrack } from 'svelte';
  import type { CanvasContext } from './context';

  let { ctx }: { ctx: CanvasContext } = $props();
  /** Fixed for the window's lifetime. */
  const open = untrack(() => ctx.legend);
  const groups = $derived($open ? legendGroups(ctx.keybindings()) : []);

  function text(row: LegendRow): string {
    let label = ctx.localize(row.label);
    for (const [name, key] of Object.entries(row.args ?? {}))
      label = label.replace(`{${name}}`, ctx.localize(key));
    return label;
  }
  const toggle = () => ctx.run('legend.toggle').catch(console.error);
</script>

<div class="silk-legend" data-silk-legend>
  {#if $open}
    <div class="panel" aria-label={ctx.localize('SILK.Legend.Title')} data-silk-legend-panel>
      {#each groups as group (group.id)}
        <section data-silk-legend-group={group.id}>
          <h4>{ctx.localize(group.title)}</h4>
          {#each group.rows as row, i (i)}
            {#if row.heading}
              <h5>{text(row)}</h5>
            {:else}
              <div class="row">
                {#if row.keys.length}
                  <span class="keys">
                    {#each row.keys as key, k (k)}<kbd>{key}</kbd>{/each}
                  </span>
                {/if}
                <span>
                  {text(row)}
                  {#if row.when}<em>({ctx.localize(row.when)})</em>{/if}
                </span>
              </div>
            {/if}
          {:else}
            <div class="row muted">{ctx.localize('SILK.Legend.None')}</div>
          {/each}
        </section>
      {/each}
    </div>
  {/if}
  <button
    type="button"
    class:active={$open}
    title={ctx.localize('SILK.Legend.Toggle')}
    onclick={toggle}
    data-silk-action="legend"
  >
    ?
  </button>
</div>

<style>
  .silk-legend {
    position: absolute;
    bottom: 8px;
    left: 8px;
    z-index: 12;
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;
    max-width: calc(100% - 16px);
    max-height: calc(100% - 96px);
    pointer-events: none;
  }
  /* Groups side by side, so the panel stays low. */
  .panel {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    min-height: 0;
    padding: 4px 8px;
    overflow: hidden;
    font-size: 10px;
    line-height: 1.3;
    background: #fffdf8d9;
    border: 1px solid #c9bfa8;
    border-radius: 6px;
    box-shadow: 0 1px 3px #0003;
  }
  section {
    width: 240px;
  }
  h4 {
    margin: 2px 0;
    font-size: 11px;
    border-bottom: 1px solid #e3dccb;
  }
  h5 {
    margin: 3px 0 1px;
    font-size: 10px;
    font-weight: normal;
    font-style: italic;
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .keys {
    display: flex;
    flex-shrink: 0;
    gap: 2px;
  }
  kbd {
    padding: 0 3px;
    font-size: 10px;
    background: #f4efe4;
    border: 1px solid #c9bfa8;
    border-radius: 3px;
  }
  em {
    opacity: 0.7;
  }
  .muted {
    opacity: 0.6;
  }
  button {
    pointer-events: auto;
    width: 28px;
    height: 28px;
    min-height: 0;
    padding: 0;
    font-weight: bold;
    background: #fffdf8;
    border: 1px solid #c9bfa8;
    border-radius: 6px;
  }
  button.active {
    border-color: #2b6cb0;
  }
</style>
