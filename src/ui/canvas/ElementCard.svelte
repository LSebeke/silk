<script lang="ts">
  /**
   * Story Element card (spec §10.2, 1.1 §E.1). The zoom level comes from `.lod-*` on the
   * canvas root, so zooming changes classes once, not per card. Ghosts render faint. The name
   * wraps and the card grows; layout reads the measured size (Canvas → `measureWith`).
   */
  import { fail } from './actions';
  import { Handle, Position } from '@xyflow/svelte';
  import { getContext } from 'svelte';
  import { classLabelKey, elementClass, statusLabelKey, statusOf } from '../../core/elements';
  import { STATUS_PROMPT, type StatusPrompt } from './status-prompt';
  import { CANVAS_CONTEXT, type CanvasContext } from './context';
  import type { ElementNodeData } from './flow-model';

  let { id, data, selected }: { id: string; data: ElementNodeData; selected?: boolean } = $props();

  const ctx = getContext<CanvasContext>(CANVAS_CONTEXT);
  const pipeline = ctx.pipeline;
  const cls = $derived(elementClass(data.class));
  const naming = $derived($pipeline.step === 'name' && $pipeline.id === id);
  const statusPrompt = getContext<StatusPrompt>(STATUS_PROMPT);
  const status = $derived(statusOf(data));
  const statusLabel = $derived(status ? ctx.localize(statusLabelKey(status)) : '');
  // Eye toggle (§8 Controls): the World's reveal state.
  const reveal = ctx.reveal;
  const revealed = $derived($reveal.elements.includes(id));
  function toggleReveal(event: MouseEvent) {
    event.stopPropagation();
    if (!ctx.available('reveal.element')) return;
    ctx.run('reveal.element', { id, revealed: !revealed }).catch(fail);
  }

  function onKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    event.stopPropagation();
    if (event.key === 'Enter') pipeline.submitName(event.currentTarget.value).catch(fail);
    else if (event.key === 'Escape') pipeline.cancel();
  }

  /**
   * Focused with the whole default name selected, so typing replaces it. Svelte Flow keeps a
   * new Node `visibility: hidden` until measured, where `focus()` is a no-op: retry per frame.
   */
  const focus = (el: HTMLInputElement) => {
    const win = el.ownerDocument.defaultView ?? window;
    let tries = 20;
    const attempt = () => {
      el.focus();
      if (el.ownerDocument.activeElement === el) el.select();
      else if (--tries > 0) win.requestAnimationFrame(attempt);
    };
    win.requestAnimationFrame(attempt);
  };
</script>

<!-- Double-click opens Element Detail (§8); keyboard users have the context menu. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="silk-card"
  class:selected
  class:ghost={data.ghost}
  class:naming
  style:--silk-class={cls?.color ?? '#666'}
  data-silk-node={id}
  data-silk-class={data.class}
  data-silk-ghost={data.ghost ? '' : undefined}
  data-silk-revealed={revealed ? '' : undefined}
  ondblclick={() => ctx.run('element.openDetail', { id }).catch(fail)}
