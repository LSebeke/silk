<script lang="ts">
  /**
   * Compendium picker (spec 1.1 §B.2, Scenes §B.2.1): search bar (focused on open), side list of sources,
   * results. ↑/↓ move, Enter picks, Esc goes back to the Source Step. A merged row ("×N") opens
   * its source list, where Esc goes back to the results. Search, source, pick and cancel run as
   * `picker.*` commands (ADR 0003).
   */
  import type { CompendiumPicker } from '../../core/canvas';
  import { fail, focus } from './actions';

  let {
    picker,
    localize,
    run,
  }: {
    picker: CompendiumPicker;
    localize: (key: string) => string;
    run: (name: string, args?: object) => Promise<unknown>;
  } = $props();

  const command = (name: string, args: object = {}) => void run(name, args).catch(fail);
  /** Picks the row (default: the active one) and closes the window. */
  const pick = (uuid?: string) => command('picker.pick', uuid ? { uuid } : {});

  function onKeydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    const keys: Record<string, () => void> = {
      ArrowDown: () => picker.move(1),
      ArrowUp: () => picker.move(-1),
      Enter: () => pick(),
      Escape: () => command('picker.cancel'),
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  }

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
    oninput={(e) => command('picker.search', { query: e.currentTarget.value })}
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
            onclick={() => command('picker.source', { id: source.id })}
            data-silk-picker-source={source.id}
          >
            <span class="name" title={source.label}
              >{source.label ?? localize('SILK.Picker.All')}</span
            >
            <span class="count">{source.count}</span>
          </button>
        </li>
      {/each}
    </ul>
    <ul class="rows" role="listbox" aria-label={localize('SILK.Picker.Results')}>
      {#if $picker.choosing !== undefined}
        <li class="choosing" data-silk-picker-choosing>
          <span class="name">{$picker.choosing}</span>
          <span class="label">{localize('SILK.Picker.ChooseSource')}</span>
        </li>
      {/if}
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
            onclick={() => pick(row.uuid)}
            data-silk-picker-row={row.uuid}
          >
            <img src={row.thumb || row.img || 'icons/svg/mystery-man.svg'} alt="" />
            {#if $picker.choosing !== undefined}
              <span class="name" title={row.label}>{row.label}</span>
              <span class="chip" data-silk-picker-outcome>
                {localize(row.source === 'world' ? 'SILK.Picker.Adopt' : 'SILK.Picker.Import')}
              </span>
            {:else}
              <span class="name">{row.name}</span>
              <!-- A merged row shows its first source's label beside the "×N" badge (§B.2). -->
              <span class="label" title={row.label} data-silk-picker-label>{row.label}</span>
              {#if row.count}
                <span class="count" data-silk-picker-count>×{row.count}</span>
              {/if}
            {/if}
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
    font-size: 11px;
    opacity: 0.7;
  }
  .label {
    margin-left: auto;
  }
  .count {
    flex: none;
  }
  .label {
    max-width: 50%;
  }
  .name,
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    flex: 1;
  }
  img {
    width: 28px;
    height: 28px;
    object-fit: cover;
    border: none;
  }
  .choosing {
    display: flex;
    gap: 6px;
    padding: 2px 6px 4px;
    font-weight: bold;
    border-bottom: 1px solid #ccc;
  }
  .chip {
    margin-left: auto;
    padding: 0 6px;
    font-size: 11px;
    border: 1px solid currentColor;
    border-radius: 8px;
    opacity: 0.8;
  }
  .empty {
    padding: 6px;
    opacity: 0.7;
  }
</style>
