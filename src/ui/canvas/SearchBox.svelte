<script lang="ts">
  /**
   * Search (spec §10.8) and `c` connect search (§10.3): one box over `canvas.search`.
   * Results: Nodes, Tags (expanded into their elements), Info Block text. In connect mode
   * the default entry "New Node" asks the direction, then the Creation Pipeline runs.
   */
  import type { SearchHit } from '../../core/canvas/search';
  import type { RelativeDirection } from '../../core/connections';
  import { classLabelKey, elementClass } from '../../core/elements';
  import type { CanvasContext } from './context';

  let {
    ctx,
    mode,
    exclude,
    onpick,
    onnew,
    onclose,
  }: {
    ctx: CanvasContext;
    mode: 'search' | 'connect';
    /** Not offered (the connect origin). */
    exclude?: string;
    onpick(id: string): void;
    onnew?(direction: RelativeDirection): void;
    onclose(): void;
  } = $props();

  type Entry =
    | { kind: 'new' }
    | { kind: 'header'; label: string }
    | { kind: 'element'; id: string; name: string; cls: string; ghost?: boolean; sub?: string };

  let query = $state('');
  let hits = $state.raw<SearchHit[]>([]);
  let active = $state(0);
  /** Connect "New Node": choosing the direction. */
  let direction = $state<RelativeDirection | undefined>();
  const DIRECTIONS: RelativeDirection[] = ['out', 'in', 'mutual'];

  const entries = $derived.by((): Entry[] => {
    const out: Entry[] = mode === 'connect' ? [{ kind: 'new' }] : [];
    for (const hit of hits) {
      if (hit.kind === 'node') {
        if (hit.id !== exclude)
          out.push({
            kind: 'element',
            id: hit.id,
            name: hit.name,
            cls: hit.class,
            ghost: hit.ghost,
          });
      } else if (hit.kind === 'tag') {
        out.push({ kind: 'header', label: `#${hit.tag}` });
        for (const e of hit.elements)
          if (e.id !== exclude)
            out.push({ kind: 'element', id: e.id, name: e.name, cls: e.class, ghost: e.ghost });
      } else if (hit.id !== exclude) {
        out.push({
          kind: 'element',
          id: hit.id,
          name: hit.name,
          cls: '',
          sub: `${hit.block}: ${hit.snippet}`,
        });
      }
    }
    return out;
  });
  const pickable = $derived(entries.flatMap((e, i) => (e.kind === 'header' ? [] : [i])));

  let seq = 0;
  async function onInput(value: string) {
    query = value;
    active = 0;
    const mine = ++seq;
    const result = (await ctx.run('canvas.search', { query: value })) as SearchHit[];
    if (mine === seq) hits = result;
  }

  function choose(entry: Entry | undefined) {
    if (!entry || entry.kind === 'header') return;
    if (entry.kind === 'new') direction = 'out';
    else onpick(entry.id);
  }

  function onKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    const n = direction ? DIRECTIONS.length : pickable.length;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (direction) direction = undefined;
      else onclose();
    } else if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      (direction && (event.key === 'ArrowLeft' || event.key === 'ArrowRight'))
    ) {
      event.preventDefault();
      if (!n) return;
      const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      if (direction) {
        const i = DIRECTIONS.indexOf(direction);
        direction = DIRECTIONS[(i + step + n) % n];
      } else active = (active + step + n) % n;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (direction) onnew?.(direction);
      else choose(entries[pickable[active] ?? -1]);
    }
  }

  const focus = (el: HTMLElement) => {
    const win = el.ownerDocument.defaultView ?? window;
    let tries = 20;
    const attempt = () => {
      el.focus();
      if (el.ownerDocument.activeElement !== el && --tries > 0) win.requestAnimationFrame(attempt);
    };
    win.requestAnimationFrame(attempt);
  };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="silk-search" data-silk-search={mode} onkeydown={onKeydown}>
  {#if direction}
    <div class="title" data-silk-connect-hint>{ctx.localize('SILK.Canvas.NewNodeDirection')}</div>
    <div class="directions" role="radiogroup" tabindex="-1" use:focus data-silk-directions>
      {#each DIRECTIONS as d (d)}
        <button
          type="button"
          class:active={d === direction}
          onclick={() => onnew?.(d)}
          data-silk-direction={d}
        >
          {ctx.localize(`SILK.Connection.Point.${d}`)}
        </button>
      {/each}
    </div>
  {:else}
    {#if mode === 'connect'}
      <div class="title" data-silk-connect-hint>{ctx.localize('SILK.Canvas.ConnectHint')}</div>
    {/if}
    <input
      type="search"
      value={query}
      placeholder={ctx.localize('SILK.Canvas.SearchPlaceholder')}
      oninput={(e) => void onInput(e.currentTarget.value).catch(console.error)}
      use:focus
      data-silk-search-input
    />
    <div class="results" role="listbox">
      {#each entries as entry, i (i)}
        {#if entry.kind === 'header'}
          <div class="header" data-silk-search-tag>{entry.label}</div>
        {:else if entry.kind === 'new'}
          <button
            type="button"
            role="option"
            aria-selected={pickable[active] === i}
            class:active={pickable[active] === i}
            onclick={() => choose(entry)}
            data-silk-search-new
          >
            <i class="fa-solid fa-plus"></i>
            {ctx.localize('SILK.Canvas.NewNode')}
          </button>
        {:else}
          <button
            type="button"
            role="option"
            aria-selected={pickable[active] === i}
            class:active={pickable[active] === i}
            class:ghost={entry.ghost}
            style:--silk-class={elementClass(entry.cls)?.color ?? '#999'}
            onclick={() => choose(entry)}
            data-silk-search-hit={entry.id}
          >
            <span class="name">{entry.name}</span>
            {#if entry.sub}
              <span class="sub">{entry.sub}</span>
            {:else if entry.cls}
              <span class="sub">{ctx.localize(classLabelKey(entry.cls as never))}</span>
            {/if}
          </button>
        {/if}
      {/each}
      {#if query.trim() && !hits.length}
        <div class="empty" data-silk-search-empty>{ctx.localize('SILK.Canvas.SearchEmpty')}</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .silk-search {
    position: absolute;
    top: 44px;
    left: 50%;
    z-index: 25;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 320px;
    padding: 6px;
    font-size: 12px;
    color: #222;
    background: #fffdf8;
    border: 1px solid #aaa;
    border-radius: 8px;
    box-shadow: 0 4px 16px #0003;
    transform: translateX(-50%);
  }
  input {
    height: 26px;
    color: #222;
    background: #fff;
  }
  .title {
    opacity: 0.8;
  }
  .results {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 320px;
    overflow-y: auto;
  }
  .header {
    padding: 2px 4px 0;
    font-weight: bold;
    opacity: 0.7;
  }
  button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    min-height: 26px;
    padding: 2px 6px;
    font-size: 12px;
    line-height: 16px;
    color: #222;
    text-align: left;
    background: #fff;
    border: 1px solid #ddd;
    border-left: 4px solid var(--silk-class, #2b6cb0);
    border-radius: 4px;
    cursor: pointer;
  }
  button.active {
    outline: 1px solid #2b6cb0;
  }
  button.ghost .name {
    opacity: 0.6;
  }
  .sub {
    overflow: hidden;
    max-width: 100%;
    font-size: 11px;
    white-space: nowrap;
    text-overflow: ellipsis;
    opacity: 0.7;
  }
  .directions {
    display: flex;
    gap: 4px;
    outline: none;
  }
  .directions button {
    align-items: center;
  }
  .empty {
    padding: 4px;
    opacity: 0.6;
  }
</style>
