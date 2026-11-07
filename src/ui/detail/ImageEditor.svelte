<script lang="ts">
  /**
   * Image & token editor (v1.1 §G.3): sheet image, token image, ring and the token's position
   * in a round preview (drag: anchor, wheel or slider: scale). Every change runs
   * `element.setImage`, which is hood-aware: while hooded the image, token and position wait
   * for the Reveal and only the ring shows at once. A Ghost's token edit Materializes it.
   */
  import { onDestroy, untrack } from 'svelte';
  import { readElement } from '../../core/elements';
  import { CENTRED, type ImageEdit, type Look, type Pose } from '../../core/portrait';
  import type { DetailContext } from './context';
  import DetailSection from './DetailSection.svelte';
  import DetailShell from './DetailShell.svelte';

  let props: { ctx: DetailContext; id: string } = $props();
  const ctx = untrack(() => props.ctx);
  const id = untrack(() => props.id);
  const t = (key: string) => ctx.localize(`SILK.ImageEditor.${key}`);

  /** Preview diameter (px). */
  const SIZE = 180;
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 3;

  let element = $state.raw(readElement(ctx.workingCopy.get(id)));
  let look = $state.raw<Look | undefined>(ctx.look(id));
  /** The checkbox, kept apart from `look`: an own token may be the same file. */
  let same = $state(untrack(() => look?.sameAsImage ?? true));
  /** The pose shown while dragging or scrolling, before it is written. */
  let draft = $state.raw<Pose | undefined>();
  const pose = $derived(draft ?? look?.pose ?? CENTRED);

  const off = ctx.workingCopy.subscribe((records) => {
    element = readElement(records.get(id));
    refresh();
  });
  onDestroy(off);

  function refresh() {
    look = ctx.look(id);
    if (look && !look.sameAsImage) same = false;
  }

  async function commit(edit: ImageEdit) {
    try {
      await ctx.run('element.setImage', { id, ...edit });
    } catch (error) {
      ctx.error(error instanceof Error ? error.message : String(error));
    }
    draft = undefined;
    refresh();
  }

  async function pickSheet() {
    const img = await ctx.pickImage(look?.img ?? '');
    if (img === undefined) return;
    // §G.3 Ghost: a sheet image alone goes to the record, no Materialize.
    if (!element?.uuid) return commit({ img });
    return commit(same ? { img, token: { sameAsImage: true } } : { img });
  }
  async function pickToken() {
    const src = await ctx.pickImage(look?.token ?? '');
    if (src !== undefined) await commit({ token: { src, sameAsImage: false } });
  }
  function setSame(on: boolean) {
    same = on;
    if (on) void commit({ token: { sameAsImage: true } });
  }

  const ring = $derived(look?.ring ?? { enabled: false, colors: { ring: null, background: null } });
  const setColor = (key: 'ring' | 'background', value: string | null) =>
    commit({ token: { ring: { colors: { [key]: value } } } });

  const writePose = (p: Pose) =>
    commit({ token: { anchor: { x: p.anchorX, y: p.anchorY }, scale: p.scale } });
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const round = (n: number) => Math.round(n * 1000) / 1000;

  // Drag: the image point under the centre is the texture anchor.
  let drag: { x: number; y: number; from: Pose } | undefined;
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, from: pose };
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const size = SIZE * drag.from.scale;
    draft = {
      ...drag.from,
      anchorX: round(clamp(drag.from.anchorX - (e.clientX - drag.x) / size, 0, 1)),
      anchorY: round(clamp(drag.from.anchorY - (e.clientY - drag.y) / size, 0, 1)),
    };
  }
  function up() {
    if (!drag) return;
    drag = undefined;
    if (draft) void writePose(draft);
  }

  // Wheel: scale, written once scrolling pauses.
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;
  function wheel(e: WheelEvent) {
    e.preventDefault();
    const scale = round(clamp(pose.scale * (e.deltaY < 0 ? 1.05 : 1 / 1.05), MIN_SCALE, MAX_SCALE));
    draft = { ...pose, scale };
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => draft && void writePose(draft), 300);
  }
  onDestroy(() => clearTimeout(wheelTimer));

  function reset() {
    void commit({
      token: {
        anchor: { x: CENTRED.anchorX, y: CENTRED.anchorY },
        scale: CENTRED.scale,
        ring: { colors: { ring: null, background: null } },
      },
    });
  }

  const shown = $derived(SIZE * pose.scale);
</script>

