<script lang="ts">
  /**
   * Connection Detail (v1.1 §F.2): both endpoints (each opens its Element Detail), the label
   * inline (free-form only), type and direction selects, Reverse, the eye, Notes (GM-only
   * rich text in Foundry's ProseMirror editor) and Delete with a confirmation. All commands.
   */
  import { untrack } from 'svelte';
  import {
    connectionSentence,
    readConnection,
    typeOptions,
    type ConnectionDirection,
    type ConnectionType,
  } from '../../core/connections';
  import { readElement } from '../../core/elements';
  import type { DetailContext } from './context';
  import DetailSection from './DetailSection.svelte';
  import DetailShell from './DetailShell.svelte';
  import Eye from './Eye.svelte';
  import RichText from './RichText.svelte';
  import { liveRecords, runner } from './live.svelte';

  let props: { ctx: DetailContext; id: string; close?: () => void } = $props();
  const ctx = untrack(() => props.ctx);
  const id = untrack(() => props.id);
  const reveal = ctx.reveal;
  const live = liveRecords(ctx);
  const run = runner(ctx);

  const connection = $derived(readConnection(live.current.get(id)));
  const name = (x: string) => readElement(live.current.get(x))?.name ?? '';
  const sentence = $derived(connection && connectionSentence(connection, name, ctx.format));
  const free = $derived(connection?.type === 'free');
  const types = $derived(connection ? typeOptions(live.current, connection) : []);
  const canEdit = ctx.available('connection.setLabel');
  const canReveal = $derived.by(() => {
    void $reveal;
    return ctx.available('reveal.connection');
  });
  const revealed = $derived($reveal && ctx.reveal.isRevealed('connection', id));

  function saveLabel(input: HTMLInputElement) {
    if (!connection || input.value.trim() === connection.label) return;
    void run('connection.setLabel', { id, label: input.value });
  }
  const setType = (type: ConnectionType) => run('connection.setType', { id, type });
  const setDirection = (direction: ConnectionDirection) =>
    run('connection.setDirection', { id, direction });

  async function remove() {
    const yes = await ctx.confirm(
      ctx.localize('SILK.ConnectionDetail.DeleteTitle'),
      ctx.format('SILK.ConnectionDetail.DeleteConfirm', { sentence: sentence ?? '' }),
    );
    if (!yes) return;
    await run('connection.delete', { ids: [id] });
    props.close?.();
  }
</script>

{#snippet endpoint(end: string, role: 'from' | 'to')}
  <button
    type="button"
    class="end"
    title={ctx.title('element.openDetail')}
    onclick={() => run('element.openDetail', { id: end })}
    data-silk-connection-detail-end={role}>{name(end)}</button
  >
{/snippet}

{#snippet header()}
  <Eye
    on={revealed}
    enabled={canReveal}
    localize={ctx.localize}
    onclick={() => run('reveal.connection', { id, revealed: !revealed })}
  />
  <h2 class="title">{sentence}</h2>
{/snippet}

<DetailShell data-silk-connection-detail={id} header={connection ? header : undefined}>
  {#if connection}
    {#if !canReveal}
      <p class="hint">{ctx.localize('SILK.Reveal.NeedsAdventure')}</p>
    {/if}
    <DetailSection>
      <div class="row">
        {@render endpoint(connection.from, 'from')}
        <span class="arrow" aria-hidden="true">{connection.direction === 'mutual' ? '↔' : '→'}</span
        >
        {@render endpoint(connection.to, 'to')}
      </div>
    </DetailSection>
    <DetailSection>
      {#if free}
        <label class="field">
          <span>{ctx.localize('SILK.ConnectionDetail.Label')}</span>
          <input
            type="text"
            value={connection.label}
            disabled={!canEdit}
            placeholder={ctx.localize('SILK.Canvas.LabelPlaceholder')}
            onkeydown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              else if (e.key === 'Escape') {
                // Before Foundry's Escape (closes the window) and the blur save.
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.value = connection?.label ?? '';
                e.currentTarget.blur();
              }
            }}
            onblur={(e) => saveLabel(e.currentTarget)}
            data-silk-connection-detail-label
          />
        </label>
      {/if}
      <label class="field">
        <span>{ctx.localize('SILK.ConnectionDetail.Type')}</span>
        <select
          value={connection.type}
          disabled={!canEdit}
          onchange={(e) => setType(e.currentTarget.value as ConnectionType)}
          data-silk-connection-detail-type
        >
          {#each types as type (type)}
            <option value={type}>{ctx.localize(`SILK.Connection.Type.${type}`)}</option>
          {/each}
        </select>
      </label>
      <div class="field">
        <label for="silk-connection-direction-{id}"
          >{ctx.localize('SILK.ConnectionDetail.Direction')}</label
        >
        <div class="row">
          <select
            id="silk-connection-direction-{id}"
            value={connection.direction}
            disabled={!canEdit || !free}
            onchange={(e) => setDirection(e.currentTarget.value as ConnectionDirection)}
            data-silk-connection-detail-direction
          >
            <option value="directed">{ctx.localize('SILK.ConnectionDetail.Directed')}</option>
            <option value="mutual">{ctx.localize('SILK.ConnectionDetail.Mutual')}</option>
          </select>
          <button
            type="button"
            class="reverse"
            disabled={!canEdit || connection.direction === 'mutual'}
            title={ctx.title('connection.flip')}
            onclick={() => run('connection.flip', { id })}
            data-silk-connection-detail-reverse
            ><i class="fa-solid fa-right-left"></i>
            {ctx.localize('SILK.ConnectionDetail.Reverse')}</button
          >
        </div>
      </div>
    </DetailSection>
    <DetailSection title={ctx.localize('SILK.ConnectionDetail.Notes')}>
      <p class="hint">{ctx.localize('SILK.ConnectionDetail.NotesHint')}</p>
      {#if ctx.available('connection.setNotes')}
        <RichText
          mount={ctx.editor}
          html={connection.notes ?? ''}
          save={(notes) => void run('connection.setNotes', { id, notes })}
          data-silk-connection-detail-notes
        />
      {/if}
    </DetailSection>
    <DetailSection>
      <button
        type="button"
        class="delete danger"
        disabled={!ctx.available('connection.delete')}
        onclick={remove}
        data-silk-connection-detail-delete
        ><i class="fa-solid fa-trash"></i> {ctx.title('connection.delete')}</button
      >
    </DetailSection>
  {:else}
    <p class="hint">{ctx.localize('SILK.ConnectionDetail.Gone')}</p>
  {/if}
</DetailShell>

<style>
  h2 {
    margin: 0;
    border: 0;
  }
  .title {
    flex: 1;
    min-width: 0;
    font-size: 15px;
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .end {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .arrow {
    flex: none;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .field select {
    flex: 1;
  }
  .reverse,
  .delete {
    flex: none;
    width: auto;
    padding: 0 8px;
  }
  .delete {
    align-self: flex-start;
  }
  .hint {
    margin: 0;
    font-style: italic;
    opacity: 0.8;
  }
  .danger {
    color: #8c2f22;
  }
</style>
