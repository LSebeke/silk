<script lang="ts">
  /** Creation Pipeline step 1 (spec §10.3): searchable class selection box at the spot. */
  import { getContext } from 'svelte';
  import { classLabelKey, type ElementClassId } from '../../core/elements';
  import { CANVAS_CONTEXT, type CanvasContext } from './context';

  const ctx = getContext<CanvasContext>(CANVAS_CONTEXT);
  const pipeline = ctx.pipeline;
  const box = $derived($pipeline.step === 'classBox' ? $pipeline : undefined);
  const options = $derived(box ? pipeline.options() : []);

  const fail = (error: unknown) => console.error(error);
  const pick = (id: ElementClassId) => pipeline.pickClass(id).catch(fail);

  function onKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Escape') pipeline.cancel();
    else if (event.key === 'Enter') {
      event.preventDefault();
      pipeline.pickFirst().catch(fail);
    }
  }

  const focus = (el: HTMLInputElement) => {
    queueMicrotask(() => el.focus());
  };
</script>

{#if box}
  <div
    class="silk-class-box"
    style:left="{box.anchor?.x ?? 40}px"
    style:top="{box.anchor?.y ?? 40}px"
    role="menu"
    tabindex="-1"
    data-silk-class-box
  >
    <input
      type="search"
      value={box.query}
      placeholder={ctx.localize('SILK.Canvas.ClassSearch')}
      oninput={(e) => pipeline.setQuery(e.currentTarget.value)}
      onkeydown={onKeydown}
      use:focus
      data-silk-class-search
    />
    {#each options as cls (cls.id)}
      <button
        type="button"
        role="menuitem"
        style:--silk-class={cls.color}
        onclick={() => pick(cls.id)}
        data-silk-class-option={cls.id}
      >
        <img src={cls.icon} alt="" />
        <span>{ctx.localize(classLabelKey(cls.id))}</span>
        <kbd>{cls.digit}</kbd>
      </button>
    {/each}
  </div>
{/if}

<style>
  .silk-class-box {
    position: absolute;
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 200px;
    padding: 6px;
    background: #fffdf8;
    border: 1px solid #aaa;
    border-radius: 8px;
    box-shadow: 0 4px 16px #0003;
  }
  input {
    height: 26px;
    margin-bottom: 4px;
    color: #222;
    background: #fff;
  }
  button {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 6px;
    font-size: 12px;
    color: #222;
    background: #fff;
    border: 1px solid #ddd;
    border-left: 4px solid var(--silk-class);
    border-radius: 4px;
    cursor: pointer;
  }
  button:first-of-type {
    outline: 1px solid #2b6cb0;
  }
  button span {
    flex: 1;
    text-align: left;
  }
  img {
    width: 18px;
    height: 18px;
    border: 0;
    border-radius: 3px;
    background: var(--silk-class);
  }
  kbd {
    font-size: 10px;
    color: #777;
  }
</style>
