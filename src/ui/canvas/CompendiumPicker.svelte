<script lang="ts">
  /**
   * Compendium picker (spec 1.1 §B.2): search bar (focused on open), side list of sources,
   * results. ↑/↓ move, Enter picks, Esc goes back to the Source Step.
   */
  import type { CompendiumPicker, SourcePick } from '../../core/canvas';

  let {
    picker,
    localize,
    done,
  }: {
    picker: CompendiumPicker;
    localize: (key: string) => string;
    done: (pick: SourcePick | undefined) => void;
  } = $props();

  const sourceLabel = (s: { id: string; label?: string }) =>
    s.label ?? localize(`SILK.Picker.${s.id === 'world' ? 'World' : 'All'}`);

  function onKeydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    const keys: Record<string, () => void> = {
      ArrowDown: () => picker.move(1),
      ArrowUp: () => picker.move(-1),
      Enter: () => {
        const pick = picker.pick();
        if (pick) done(pick);
      },
      Escape: () => done(undefined),
    };
    const run = keys[event.key];
    if (!run) return;
    event.preventDefault();
    event.stopPropagation();
    run();
  }

  const focus = (el: HTMLInputElement) => {
    queueMicrotask(() => el.focus());
  };

  /** Keeps the active row in view while moving with the keys. */
  const reveal = (el: HTMLElement, active: boolean) => {
    const update = (on: boolean) => on && el.scrollIntoView({ block: 'nearest' });
    update(active);
    return { update };
  };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="silk-picker" onkeydown={onKeydown} data-silk-picker>
  <input
    type="search"
    class="search"
    placeholder={localize('SILK.Picker.Search')}
    value={$picker.query}
    oninput={(e) => picker.setQuery(e.currentTarget.value)}
    use:focus
    data-silk-picker-search
  />
  <div class="body">
    <ul class="sources" role="listbox" aria-label={localize('SILK.Picker.Sources')}>
      {#each $picker.sources as source (source.id)}
        <li>
          <button
            type="button"
            role="option"
            aria-selected={$picker.source === source.id}
            class:selected={$picker.source === source.id}
            tabindex="-1"
            onclick={() => picker.setSource(source.id)}
            data-silk-picker-source={source.id}
          >
            <span>{sourceLabel(source)}</span>
            <span class="count">{source.count}</span>
          </button>
        </li>
      {/each}
    </ul>
    <ul class="rows" role="listbox" aria-label={localize('SILK.Picker.Results')}>
      {#each $picker.rows as row, i (row.uuid)}
        <li>
          <button
            type="button"
            role="option"
            aria-selected={$picker.active === i}
            class:active={$picker.active === i}
            tabindex="-1"
            use:reveal={$picker.active === i}
            onmouseenter={() => picker.activate(i)}
            onclick={() => {
              picker.activate(i);
              const pick = picker.pick();
              if (pick) done(pick);
            }}
            data-silk-picker-row={row.uuid}
          >
            <img src={row.img || 'icons/svg/mystery-man.svg'} alt="" />
            <span class="name">{row.name}</span>
            <span class="label">{row.label ?? localize('SILK.Picker.World')}</span>
          </button>
        </li>
      {:else}
        <li class="empty">{localize('SILK.Picker.None')}</li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .silk-picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 100%;
  }
  .body {
    display: flex;
    flex: 1;
    gap: 6px;
    min-height: 0;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
  }
  .sources {
    flex: 0 0 160px;
    border-right: 1px solid #ccc;
  }
  .rows {
    flex: 1;
  }
  button {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 2px 6px;
    text-align: left;
    background: none;
    border: none;
    border-radius: 3px;
    cursor: pointer;
  }
  button.selected,
  button.active {
    background: #2b6cb033;
  }
  .count,
  .label {
    margin-left: auto;
    font-size: 11px;
    opacity: 0.7;
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  img {
    width: 28px;
    height: 28px;
    object-fit: cover;
    border: none;
  }
  .empty {
    padding: 6px;
    opacity: 0.7;
  }
</style>
