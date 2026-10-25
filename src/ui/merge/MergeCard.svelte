<script lang="ts">
  /** Node of the merge canvas diff (spec §11.4): class colour, name, badge, open conflicts. */
  import { Handle, Position } from '@xyflow/svelte';
  import { elementClass } from '../../core/elements';
  import type { MergeNodeData } from './merge-flow';

  let { id, data, selected }: { id: string; data: MergeNodeData; selected?: boolean } = $props();

  const cls = $derived(elementClass(data.class));
  const mark: Record<string, string> = {
    conflict: '!',
    added: '+',
    deleted: '−',
    changed: '~',
    layout: '↔',
    canonOnly: 'C',
    same: '',
  };
  const resolved = $derived(data.badge === 'conflict' && data.open === 0);
</script>

<div
  class="silk-merge-card {data.badge}"
  class:selected
  class:deleted={data.deleted}
  class:resolved
  style:--silk-class={cls?.color ?? '#666'}
  data-silk-merge-node={id}
  data-silk-merge-badge={data.badge}
  data-silk-merge-open={data.open}
>
  <img class="portrait" src={data.img ?? cls?.icon} alt="" draggable="false" />
  <div class="title">{data.name}</div>
  {#if mark[data.badge]}
    <span class="badge">{resolved ? '✓' : data.open || mark[data.badge]}</span>
  {/if}
  <Handle type="target" position={Position.Top} class="silk-merge-handle" />
  <Handle type="source" position={Position.Bottom} class="silk-merge-handle" />
</div>

<style>
  .silk-merge-card {
    --edge: #5a554e;
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 190px;
    min-height: 48px;
    padding: 0.3rem 0.5rem 0.3rem 0.6rem;
    background: #2f2c28;
    color: #e8e2d8;
    border: 2px solid var(--edge);
    border-left: 6px solid var(--silk-class);
    border-radius: 6px;
    cursor: pointer;
  }
  .silk-merge-card.selected {
    box-shadow: 0 0 0 3px #d9a44188;
  }
  .conflict {
    --edge: #f1c232;
  }
  .resolved {
    --edge: #7bbf6a;
  }
  .added {
    --edge: #7bbf6a;
  }
  .deleted {
    --edge: #e06666;
  }
  .changed,
  .layout {
    --edge: #e8915a;
  }
  .canonOnly {
    --edge: #6fa8dc;
  }
  .silk-merge-card.deleted .title {
    text-decoration: line-through;
  }
  .silk-merge-card.deleted {
    opacity: 0.6;
  }
  .portrait {
    width: 32px;
    height: 32px;
    object-fit: cover;
    border: 0;
  }
  .title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge {
    position: absolute;
    right: -10px;
    top: -10px;
    min-width: 20px;
    height: 20px;
    border-radius: 10px;
    background: var(--edge);
    color: #1d1b19;
    font-weight: 700;
    text-align: center;
    line-height: 20px;
    font-size: 12px;
  }
  :global(.silk-merge-handle) {
    opacity: 0;
    pointer-events: none;
  }
</style>
