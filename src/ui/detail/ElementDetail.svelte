<script lang="ts">
  /**
   * Element Detail (spec §8 Controls): eye toggles for the element, its Appearance, each
   * Info Block and each Connection, plus the Node context menu. Every toggle runs a Reveal
   * command, which writes through to Foundry ownership. The GM sees every Connection here,
   * also those not Revealed (the journal Connections page lists Revealed ones only).
   *
   * Info Blocks (v1.1 §C.1): add, rename inline, delete with confirmation, edit the text in
   * Foundry's ProseMirror editor, open the page in Foundry, reorder by drag. All commands.
   */
  import { onDestroy, tick, untrack } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import type { Snapshot } from '../../core/canon';
  import { connectionSentence, connectionsIn } from '../../core/connections';
  import {
    appearanceBlock,
    classLabelKey,
    hasAppearanceClass,
    readElement,
  } from '../../core/elements';
  import { nodeMenu, type MenuEntry } from '../canvas/menu';
  import type { DetailContext } from './context';
  import DetailSection from './DetailSection.svelte';
  import DetailShell from './DetailShell.svelte';
  import Eye from './Eye.svelte';

  let props: { ctx: DetailContext; id: string; focus?: string | undefined } = $props();
  const ctx = untrack(() => props.ctx);
  const id = untrack(() => props.id);
  const reveal = ctx.reveal;

  let records = $state.raw<Snapshot>(ctx.workingCopy.records());
  // The working copy hands out the same (mutated) Map: copy it so `$state.raw` sees a change.
  const off = ctx.workingCopy.subscribe((r) => (records = new Map(r)));
  onDestroy(off);

  const element = $derived(readElement(records.get(id)));
  const name = (x: string) => readElement(records.get(x))?.name ?? '';
  const connections = $derived(
    connectionsIn(records)
      .filter((c) => c.from === id || c.to === id)
      .map((c) => ({ id: c.id, text: connectionSentence(c, name, ctx.format) })),
  );
  const canReveal = $derived.by(() => {
    void $reveal;
    return ctx.available('reveal.element');
  });
  // v1.1 §C.2: the Appearance block (by its flag) guards the image; deleted, nothing to Reveal.
  const appearance = $derived(!!element && !!appearanceBlock(element));
  /** An actor class without one: "+ Info Block" offers the Appearance preset. */
  const appearancePreset = $derived(!!element && hasAppearanceClass(element.class) && !appearance);
  /** Person/Creature: the Image & token button (v1.1 §G.3). */
  const imageEditor = $derived(
    !!element && hasAppearanceClass(element.class) && ctx.available('element.openImageEditor'),
  );
  const entries = $derived.by(() => {
    void $reveal;
    if (!element) return [];
    return nodeMenu(element, {
      available: ctx.available,
      title: ctx.title,
      isRevealed: ctx.reveal.isRevealed,
      selection: [],
    }).filter((e) => e.action !== 'rename' && !e.key.startsWith('element.openDetail'));
  });
  const blocks = $derived(element?.infoBlocks ?? []);
  const canEdit = ctx.available('infoBlock.edit');

  async function run(name: string, args: object) {
    try {
      await ctx.run(name, args);
    } catch (error) {
      ctx.error(error instanceof Error ? error.message : String(error));
    }
  }
  const toggle = (kind: 'element' | 'appearance' | 'infoBlock' | 'connection', target: string) =>
    run(`reveal.${kind}`, { id: target, revealed: !ctx.reveal.isRevealed(kind, target) });
  const pick = (entry: MenuEntry) => {
    if (entry.action === 'status') return run('element.toggleStatus', { id });
    if (entry.command) return run(entry.command, entry.args ?? {});
  };

  /** Focuses (and selects) a block's name field once it is rendered. */
  async function focusName(block: string) {
    await tick();
    const input = root?.querySelector<HTMLInputElement>(`[data-silk-detail-block-name="${block}"]`);
    input?.focus();
    input?.select();
  }
  let root = $state<HTMLElement>();
  $effect(() => {
    const block = props.focus;
    if (block && blocks.some((b) => b._id === block)) void focusName(block);
  });

  /** The preset menu on "+ Info Block" is open. */
  let presets = $state(false);
  async function addBlock(preset?: 'appearance') {
    try {
      const args = preset ? { elementId: id, appearance: true } : { elementId: id };
      const { id: block } = (await ctx.run('infoBlock.create', args)) as {
        id: string;
      };
      await focusName(block);
    } catch (error) {
      ctx.error(error instanceof Error ? error.message : String(error));
    }
  }
  function rename(block: { _id: string; name: string }, input: HTMLInputElement) {
    const next = input.value.trim();
    if (!next) input.value = block.name;
    else if (next !== block.name) void run('infoBlock.edit', { id: block._id, name: next });
  }
  async function remove(block: { _id: string; name: string }) {
    const yes = await ctx.confirm(
      ctx.localize('SILK.Detail.DeleteInfoBlockTitle'),
      ctx.format('SILK.Detail.DeleteInfoBlockConfirm', { name: block.name }),
    );
    if (yes) await run('infoBlock.delete', { id: block._id });
  }
  /**
   * Mounts the editor once per `{#key}` (the block's text: its own save or a Foundry edit),
   * not on other record changes, which would close an editor that is open.
   */
  const editor =
    (block: { _id: string; text: string }): Attachment<HTMLElement> =>
    (host) =>
      untrack(() => {
        const { _id: id, text: html } = block;
        return ctx.editor(host, html, (text) => void run('infoBlock.edit', { id, text }));
      });

  // Drag reorder (page `sort`), among Info Blocks only.
  let dragging = $state<string>();
  let over = $state<string>();
  function drop(target: string) {
    const moved = dragging;
    dragging = over = undefined;
    if (!moved || moved === target) return;
    const index = blocks.findIndex((b) => b._id === target);
    if (index >= 0) void run('infoBlock.move', { id: moved, index });
  }
