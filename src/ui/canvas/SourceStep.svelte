<script lang="ts">
  /**
   * Creation Pipeline Source Step (spec 1.1 §B.1): a compass of four buttons at the spot.
   * ↑ Compendium, ← Generator, → Blank, ↓ / Esc cancel; mouse and arrows work the same.
   * Greyed choices carry their reason as a tooltip and do nothing.
   */
  import { getContext } from 'svelte';
  import { classLabelKey, type SourceKind } from '../../core/elements';
  import { CANVAS_CONTEXT, type CanvasContext } from './context';
  import { sourceKey } from './keys';

  const ctx = getContext<CanvasContext>(CANVAS_CONTEXT);
  const pipeline = ctx.pipeline;
  const box = $derived($pipeline.step === 'source' ? $pipeline : undefined);

  const fail = (error: unknown) => console.error(error);
  const pick = (kind: SourceKind) => pipeline.pickSource(kind).catch(fail);

  const ARROWS: Record<SourceKind, string> = { compendium: '↑', generator: '←', blank: '→' };

  let el = $state<HTMLElement>();
  /** Cancelled: keys go back to the canvas (digit keys work again). */
  function cancel() {
    el?.closest<HTMLElement>('[data-silk-canvas]')?.focus();
    pipeline.cancel();
  }

  function onKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    const action = sourceKey(event);
    if (!action) return;
    event.preventDefault();
    if (action === 'cancel') cancel();
    else void pick(action);
  }

  const focus = (el: HTMLElement) => {
    queueMicrotask(() => el.focus());
  };
</script>

{#if box && !box.pending}
  <div
    class="silk-source-step"
    style:left="{box.anchor?.x ?? 40}px"
    style:top="{box.anchor?.y ?? 40}px"
    role="menu"
    tabindex="-1"
    aria-label="{ctx.localize('SILK.Source.Label')}: {ctx.localize(classLabelKey(box.class))}"
    onkeydown={onKeydown}
    bind:this={el}
    use:focus
    data-silk-source-step={box.class}
  >
    {#each box.choices as choice (choice.kind)}
      <button
        type="button"
        role="menuitem"
        class={choice.kind}
        class:unavailable={!choice.available}
        aria-disabled={!choice.available}
        title={choice.reason ? ctx.localize(choice.reason) : undefined}
        tabindex="-1"
        onclick={() => choice.available && pick(choice.kind)}
        data-silk-source-choice={choice.kind}
        data-silk-source-available={choice.available ? '' : undefined}
      >
        <kbd>{ARROWS[choice.kind]}</kbd>
        <span>{ctx.localize(`SILK.Source.${choice.kind}`)}</span>
      </button>
    {/each}
    <button
      type="button"
      role="menuitem"
      class="cancel"
      tabindex="-1"
      onclick={cancel}
      data-silk-source-choice="cancel"
    >
      <kbd>↓</kbd>
      <span>{ctx.localize('SILK.Source.Cancel')}</span>
    </button>
  </div>
{/if}

<style>
  .silk-source-step {
    position: absolute;
    z-index: 20;
    display: grid;
    grid-template-areas:
      '. up .'
      'left . right'
      '. down .';
    grid-template-columns: repeat(3, 96px);
    gap: 4px;
    padding: 6px;
    transform: translate(-50%, -50%);
    background: #fffdf8;
    border: 1px solid #aaa;
    border-radius: 8px;
    box-shadow: 0 4px 16px #0003;
    outline: none;
  }
  .compendium {
    grid-area: up;
  }
  .generator {
    grid-area: left;
  }
  .blank {
    grid-area: right;
  }
  .cancel {
    grid-area: down;
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
    border-radius: 4px;
    cursor: pointer;
  }
  button:hover:not(.unavailable) {
    border-color: #2b6cb0;
  }
  button.unavailable {
    color: #999;
    background: #f2f2f2;
    cursor: not-allowed;
  }
  button span {
    flex: 1;
    text-align: left;
  }
  kbd {
    font-size: 10px;
    color: #777;
  }
</style>
