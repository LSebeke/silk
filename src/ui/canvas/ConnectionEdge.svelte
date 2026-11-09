<script lang="ts">
  /**
   * Connection edge (spec §5): curved, labelled, attached on the side facing the other Node.
   * Parallel Connections bend apart by `data.offset`. Hosts the Connection editor (pipeline
   * step 3, §10.3) in its label.
   */
  import { fail } from './actions';
  import { BaseEdge, EdgeLabel, useStore, type EdgeProps, type InternalNode } from '@xyflow/svelte';
  import { getContext } from 'svelte';
  import { CANVAS_CONTEXT, type CanvasContext } from './context';
  import { facingAnchor, type Box, type ConnectionEdge } from './flow-edges';

  let { id, source, target, data, selected, markerEnd }: EdgeProps<ConnectionEdge> = $props();

  const ctx = getContext<CanvasContext>(CANVAS_CONTEXT);
  const pipeline = ctx.pipeline;
  // Like `useInternalNode`, but follows `source`/`target` (flip swaps them).
  const store = useStore();
  const internal = (id: string) => {
    void store.nodes;
    return store.nodeLookup.get(id);
  };
  const sourceNode = $derived(internal(source));
  const targetNode = $derived(internal(target));
  const editing = $derived($pipeline.step === 'connection' && $pipeline.id === id);
  const behavioural = $derived(data?.type !== 'free');
  const text = $derived(
    behavioural
      ? ctx.localize(`GARN.Connection.Type.${data?.type}`)
      : data?.label || (data?.direction === 'mutual' ? '—' : '→'),
  );

  const box = (node: InternalNode | undefined): Box | undefined =>
    node && {
      x: node.internals.positionAbsolute.x,
      y: node.internals.positionAbsolute.y,
      width: node.measured.width ?? 190,
      height: node.measured.height ?? 78,
    };

  const geometry = $derived.by(() => {
    const a = box(sourceNode);
    const b = box(targetNode);
    if (!a || !b) return undefined;
    const s = facingAnchor(a, b);
    const t = facingAnchor(b, a);
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = (data?.offset ?? 0) * 2;
    const cx = (s.x + t.x) / 2 - (dy / len) * bend;
    const cy = (s.y + t.y) / 2 + (dx / len) * bend;
    return {
      path: `M${s.x},${s.y} Q${cx},${cy} ${t.x},${t.y}`,
      // Midpoint of the quadratic curve.
      x: (s.x + 2 * cx + t.x) / 4,
      y: (s.y + 2 * cy + t.y) / 4,
    };
  });

  const run = (name: string, args: object = {}) => ctx.run(name, { id, ...args }).catch(fail);
  // v1.1 §F.1: Directed ⇄ Mutual; never reverses.
  const toggleDirection = () => run('connection.toggleDirection');

  function onKeydown(event: KeyboardEvent & { currentTarget: HTMLElement }) {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      const input = event.currentTarget
        .closest('[data-garn-connection-editor]')
        ?.querySelector('input');
      pipeline.submitLabel(input?.value ?? '').catch(fail);
    } else if (event.key === 'Escape') pipeline.cancel();
    else if (event.key === 'Tab') {
      // v1.1 §F.1: Tab toggles directed ⇄ mutual, Shift+Tab reverses.
      event.preventDefault();
      if (event.shiftKey) void run('connection.flip');
      else void toggleDirection();
    }
  }

  const focus = (el: HTMLElement) => {
    const win = el.ownerDocument.defaultView ?? window;
    let tries = 20;
    const attempt = () => {
      el.focus();
      if (el.ownerDocument.activeElement === el) (el as HTMLInputElement).select?.();
      else if (--tries > 0) win.requestAnimationFrame(attempt);
    };
    win.requestAnimationFrame(attempt);
  };
</script>

{#if geometry}
  <BaseEdge
    {id}
    path={geometry.path}
    {markerEnd}
    interactionWidth={16}
    class={['garn-edge', behavioural ? 'behavioural' : 'free', selected && 'selected']}
  />
  <EdgeLabel
    x={geometry.x}
    y={geometry.y}
    selectEdgeOnClick
    class={['garn-edge-label', behavioural ? 'behavioural' : 'free', selected && 'selected']}
    data-garn-edge={id}
    data-garn-edge-type={data?.type}
    data-garn-edge-direction={data?.direction}
    data-garn-edge-from={source}
    data-garn-edge-to={target}
  >
    {#if editing}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="editor nodrag nopan" data-garn-connection-editor onkeydown={onKeydown}>
        {#if behavioural}
          <button
            type="button"
            onmousedown={(e) => e.preventDefault()}
            use:focus
            onclick={() => run('connection.cycleType')}
          >
            {text} ⟳
          </button>
        {:else}
          <button
            type="button"
            onmousedown={(e) => e.preventDefault()}
            onclick={toggleDirection}
            data-garn-toggle-direction
          >
            {data?.direction === 'mutual' ? '⟷' : '→'}
          </button>
          <input
            value={data?.label ?? ''}
            placeholder={ctx.localize('GARN.Canvas.LabelPlaceholder')}
            onblur={(e) => pipeline.submitLabel(e.currentTarget.value).catch(fail)}
            use:focus
            data-garn-label-input
          />
          <button
            type="button"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => run('connection.cycleType')}
            data-garn-cycle-type>⟳</button
          >
        {/if}
      </div>
    {:else}
      {data?.direction === 'mutual' ? '⟷ ' : ''}{text}
    {/if}
  </EdgeLabel>
{/if}

<style>
  :global(.garn-edge.svelte-flow__edge-path) {
    stroke: #555;
    stroke-width: 1.6;
  }
  :global(.garn-edge.behavioural.svelte-flow__edge-path) {
    stroke: #b07a10;
    stroke-width: 2;
  }
  :global(.garn-edge.selected.svelte-flow__edge-path) {
    stroke: #2b6cb0;
    stroke-width: 2.6;
  }
  :global(.garn-edge-label) {
    padding: 1px 5px;
    font-size: 11px;
    color: #333;
    white-space: nowrap;
    background: #fffdf8e6;
    border: 1px solid #c9bfa8;
    border-radius: 8px;
    cursor: pointer;
  }
  :global(.garn-edge-label.behavioural) {
    font-style: italic;
    color: #7a5208;
  }
  :global(.garn-edge-label.selected) {
    border-color: #2b6cb0;
  }
  .editor {
    display: flex;
    gap: 2px;
    align-items: center;
  }
  .editor input {
    width: 130px;
    height: 20px;
    padding: 0 3px;
    font-size: 11px;
    color: #222;
    background: #fff;
  }
  .editor button {
    height: 20px;
    padding: 0 4px;
    font-size: 11px;
    line-height: 1;
    color: #222;
    background: #fff;
    border: 1px solid #bbb;
  }
</style>