</script>

{#snippet eye(kind: 'element' | 'appearance' | 'infoBlock' | 'connection', target: string)}
  <Eye
    on={$reveal && ctx.reveal.isRevealed(kind, target)}
    enabled={canReveal}
    localize={ctx.localize}
    onclick={() => toggle(kind, target)}
  />
{/snippet}

{#snippet header()}
  {#if element}
    {@render eye('element', id)}
    <div>
      <div class="cls">{ctx.localize(classLabelKey(element.class))}</div>
      <h2>{element.name}</h2>
    </div>
  {/if}
{/snippet}

<DetailShell data-silk-detail={id} bind:root header={element ? header : undefined}>
  {#if element}
    {#if !canReveal}
      <p class="hint" data-silk-detail-hint>{ctx.localize('SILK.Reveal.NeedsAdventure')}</p>
    {/if}
    {#if appearance || imageEditor}
      <DetailSection>
        <div class="row">
          {#if appearance}
            <span class="row appearance" data-silk-detail-appearance>
              {@render eye('appearance', id)}
              <span>{ctx.localize('SILK.Reveal.Appearance')}</span>
            </span>
          {/if}
          {#if imageEditor}
            <!-- v1.1 §G.3: Silk's editor, hood-aware (not Foundry's TokenConfig). -->
            <button
              type="button"
              class="image"
              onclick={() => run('element.openImageEditor', { id })}
              data-silk-detail-image-editor
              ><i class="fa-solid fa-image"></i>
              {ctx.title('element.openImageEditor')}</button
            >
          {/if}
        </div>
      </DetailSection>
    {/if}
    <DetailSection title={ctx.localize('SILK.Detail.InfoBlocks')}>
      {#each blocks as block (block._id)}
        <div
          class="block"
          class:over={over === block._id && dragging !== block._id}
          data-silk-detail-block={block._id}
          role="listitem"
          ondragover={(e) => {
            if (!dragging) return;
            e.preventDefault();
            over = block._id;
          }}
          ondrop={(e) => {
            e.preventDefault();
            drop(block._id);
          }}
        >
          <div class="row">
            <span
              class="grip"
              draggable={canEdit}
              role="button"
              tabindex="-1"
              title={ctx.title('infoBlock.move')}
              data-silk-detail-block-handle={block._id}
              ondragstart={(e) => {
                dragging = block._id;
                e.dataTransfer?.setData('text/plain', block._id);
                const row = (e.currentTarget as HTMLElement).closest('.block');
                if (row && e.dataTransfer) e.dataTransfer.setDragImage(row, 0, 0);
              }}
              ondragend={() => (dragging = over = undefined)}
              ><i class="fa-solid fa-grip-vertical"></i></span
            >
            {@render eye('infoBlock', block._id)}
            <input
              type="text"
              class="name"
              value={block.name}
              disabled={!canEdit}
              aria-label={ctx.localize('SILK.Detail.InfoBlockName')}
              data-silk-detail-block-name={block._id}
              onchange={(e) => rename(block, e.currentTarget)}
              onkeydown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  e.currentTarget.value = block.name;
                  e.currentTarget.blur();
                }
              }}
            />
            <button
              type="button"
              class="icon"
              title={ctx.title('infoBlock.open')}
              onclick={() => run('infoBlock.open', { id: block._id })}
              data-silk-detail-block-open={block._id}
              ><i class="fa-solid fa-arrow-up-right-from-square"></i></button
            >
            <button
              type="button"
              class="icon danger"
              disabled={!canEdit}
              title={ctx.title('infoBlock.delete')}
              onclick={() => remove(block)}
              data-silk-detail-block-delete={block._id}><i class="fa-solid fa-trash"></i></button
            >
          </div>
          {#if canEdit}
            {#key block.text}
              <div
                class="text"
                data-silk-detail-block-text={block._id}
                {@attach untrack(() => editor(block))}
              ></div>
            {/key}
          {/if}
        </div>
      {/each}
      <div class="add-group" data-silk-detail-add>
        <button
          type="button"
          class="add"
          disabled={!canEdit}
          onclick={() => addBlock()}
          data-silk-detail-add-block>{ctx.localize('SILK.Detail.AddInfoBlock')}</button
        >
        {#if appearancePreset}
          <!-- v1.1 §C.2: the "+ Info Block" control offers the Appearance preset. -->
          <button
            type="button"
            class="add caret"
            disabled={!canEdit}
            aria-haspopup="menu"
            aria-expanded={presets}
            aria-label={ctx.localize('SILK.Detail.AddPresets')}
            title={ctx.localize('SILK.Detail.AddPresets')}
            onclick={() => (presets = !presets)}
            data-silk-detail-add-menu>▾</button
          >
          {#if presets}
            <div class="presets" role="menu">
              <button
                type="button"
                role="menuitem"
                title={ctx.localize('SILK.Detail.AddAppearanceHint')}
                onclick={() => {
                  presets = false;
                  void addBlock('appearance');
                }}
                data-silk-detail-add-appearance>{ctx.localize('SILK.Detail.AddAppearance')}</button
              >
            </div>
          {/if}
        {/if}
      </div>
    </DetailSection>
    <DetailSection title={ctx.localize('SILK.Detail.Connections')}>
      {#each connections as c (c.id)}
        <div class="row" data-silk-detail-connection={c.id}>
          {@render eye('connection', c.id)}
          <span>{c.text}</span>
        </div>
      {:else}
        <p class="hint">–</p>
      {/each}
    </DetailSection>
    <DetailSection data-silk-detail-actions>
      <div class="actions">
        {#each entries as entry (entry.key)}
          <button
            type="button"
            class:danger={entry.danger}
            disabled={entry.disabled}
            title={entry.hint ? ctx.localize(entry.hint) : undefined}
            onclick={() => pick(entry)}
            data-silk-menu-item={entry.key}>{ctx.localize(entry.label)}</button
          >
        {/each}
      </div>
    </DetailSection>
  {:else}
    <p class="hint">{ctx.localize('SILK.Detail.Gone')}</p>
  {/if}
</DetailShell>

<style>
  h2 {
    margin: 0;
    border: 0;
  }
  .cls {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .appearance {
    flex: 1;
  }
  .image {
    width: auto;
    margin-left: auto;
    padding: 0 8px;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-top: 2px solid transparent;
  }
  .block.over {
    border-top-color: #2b6cb0;
  }
  .grip {
    flex: none;
    cursor: grab;
    opacity: 0.6;
  }
  .name {
    flex: 1;
    min-width: 0;
  }
  .icon {
    flex: none;
    width: 26px;
    height: 22px;
    padding: 0;
  }
  .text {
    margin-left: 22px;
  }
  /* Room for Foundry's hover edit button, also when the block is empty. */
  .text :global(prose-mirror) {
    position: relative;
    min-height: 32px;
  }
  /* Open: a fixed height for the toolbar and the editable area. */
  .text :global(prose-mirror.active) {
    height: 220px;
  }
  .add {
    width: auto;
    align-self: flex-start;
    padding: 0 8px;
  }
  .add-group {
    position: relative;
    display: flex;
    align-self: flex-start;
    gap: 2px;
  }
  .add.caret {
    padding: 0 4px;
  }
  .presets {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-width: 140px;
    padding: 2px;
    background: #fff;
    border: 1px solid #aaa;
    border-radius: 4px;
    box-shadow: 0 2px 8px #0003;
  }
  .hint {
    margin: 0;
    font-style: italic;
    opacity: 0.8;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .actions button {
    width: auto;
    padding: 0 8px;
  }
  .danger {
    color: #8c2f22;
  }
</style>
