<script lang="ts">
  /**
   * Palette (spec §10.3, §10.8): drag a class onto the canvas (standalone Node) or onto a
   * Node (connected to it). Its filter uses Search's matcher; below the classes it lists
   * Search hits (Search's index), which jump on click.
   */
  import { matches, normalize, type SearchHit } from '../../core/canvas/search';
  import { ELEMENT_CLASSES, classLabelKey, type ElementClassId } from '../../core/elements';
  import { PALETTE_MIME, type CanvasContext } from './context';

  let { ctx, onjump }: { ctx: CanvasContext; onjump(id: string): void } = $props();

  let query = $state('');
  let hits = $state.raw<SearchHit[]>([]);
  const classes = $derived(
    ELEMENT_CLASSES.filter(
      (c) => c.creatable && matches(normalize(ctx.localize(classLabelKey(c.id))), normalize(query)),
    ),
  );
  const elements = $derived(
    hits.flatMap((h) =>
      h.kind === 'tag'
        ? h.elements.map((e) => ({ id: e.id, name: e.name }))
        : [{ id: h.id, name: h.name }],
    ),
  );

  let seq = 0;
  async function onInput(value: string) {
    query = value;
    const mine = ++seq;
    const result = (await ctx.run('canvas.search', { query: value })) as SearchHit[];
    if (mine === seq) hits = result;
  }

  function onDragStart(event: DragEvent, id: ElementClassId) {
    event.dataTransfer?.setData(PALETTE_MIME, id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  }
</script>

<div class="silk-palette" data-silk-palette>
  <input
    type="search"
    value={query}
    placeholder={ctx.localize('SILK.Canvas.SearchPlaceholder')}
    oninput={(e) => void onInput(e.currentTarget.value).catch(console.error)}
    onkeydown={(e) => e.stopPropagation()}
    data-silk-palette-input
  />
  <div class="hint">{ctx.localize('SILK.Canvas.PaletteHint')}</div>
  {#each classes as cls (cls.id)}
    <div
      class="cls"
      role="listitem"
      draggable="true"
      style:--silk-class={cls.color}
      ondragstart={(e) => onDragStart(e, cls.id)}
      data-silk-palette-class={cls.id}
    >
      <img src={cls.icon} alt="" draggable="false" />
      <span>{ctx.localize(classLabelKey(cls.id))}</span>
      <kbd>{cls.digit}</kbd>
    </div>
  {/each}
  {#each elements as e, i (`${e.id}-${i}`)}
    <button type="button" onclick={() => onjump(e.id)} data-silk-palette-hit={e.id}>
      {e.name}
    </button>
  {/each}
</div>

<style>
  .silk-palette {
    position: absolute;
    top: 44px;
    right: 8px;
    z-index: 15;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 180px;
    max-height: calc(100% - 60px);
    overflow-y: auto;
    padding: 6px;
    font-size: 12px;
    color: #222;
    background: #fffdf8;
    border: 1px solid #c9bfa8;
    border-radius: 6px;
    box-shadow: 0 1px 3px #0003;
  }
  input {
    height: 24px;
    margin-bottom: 2px;
    color: #222;
    background: #fff;
  }
  .hint {
    font-size: 11px;
    opacity: 0.7;
  }
  .cls {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 6px;
    background: #fff;
    border: 1px solid #ddd;
    border-left: 4px solid var(--silk-class);
    border-radius: 4px;
    cursor: grab;
    user-select: none;
  }
  .cls span {
    flex: 1;
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
  button {
    width: 100%;
    min-height: 22px;
    padding: 0 6px;
    font-size: 12px;
    line-height: 20px;
    text-align: left;
  }
</style>