{#snippet color(key: 'ring' | 'background', label: string)}
  <div class="row" data-silk-image-color={key}>
    <span class="label">{label}</span>
    <input
      type="color"
      value={ring.colors[key] ?? '#ffffff'}
      disabled={!ring.enabled}
      onchange={(e) => setColor(key, e.currentTarget.value)}
    />
    {#if ring.colors[key]}
      <button
        type="button"
        class="icon"
        disabled={!ring.enabled}
        title={t('WorldDefault')}
        onclick={() => setColor(key, null)}><i class="fa-solid fa-xmark"></i></button
      >
    {:else}
      <span class="hint">{t('WorldDefault')}</span>
    {/if}
  </div>
{/snippet}

{#snippet header()}
  {#if element}
    <h2>{element.name}</h2>
  {/if}
{/snippet}

<DetailShell data-silk-image-editor={id} header={element ? header : undefined}>
  {#if element && look}
    {#if look.hooded}
      <p class="hint" data-silk-image-hooded>{t('HoodedHint')}</p>
    {/if}
    <DetailSection title={t('SheetImage')} data-silk-image-sheet>
      <div class="row">
        <img class="thumb" src={look.img || undefined} alt="" />
        <span class="path" title={look.img}>{look.img || '–'}</span>
        <button type="button" onclick={pickSheet}>{t('Choose')}</button>
      </div>
    </DetailSection>
    <DetailSection title={t('TokenImage')} data-silk-image-token>
      <label class="row">
        <input
          type="checkbox"
          checked={same}
          onchange={(e) => setSame(e.currentTarget.checked)}
          data-silk-image-same
        />
        {t('SameAsImage')}
      </label>
      {#if !same}
        <div class="row">
          <img class="thumb" src={look.token || undefined} alt="" />
          <span class="path" title={look.token}>{look.token || '–'}</span>
          <button type="button" onclick={pickToken}>{t('Choose')}</button>
        </div>
      {/if}
    </DetailSection>
    <DetailSection title={t('Ring')} data-silk-image-ring>
      <label class="row">
        <input
          type="checkbox"
          checked={ring.enabled}
          onchange={(e) => commit({ token: { ring: { enabled: e.currentTarget.checked } } })}
          data-silk-image-ring-enabled
        />
        {t('RingEnabled')}
      </label>
      {@render color('ring', t('RingColor'))}
      {@render color('background', t('BackgroundColor'))}
    </DetailSection>
    <DetailSection title={t('Position')} data-silk-image-position>
      <div
        class="frame"
        class:ring={ring.enabled}
        style:width="{SIZE}px"
        style:height="{SIZE}px"
        style:--ring={ring.colors.ring ?? 'currentColor'}
        style:background={ring.enabled ? (ring.colors.background ?? undefined) : undefined}
        role="slider"
        tabindex="0"
        aria-label={t('PositionHint')}
        aria-valuenow={pose.scale}
        title={t('PositionHint')}
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={up}
        onwheel={wheel}
        data-silk-image-preview
      >
        <img
          src={look.token || undefined}
          alt=""
          draggable="false"
          style:width="{shown}px"
          style:height="{shown}px"
          style:left="{SIZE / 2 - pose.anchorX * shown}px"
          style:top="{SIZE / 2 - pose.anchorY * shown}px"
        />
      </div>
      <label class="row">
        <span class="label">{t('Scale')}</span>
        <input
          type="range"
          min={MIN_SCALE}
          max={MAX_SCALE}
          step="0.05"
          value={pose.scale}
          oninput={(e) => (draft = { ...pose, scale: Number(e.currentTarget.value) })}
          onchange={(e) => writePose({ ...pose, scale: Number(e.currentTarget.value) })}
          data-silk-image-scale
        />
        <span class="value">{pose.scale.toFixed(2)}</span>
      </label>
      <button type="button" class="reset" onclick={reset} data-silk-image-reset>{t('Reset')}</button
      >
    </DetailSection>
  {:else}
    <p class="hint">{ctx.localize('SILK.Detail.Gone')}</p>
  {/if}
</DetailShell>

<style>
  h2 {
    margin: 0;
    border: 0;
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .row button {
    flex: none;
    width: auto;
    padding: 0 8px;
  }
  .row .icon {
    width: 26px;
    padding: 0;
  }
  .thumb {
    flex: none;
    width: 40px;
    height: 40px;
    object-fit: contain;
    border: 1px solid #aaa;
    border-radius: 4px;
  }
  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
  }
  .label {
    min-width: 110px;
  }
  .value {
    width: 36px;
    text-align: right;
  }
  input[type='range'] {
    flex: 1;
  }
  .frame {
    position: relative;
    align-self: center;
    margin: 4px auto;
    overflow: hidden;
    cursor: grab;
    touch-action: none;
    border: 2px dashed #888;
    border-radius: 50%;
  }
  .frame.ring {
    border: 6px solid var(--ring);
  }
  .frame:active {
    cursor: grabbing;
  }
  .frame img {
    position: absolute;
    max-width: none;
    object-fit: contain;
    border: 0;
    pointer-events: none;
    user-select: none;
  }
  .reset {
    width: auto;
    align-self: flex-start;
    padding: 0 8px;
  }
  .hint {
    margin: 0;
    font-style: italic;
    opacity: 0.8;
  }
</style>
