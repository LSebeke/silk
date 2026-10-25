<script lang="ts">
  /**
   * Canvas Filters chip bar (spec §10.5): always visible; active filters as removable chips,
   * "N of M shown", one-click clear, a dimension/value picker, and the render budget warning.
   * Every action runs a `filter.*` command.
   */
  import {
    activeFilters,
    FILTER_DIMENSIONS,
    FOCUS_SEEDS,
    type FilterDimension,
  } from '../../core/canvas';
  import type { FilterResult } from '../../core/canvas/filters';
  import type { CanvasContext } from './context';
  import { filterOptions, valueLabel, type ChipLabel } from './filter-chips';

  let { ctx, result }: { ctx: CanvasContext; result: FilterResult } = $props();

  const fail = (error: unknown) => console.error(error);
  const run = (name: string, args?: object) => ctx.run(name, args).catch(fail);
  const text = (label: ChipLabel) => ('key' in label ? ctx.localize(label.key) : label.text);
  const fmt = (key: string, data: Record<string, number>) =>
    Object.entries(data).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), ctx.localize(key));

  // Recomputed with every result (records or filters changed).
  const chips = $derived.by(() => {
    void result;
    const records = ctx.workingCopy.records();
    return activeFilters(ctx.filter.filters()).flatMap(([dimension, values]) =>
      values.map((value) => ({
        dimension,
        value,
        values,
        label: text(valueLabel(records, dimension, value)),
      })),
    );
  });
  const expanded = $derived.by(() => {
    void result;
    return ctx.filter.expanded().length;
  });

  // Focus View (§10.6): the `hops` dimension holding the live seeds; N set here.
  const focusOn = $derived.by(() => {
    void result;
    return !!ctx.filter.filters().hops?.includes(FOCUS_SEEDS);
  });
  const hops = $derived.by(() => {
    void result;
    return ctx.focus.hops();
  });
  function toggleFocus() {
    const values = ctx.filter.filters().hops ?? [];
    void run('filter.set', {
      dimension: 'hops',
      values: focusOn ? values.filter((v) => v !== FOCUS_SEEDS) : [...values, FOCUS_SEEDS],
    });
  }

  let dimension = $state<FilterDimension | ''>('');
  const options = $derived.by(() => {
    void result;
    return dimension
      ? filterOptions(ctx.workingCopy.records(), dimension, ctx.state.get().selection)
      : [];
  });

  function remove(chip: { dimension: FilterDimension; value: string; values: readonly string[] }) {
    void run('filter.set', {
      dimension: chip.dimension,
      values: chip.values.filter((v) => v !== chip.value),
    });
  }

  function add(value: string) {
    if (!dimension || !value) return;
    const current = ctx.filter.filters()[dimension] ?? [];
    void run('filter.set', { dimension, values: [...current, value] });
    dimension = '';
  }
</script>

<div class="silk-filter-bar nodrag nopan" data-silk-filter-bar>
  <button
    type="button"
    class="focus"
    class:on={focusOn}
    aria-pressed={focusOn}
    onclick={toggleFocus}
    data-silk-action="focus-toggle"
  >
    <i class="fa-solid fa-bullseye"></i>
    {ctx.localize('SILK.Focus.Toggle')}
  </button>
  {#if focusOn}
    <label class="hops">
      {ctx.localize('SILK.Focus.Hops')}
      <select
        value={String(hops)}
        onchange={(e) => run('focus.setHops', { n: Number(e.currentTarget.value) })}
        data-silk-focus-hops
      >
        {#each [0, 1, 2, 3, 4, 5] as n (n)}
          <option value={String(n)}>{n}</option>
        {/each}
      </select>
    </label>
  {/if}
  {#each chips as chip (chip.dimension + '\u0000' + chip.value)}
    <span class="chip" data-silk-filter-chip={chip.dimension} data-silk-filter-value={chip.value}>
      <b>{ctx.localize(`SILK.Filter.Dimension.${chip.dimension}`)}:</b>
      {chip.label}
      <button
        type="button"
        aria-label={ctx.localize('SILK.Filter.Clear')}
        onclick={() => remove(chip)}
        data-silk-action="filter-remove">×</button
      >
    </span>
  {/each}
  {#if expanded}
    <span class="chip extra" data-silk-filter-expanded>
      {fmt('SILK.Filter.Expanded', { n: expanded })}
    </span>
  {/if}
  <select
    bind:value={dimension}
    aria-label={ctx.localize('SILK.Filter.Add')}
    data-silk-filter-dimension
  >
    <option value="">{ctx.localize('SILK.Filter.Add')}</option>
    {#each FILTER_DIMENSIONS as d (d)}
      <option value={d}>{ctx.localize(`SILK.Filter.Dimension.${d}`)}</option>
    {/each}
  </select>
  {#if dimension}
    <select onchange={(e) => add(e.currentTarget.value)} data-silk-filter-option>
      <option value="">…</option>
      {#each options as option (option.value)}
        <option value={option.value}>{text(option.label)}</option>
      {/each}
    </select>
  {/if}
  <span class="count" data-silk-filter-count
    >{fmt('SILK.Filter.Shown', { n: result.visible.size, m: result.total })}</span
  >
  {#if result.active || expanded}
    <button type="button" onclick={() => run('filter.clear', {})} data-silk-action="filter-clear">
      {ctx.localize('SILK.Filter.Clear')}
    </button>
  {/if}
</div>
{#if result.visible.size > ctx.renderBudget}
  <div class="silk-render-budget" role="status" data-silk-render-budget>
    {fmt('SILK.Filter.Budget', { n: result.visible.size, max: ctx.renderBudget })}
  </div>
{/if}

<style>
  .silk-filter-bar {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 15;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    max-width: calc(50% - 60px);
    padding: 3px 6px;
    font-size: 12px;
    background: #fffdf8;
    border: 1px solid #c9bfa8;
    border-radius: 6px;
    box-shadow: 0 1px 3px #0003;
  }
  .chip {
    display: inline-flex;
    gap: 3px;
    align-items: center;
    padding: 0 2px 0 6px;
    line-height: 20px;
    white-space: nowrap;
    background: #e8e0cc;
    border-radius: 10px;
  }
  .chip.extra {
    padding-right: 6px;
  }
  .chip button,
  .silk-filter-bar > button {
    width: auto;
    min-height: 0;
    padding: 0 6px;
    font-size: 12px;
    line-height: 18px;
  }
  .chip button {
    padding: 0 4px;
    border: 0;
    background: none;
  }
  .silk-filter-bar > button.focus.on {
    color: #fff;
    background: #2b6cb0;
  }
  .hops {
    display: inline-flex;
    gap: 3px;
    align-items: center;
    white-space: nowrap;
  }
  select {
    width: auto;
    height: 22px;
    font-size: 12px;
  }
  .count {
    white-space: nowrap;
    opacity: 0.75;
  }
  .silk-render-budget {
    position: absolute;
    top: 44px;
    left: 8px;
    z-index: 15;
    max-width: 360px;
    padding: 4px 8px;
    font-size: 12px;
    background: #fff4d6;
    border: 1px solid #c07a20;
    border-radius: 6px;
  }
</style>
