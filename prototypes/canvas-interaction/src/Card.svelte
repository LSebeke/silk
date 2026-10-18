<script>
  // PROTOTYPE, throwaway. Story Element card; level of detail comes from the .lod-* class on the flow root.
  import { Handle, Position } from '@xyflow/svelte';
  import { CLASSES } from './model.js';
  import { store } from './store.svelte.js';
  let { id, data, selected } = $props();
  const c = $derived(CLASSES[data.cls]);
  const QUEST = ['open', 'done', 'failed'];
  const chip = (key, e) => { if (store.variant !== 'A') return; e.stopPropagation(); store.toggleStatus(id, key); };
  const commit = e => { store.rename(id, e.currentTarget.value); store.editing = null; };
  const focus = el => { el.focus(); el.select(); };
</script>

<div class="card" class:selected class:dead={data.status.dead} class:connect-src={store.connectFrom === id} style="--c:{c.color}">
  <Handle type="target" position={Position.Left} />
  <div class="lowtitle">{data.title}</div>
  <img class="portrait" src={c.icon} alt="" draggable="false" />
  <div class="body">
    <div class="cls">{data.cls}{#if data.blocks}<span class="blocks"> · {data.blocks} Info Blocks</span>{/if}</div>
    {#if store.editing === id}
      <input class="nodrag title-input" value={data.title} use:focus onblur={commit}
        onkeydown={e => { e.stopPropagation(); if (e.key === 'Enter') commit(e); if (e.key === 'Escape') store.editing = null; }} />
    {:else}
      <div class="title" ondblclick={() => (store.editing = id)}>{data.title}</div>
    {/if}
    <div class="chips" class:clickable={store.variant === 'A'}>
      {#each c.status as key}
        {#if key === 'quest'}
          <button class="chip nodrag q{data.status.quest}" onclick={e => chip(key, e)}>{QUEST[data.status.quest]}</button>
        {:else}
          <button class="chip nodrag" class:on={data.status[key]} onclick={e => chip(key, e)}>{key}</button>
        {/if}
      {/each}
      <button class="chip eye nodrag" class:on={data.revealed} title="Reveal" onclick={e => { if (store.variant !== 'A') return; e.stopPropagation(); store.toggleReveal(id); }}>{data.revealed ? '👁' : '◌'}</button>
    </div>
  </div>
  <Handle type="source" position={Position.Right} />
</div>
