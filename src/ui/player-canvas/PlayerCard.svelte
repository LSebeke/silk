<script lang="ts">
  /**
   * Player Canvas Node (spec §9): class colour, name and Cover (hooded until Appearance). The
   * name wraps and the card grows, as on the GM's cards (CardName, spec 1.1 §G.5).
   * No Status, no Info Blocks, no Reveal controls. A click opens the doc (PlayerCanvas).
   */
  import { Handle, Position } from '@xyflow/svelte';
  import { getContext } from 'svelte';
  import CardName from '../CardName.svelte';
  import { classLabelKey, elementClass } from '../../core/elements';
  import { PLAYER_CANVAS_CONTEXT, type PlayerCanvasContext } from './context';
  import type { PlayerNodeData } from './player-flow';

  let { id, data }: { id: string; data: PlayerNodeData } = $props();

  const ctx = getContext<PlayerCanvasContext>(PLAYER_CANVAS_CONTEXT);
  const cls = $derived(elementClass(data.class));
  const label = $derived(ctx.localize(classLabelKey(data.class)));
  const name = $derived(data.name || label);
</script>

<div
  class="silk-player-card"
  style:--silk-class={cls?.color ?? '#666'}
  data-silk-player-node={id}
  data-silk-class={data.class}
  data-silk-img={data.img ?? ''}
>
  <CardName {name} variant="block" />
  <img
    class="portrait"
    class:icon={!data.img}
    src={data.img ?? cls?.icon}
    alt=""
    draggable="false"
  />
  <div class="body">
    <div class="cls">{label}</div>
    <CardName {name} variant="title" data-silk-player-title />
  </div>
  <!-- Hidden anchors only: edges attach on the facing side themselves (PlayerEdge). -->
  <Handle
    type="source"
    position={Position.Right}
    class="silk-player-anchor"
    isConnectable={false}
  />
  <Handle type="target" position={Position.Left} class="silk-player-anchor" isConnectable={false} />
</div>

<style>
  .silk-player-card {
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
    cursor: pointer;
  }
  .silk-player-card :global(.silk-player-anchor) {
    visibility: hidden;
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
  :global(.lod-title) .cls {
    display: none;
  }
  :global(.lod-block) .silk-player-card {
    background: var(--silk-class);
    border-color: var(--silk-class);
  }
  :global(.lod-block) .silk-player-card > :not(:global(.silk-card-name)) {
    display: none;
  }
</style>