>
  <div class="block-title">{data.name}</div>
  <img
    class="portrait"
    class:icon={!data.img}
    src={data.img ?? cls?.icon}
    alt=""
    draggable="false"
  />
  <!-- Rows (spec 1.1 §E.1): class, wrapped name, controls. The card grows to fit. -->
  <div class="body">
    <div class="cls-row">
      <span class="cls">{ctx.localize(classLabelKey(data.class))}</span>
      {#if data.restoredFrom}
        <i
          class="fa-solid fa-clock-rotate-left restored"
          data-silk-restored={data.restoredFrom}
          title={ctx
            .localize('SILK.Lifecycle.RestoredBadge')
            .replace('{commit}', data.restoredFrom.slice(0, 8))}
        ></i>
      {/if}
    </div>
    {#if naming}
      <input
        class="nodrag nopan name-input"
        value={data.name}
        onkeydown={onKeydown}
        onblur={(e) => pipeline.submitName(e.currentTarget.value).catch(fail)}
        use:focus
        data-silk-name-input
      />
    {:else}
      <div class="title" data-silk-node-title>{data.name}</div>
    {/if}
    <div class="controls">
      {#if status}
        <!-- Status chip (§10.2): click asks for the next Status, like `s`. -->
        <button
          type="button"
          class="nodrag nopan status status-{status}"
          title={ctx.localize('SILK.Canvas.StatusChip').replace('{status}', statusLabel)}
          onclick={(e) => {
            e.stopPropagation();
            statusPrompt.ask(id);
          }}
          data-silk-status={status}>{statusLabel}</button
        >
      {/if}
      <span class="spacer"></span>
      <button
        type="button"
        class="nodrag nopan eye"
        class:on={revealed}
        title={ctx.localize(
          ctx.available('reveal.element')
            ? revealed
              ? 'SILK.Reveal.Unreveal'
              : 'SILK.Reveal.Reveal'
            : 'SILK.Reveal.NeedsAdventure',
        )}
        onclick={toggleReveal}
        ondblclick={(e) => e.stopPropagation()}
        data-silk-eye={revealed ? 'on' : 'off'}
        ><i class="fa-solid {revealed ? 'fa-eye' : 'fa-eye-slash'}"></i></button
      >
      <!-- Focus Pin (§10.2, §10.6): always shown in Focus View; like `p`. -->
      <button
        type="button"
        class="nodrag nopan pin"
        class:pinned={data.pinned}
        title={ctx.localize(data.pinned ? 'SILK.Focus.Unpin' : 'SILK.Focus.Pin')}
        aria-pressed={!!data.pinned}
        onclick={(e) => {
          e.stopPropagation();
          ctx.run(data.pinned ? 'focus.unpin' : 'focus.pin', { ids: [id] }).catch(fail);
        }}
        data-silk-pin={data.pinned ? 'pinned' : ''}><i class="fa-solid fa-thumbtack"></i></button
      >
    </div>
  </div>
  {#if data.filtered}
    <!-- Shown despite the filters (Search jump, new Node) until deselected (§10.8). -->
    <div
      class="filtered-marker"
      title={ctx.localize('SILK.Canvas.FilteredTitle')}
      data-silk-filtered
    >
      {ctx.localize('SILK.Canvas.Filtered')}
    </div>
  {/if}
  {#if data.hidden}
    <!-- "+N" (§10.5): Connections to filtered-out Nodes; click shows them. -->
    <button
      type="button"
      class="nodrag nopan hidden-badge"
      title={ctx.localize('SILK.Filter.Badge').replace('{n}', String(data.hidden))}
      onclick={(e) => {
        e.stopPropagation();
        ctx.run('filter.expandBadge', { id }).catch(fail);
      }}
      data-silk-badge={data.hidden}>+{data.hidden}</button
    >
  {/if}
  <!-- Edges float (spec 1.1 §A): ConnectionEdge attaches them on the facing side. Svelte Flow
       renders an edge only between Nodes with a Handle, so each card has one, hidden. -->
  <Handle type="source" position={Position.Top} isConnectable={false} class="silk-anchor" />
</div>

<style>
  .filtered-marker {
    position: absolute;
    top: -9px;
    left: 8px;
    padding: 0 5px;
    font-size: 10px;
    line-height: 16px;
    color: #fff;
    background: #6b6b6b;
    border-radius: 8px;
  }
  .silk-card {
    position: relative;
    display: flex;
    gap: 8px;
    width: 190px;
    min-height: 78px;
    padding: 6px 8px;
    font-size: 12px;
    color: #222;
    background: #fffdf8;
    border: 1px solid #c9bfa8;
    border-left: 6px solid var(--silk-class);
    border-radius: 6px;
    box-shadow: 0 1px 2px #0002;
  }
  .hidden-badge {
    position: absolute;
    right: -8px;
    bottom: -8px;
    z-index: 2;
    width: auto;
    min-height: 0;
    padding: 0 5px;
    font-size: 10px;
    line-height: 16px;
    color: #fff;
    background: #555;
    border: 1px solid #fff;
    border-radius: 8px;
  }
  .pin {
    flex: none;
    width: 18px;
    height: 18px;
    min-height: 0;
    margin: 0;
    padding: 0;
    font-size: 10px;
    line-height: 16px;
    color: #999;
    background: none;
    border: 0;
    cursor: pointer;
    opacity: 0.5;
  }
  .pin:hover {
    opacity: 1;
  }
  .pin.pinned {
    color: #b5533c;
    opacity: 1;
  }
  :global(.lod-title) .pin:not(.pinned) {
    display: none;
  }
  .silk-card.selected {
    outline: 2px solid #2b6cb0;
  }
  .restored {
    flex: none;
    font-size: 10px;
    color: #777;
  }
  .silk-card.ghost {
    opacity: 0.55;
    border-style: dashed;
  }
  .portrait {
    flex: none;
    width: 48px;
    height: 48px;
    border: 0;
    border-radius: 4px;
    object-fit: cover;
  }
  .portrait.icon {
    padding: 4px;
    background: var(--silk-class);
  }
  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .cls-row {
    display: flex;
    gap: 4px;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
  }
  .cls {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--silk-class);
  }
  /* Wrapped, no line limit at full zoom (spec 1.1 §E.1). */
  .title {
    font-size: 13px;
    font-weight: 700;
    line-height: 1.25;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  /* Status left, eye and pin right. */
  .controls {
    display: flex;
    gap: 2px;
    align-items: center;
    min-height: 18px;
    margin-top: auto;
  }
  .spacer {
    flex: 1;
  }
  .eye {
    flex: none;
    width: 20px;
    height: 18px;
    margin: 0;
    padding: 0;
    font-size: 10px;
    line-height: 16px;
    color: #999;
    background: transparent;
    border: 0;
    cursor: pointer;
  }
  .eye.on {
    color: #2b6cb0;
  }
  :global(.lod-title) .eye {
    display: none;
  }
  .status {
    flex: none;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: auto;
    height: auto;
    margin: 0;
    padding: 0 6px;
    font-size: 10px;
    line-height: 16px;
    color: #333;
    background: #ece4d2;
    border: 1px solid #c9bfa8;
    border-radius: 8px;
    cursor: pointer;
  }
  .status-dead,
  .status-failed {
    color: #fff;
    background: #8c2f22;
    border-color: #8c2f22;
  }
  .status-happened,
  .status-done {
    color: #fff;
    background: #2f7d4f;
    border-color: #2f7d4f;
  }
  .status-skipped {
    color: #666;
    text-decoration: line-through;
  }
  :global(.lod-title) .status {
    display: none;
  }
  .name-input {
    width: 100%;
    height: 22px;
    padding: 0 3px;
    font-size: 13px;
    color: #222;
    background: #fff;
  }
  .block-title {
    display: none;
  }

  .silk-card :global(.silk-anchor) {
    visibility: hidden;
    pointer-events: none;
  }

  /* Zoom level 2: big title. */
  :global(.lod-title) .cls {
    display: none;
  }
  /* The lower zoom levels wrap too, at most 3 lines (spec 1.1 §E.1). */
  :global(.lod-title) .title {
    display: -webkit-box;
    overflow: hidden;
    font-size: 18px;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
  }
  :global(.lod-title) .controls:not(:has(.pinned)) {
    display: none;
  }
  /* Zoom level 3: coloured block with title (full card while naming). */
  :global(.lod-block) .silk-card:not(.naming) {
    background: var(--silk-class);
    border-color: var(--silk-class);
  }
  :global(.lod-block) .silk-card:not(.naming) > :not(.block-title) {
    display: none;
  }
  :global(.lod-block) .silk-card:not(.naming) .block-title {
    display: -webkit-box;
    overflow: hidden;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    font-size: 30px;
    font-weight: 700;
    line-height: 1.1;
    color: #fff;
  }
</style>
