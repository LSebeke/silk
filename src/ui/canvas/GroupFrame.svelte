<script lang="ts">
  /**
   * Visual Group frame (spec §10.4). Double-click the title to rename; × dissolves the group
   * (contents move to the parent frame). Size comes from the record (Node `width`/`height`).
   */
  import { fail } from './actions';
  import { getContext } from 'svelte';
  import { CANVAS_CONTEXT, type CanvasContext } from './context';
  import type { GroupNodeData } from './flow-model';

  let { id, data, selected }: { id: string; data: GroupNodeData; selected?: boolean } = $props();

  const ctx = getContext<CanvasContext>(CANVAS_CONTEXT);
  let editing = $state(false);

  function submit(value: string) {
    if (!editing) return;
    editing = false;
    const label = value.trim();
    if (label && label !== data.label)
      ctx.run('canvas.renameGroup', { groupId: id, label }).catch(fail);
  }

  function onKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    event.stopPropagation();
    if (event.key === 'Enter') submit(event.currentTarget.value);
    else if (event.key === 'Escape') editing = false;
  }

  const focus = (el: HTMLInputElement) => {
    el.focus();
    el.select();
  };
</script>

<div class="garn-frame" class:selected data-garn-group={id}>
  <div class="frame-title">
    {#if editing}
      <input
        class="nodrag nopan"
        value={data.label}
        onkeydown={onKeydown}
        onblur={(e) => submit(e.currentTarget.value)}
        use:focus
        data-garn-group-label-input
      />
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="label" ondblclick={() => (editing = true)} data-garn-group-label>
        {data.label}
      </span>
      <button
        class="nodrag ungroup"
        type="button"
        title={ctx.localize('GARN.Canvas.Ungroup')}
        onclick={() => ctx.run('canvas.ungroup', { groupId: id }).catch(fail)}
        data-garn-ungroup={id}>×</button
      >
    {/if}
  </div>
</div>

<style>
  .garn-frame {
    width: 100%;
    height: 100%;
    background: #ece3cf88;
    border: 2px dashed #b9a77f;
    border-radius: 12px;
  }
  .garn-frame.selected {
    border-color: #2b6cb0;
  }
  .frame-title {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 14px;
    font-size: 22px;
    font-weight: 700;
    color: #8a7444;
  }
  .label {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .frame-title input {
    width: 60%;
    height: 30px;
    font-size: 20px;
    color: #222;
    background: #fff;
  }
  .ungroup {
    flex: none;
    width: 24px;
    height: 24px;
    padding: 0;
    margin-left: auto;
    font-size: 16px;
    line-height: 1;
    color: #8a7444;
    background: transparent;
    border: 0;
    visibility: hidden;
  }
  .garn-frame:hover .ungroup,
  .garn-frame.selected .ungroup {
    visibility: visible;
  }
  :global(.lod-block) .frame-title {
    font-size: 80px;
    height: auto;
  }
</style>
