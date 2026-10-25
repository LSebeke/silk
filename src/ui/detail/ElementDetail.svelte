<script lang="ts">
  /**
   * Element Detail (spec §8 Controls): eye toggles for the element, its Appearance, each
   * Info Block and each Connection, plus the Node context menu. Every toggle runs a Reveal
   * command, which writes through to Foundry ownership. The GM sees every Connection here,
   * also those not Revealed (the journal Connections page lists Revealed ones only).
   */
  import { onDestroy, untrack } from 'svelte';
  import type { Snapshot } from '../../core/canon';
  import { connectionSentence, connectionsIn } from '../../core/connections';
  import { classLabelKey, readElement } from '../../core/elements';
  import { nodeMenu, type MenuEntry } from '../canvas/menu';
  import type { DetailContext } from './context';

  let props: { ctx: DetailContext; id: string } = $props();
  const ctx = untrack(() => props.ctx);
  const id = untrack(() => props.id);
  const reveal = ctx.reveal;

  let records = $state.raw<Snapshot>(ctx.workingCopy.records());
  const off = ctx.workingCopy.subscribe((r) => (records = r));
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
  const appearance = $derived(element?.class === 'person' || element?.class === 'creature');
  const entries = $derived.by(() => {
    void $reveal;
    if (!element) return [];
    return nodeMenu(element, {
      available: ctx.available,
      title: ctx.title,
      isRevealed: ctx.reveal.isRevealed,
      selection: [],
    }).filter((e) => e.action !== 'rename' && e.key !== 'element.openDetail');
  });

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
</script>

{#snippet eye(kind: 'element' | 'appearance' | 'infoBlock' | 'connection', target: string)}
  {@const on = $reveal && ctx.reveal.isRevealed(kind, target)}
  <button
    type="button"
    class="eye"
    class:on
    disabled={!canReveal}
    title={ctx.localize(
      canReveal
        ? on
          ? 'SILK.Reveal.Unreveal'
          : 'SILK.Reveal.Reveal'
        : 'SILK.Reveal.NeedsAdventure',
    )}
    onclick={() => toggle(kind, target)}
    data-silk-eye={on ? 'on' : 'off'}
    ><i class="fa-solid {on ? 'fa-eye' : 'fa-eye-slash'}"></i></button
  >
{/snippet}

<div class="silk-detail" data-silk-detail={id}>
  {#if element}
    <header>
      {@render eye('element', id)}
      <div>
        <div class="cls">{ctx.localize(classLabelKey(element.class))}</div>
        <h2>{element.name}</h2>
      </div>
    </header>
    {#if !canReveal}
      <p class="hint" data-silk-detail-hint>{ctx.localize('SILK.Reveal.NeedsAdventure')}</p>
    {/if}
    {#if appearance}
      <section>
        <div class="row" data-silk-detail-appearance>
          {@render eye('appearance', id)}
          <span>{ctx.localize('SILK.Reveal.Appearance')}</span>
        </div>
      </section>
    {/if}
    <section>
      <h3>{ctx.localize('SILK.Detail.InfoBlocks')}</h3>
      {#each element.infoBlocks ?? [] as block (block._id)}
        <div class="row" data-silk-detail-block={block._id}>
          {@render eye('infoBlock', block._id)}
          <span>{block.name}</span>
        </div>
      {/each}
    </section>
    <section>
      <h3>{ctx.localize('SILK.Detail.Connections')}</h3>
      {#each connections as c (c.id)}
        <div class="row" data-silk-detail-connection={c.id}>
          {@render eye('connection', c.id)}
          <span>{c.text}</span>
        </div>
      {:else}
        <p class="hint">–</p>
      {/each}
    </section>
    <section class="actions" data-silk-detail-actions>
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
    </section>
  {:else}
    <p class="hint">{ctx.localize('SILK.Detail.Gone')}</p>
  {/if}
</div>

<style>
  .silk-detail {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px;
  }
  header {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  h2 {
    margin: 0;
    border: 0;
  }
  h3 {
    margin: 4px 0;
    font-size: 13px;
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
  .eye {
    flex: none;
    width: 26px;
    height: 22px;
    padding: 0;
    color: #999;
  }
  .eye.on {
    color: #2b6cb0;
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
