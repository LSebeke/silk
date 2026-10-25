<script lang="ts">
  /**
   * Story Element card (spec §10.2). The zoom level comes from `.lod-*` on the canvas root,
   * so zooming changes classes once, not per card. Ghosts render faint.
   * Later tickets add: eye toggle.
   */
  import { Handle, Position } from '@xyflow/svelte';
  import { getContext } from 'svelte';
  import { classLabelKey, elementClass, statusLabelKey, statusOf } from '../../core/elements';
  import { STATUS_PROMPT, type StatusPrompt } from './status-prompt';
  import { CONNECTION_POINTS } from './connection-points';
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

  const fail = (error: unknown) => console.error(error);

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

<div
  class="silk-card"
  class:selected
  class:ghost={data.ghost}
  class:naming
  style:--silk-class={cls?.color ?? '#666'}
  data-silk-node={id}
  data-silk-class={data.class}
  data-silk-ghost={data.ghost ? '' : undefined}
>
  <div class="block-title">{data.name}</div>
  <img
    class="portrait"
    class:icon={!data.img}
    src={data.img ?? cls?.icon}
    alt=""
    draggable="false"
  />
  <div class="body">
    <div class="cls">{ctx.localize(classLabelKey(data.class))}</div>
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
    {#if data.restoredFrom}
      <div
        class="restored"
        data-silk-restored={data.restoredFrom}
        title={ctx
          .localize('SILK.Lifecycle.RestoredBadge')
          .replace('{commit}', data.restoredFrom.slice(0, 8))}
      >
        <i class="fa-solid fa-clock-rotate-left"></i>
        {data.restoredFrom.slice(0, 8)}
      </div>
    {/if}
  </div>
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
  <!-- Connection Points (§10.2): out/in/mutual on all four sides; dragging one out connects. -->
  {#each CONNECTION_POINTS as point (point.id)}
    <Handle
      id={point.id}
      type="source"
      position={Position[point.position]}
      class="silk-point silk-point-{point.kind}"
      style={point.style}
      title={ctx.localize(`SILK.Connection.Point.${point.kind}`)}
      data-silk-point={point.kind}
      data-silk-point-side={point.side}
    />
  {/each}
</div>

<style>
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
  /* Bottom-left, under the portrait. */
  .pin {
    position: absolute;
    bottom: 2px;
    left: 8px;
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
    font-size: 0.75em;
    opacity: 0.8;
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
  .cls {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--silk-class);
  }
  .title {
    overflow: hidden;
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  /* Top-right corner: a click on the card's centre still selects it. */
  .status {
    position: absolute;
    top: 4px;
    right: 6px;
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

  /* Connection Points: always visible at full zoom, larger than Svelte Flow's default. */
  .silk-card :global(.silk-point) {
    width: 12px;
    height: 12px;
    min-width: 0;
    min-height: 0;
    border: 2px solid var(--silk-class);
    background: #fffdf8;
    cursor: crosshair;
  }
  .silk-card :global(.silk-point-out) {
    background: var(--silk-class);
  }
  .silk-card :global(.silk-point-mutual) {
    border-radius: 2px;
    transform: translate(-50%, -50%) rotate(45deg);
  }
  .silk-card :global(.silk-point-mutual.svelte-flow__handle-top),
  .silk-card :global(.silk-point-mutual.svelte-flow__handle-bottom) {
    transform: translate(-50%, 0) rotate(45deg);
  }
  .silk-card :global(.silk-point-mutual.svelte-flow__handle-left),
  .silk-card :global(.silk-point-mutual.svelte-flow__handle-right) {
    transform: translate(0, -50%) rotate(45deg);
  }
  .silk-card :global(.svelte-flow__handle-top) {
    top: -7px;
  }
  .silk-card :global(.svelte-flow__handle-bottom) {
    bottom: -7px;
  }
  .silk-card :global(.svelte-flow__handle-left) {
    left: -7px;
  }
  .silk-card :global(.svelte-flow__handle-right) {
    right: -7px;
  }
  :global(.lod-title) .silk-card :global(.silk-point),
  :global(.lod-block) .silk-card :global(.silk-point) {
    visibility: hidden;
  }

  /* Zoom level 2: big title. */
  :global(.lod-title) .cls {
    display: none;
  }
  :global(.lod-title) .title {
    font-size: 18px;
    white-space: normal;
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
    display: block;
    max-height: 66px;
    overflow: hidden;
    font-size: 30px;
    font-weight: 700;
    line-height: 1.1;
    color: #fff;
  }
</style>
