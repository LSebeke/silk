<script lang="ts">
  /** Context menu entries (spec §8 Controls, §10.3), from `menu.ts`. */
  import type { MenuEntry } from './menu';

  let {
    entries,
    x,
    y,
    localize,
    onpick,
    target,
  }: {
    entries: MenuEntry[];
    x: number;
    y: number;
    localize(key: string): string;
    onpick(entry: MenuEntry): void;
    /** `data-silk-menu` value: the Node or Connection id. */
    target: string;
  } = $props();
</script>

<div
  class="silk-menu"
  style:left="{x}px"
  style:top="{y}px"
  role="menu"
  tabindex="-1"
  data-silk-menu={target}
>
  {#each entries as entry (entry.key)}
    <button
      type="button"
      role="menuitem"
      class:danger={entry.danger}
      disabled={entry.disabled}
      title={entry.hint ? localize(entry.hint) : undefined}
      onclick={(e) => {
        e.stopPropagation();
        onpick(entry);
      }}
      data-silk-menu-item={entry.key}>{localize(entry.label)}</button
    >
  {/each}
</div>

<style>
  .silk-menu {
    position: absolute;
    z-index: 25;
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 180px;
    padding: 4px;
    background: #fffdf8;
    border: 1px solid #aaa;
    border-radius: 8px;
    box-shadow: 0 4px 16px #0003;
  }
  button {
    width: 100%;
    height: 24px;
    padding: 0 8px;
    font-size: 12px;
    line-height: 22px;
    color: #222;
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 4px;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: #ece4d2;
  }
  button:disabled {
    color: #999;
    cursor: help;
  }
  .danger {
    color: #8c2f22;
  }
</style>
