<script lang="ts">
  /**
   * Canvas legend (spec 1.1 §E.3): bottom left, open by default; the "?" button and the `?` key
   * run `legend.toggle`. Rows come from `legendGroups` (the canvas's own tables). Foundry
   * keybindings are read each time it opens, so rebinds show.
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
    <div class="panel" data-silk-legend-panel>
      <header>{ctx.localize('SILK.Legend.Title')}</header>
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
    max-height: calc(100% - 96px);
    pointer-events: none;
  }
  .silk-legend > * {
    pointer-events: auto;
  }
  .panel {
    width: 300px;
    min-height: 0;
    padding: 6px 8px;
    overflow-y: auto;
    font-size: 11px;
    line-height: 1.35;
    background: #fffdf8e6;
    border: 1px solid #c9bfa8;
    border-radius: 6px;
    box-shadow: 0 1px 3px #0003;
  }
  header {
    margin-bottom: 2px;
    font-weight: bold;
  }
  h4 {
    margin: 6px 0 2px;
    font-size: 11px;
    border-bottom: 1px solid #e3dccb;
  }
  h5 {
    margin: 4px 0 1px;
    font-size: 11px;
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
