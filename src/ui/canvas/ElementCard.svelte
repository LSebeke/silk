<script lang="ts">
  /**
   * Story Element card (spec §10.2). The zoom level comes from `.lod-*` on the canvas root,
   * so zooming changes classes once, not per card. Ghosts render faint.
   * Later tickets add: Connection Points (T7), Status chip, eye toggle, Focus Pin button.
   */
  import { Handle, Position } from '@xyflow/svelte';
  import { getContext } from 'svelte';
  import { classLabelKey, elementClass } from '../../core/elements';
  import { CONNECTION_POINTS } from './connection-points';
  import { CANVAS_CONTEXT, type CanvasContext } from './context';
  import type { ElementNodeData } from './flow-model';

  let { id, data, selected }: { id: string; data: ElementNodeData; selected?: boolean } = $props();

  const ctx = getContext<CanvasContext>(CANVAS_CONTEXT);
  const pipeline = ctx.pipeline;
  const cls = $derived(elementClass(data.class));
  const naming = $derived($pipeline.step === 'name' && $pipeline.id === id);

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
  </div>
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
  .silk-card.selected {
    outline: 2px solid #2b6cb0;
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
