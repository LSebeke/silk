<script lang="ts">
  /**
   * Image & token editor (v1.1 §G.3): sheet image, token image, ring, draw order, Lock
   * rotation and the token's position in a preview of the final token (drag: anchor, wheel or
   * slider: scale). Every change runs `element.setImage`, which is hood-aware and Ghost-aware.
   * The preview draws the subject with the same geometry as the subject file (core/portrait),
   * with the world's ring style, in Foundry's order: background colour, the ring frame, then
   * the subject cut to the edge the draw order picks (#170); all at the actor's size factor in
   * its grid square (#168).
   */
  import { onDestroy, untrack } from 'svelte';
  import { DEFAULT_EDGES, type RingPreview, type SheetRect } from '../../adapter/ring-style';
  import { readElement } from '../../core/elements';
  import {
    CENTRED,
    clampPose,
    dragPose,
    SCALE,
    subjectBox,
    subjectCrop,
    type ImageEdit,
    type Order,
    type Pose,
  } from '../../core/portrait';
  import type { DetailContext } from './context';
  import DetailSection from './DetailSection.svelte';
  import DetailShell from './DetailShell.svelte';
  import { liveRecords, runner } from './live.svelte';

  let props: { ctx: DetailContext; id: string } = $props();
  const ctx = untrack(() => props.ctx);
  const id = untrack(() => props.id);
  const t = (key: string) => ctx.localize(`SILK.ImageEditor.${key}`);

  /** Preview grid square (px). */
  const SIZE = 180;

  const live = liveRecords(ctx);
  const run = runner(ctx);
  /** Bumped after each write: a token-only change may leave the record as it was. */
  let written = $state(0);
  const element = $derived(readElement(live.current.get(id)));
  const look = $derived.by(() => {
    void live.current;
    void written;
    return ctx.look(id);
  });
  /** The checkbox, kept apart from `look`: an own token may be the same file. */
  let same = $state(untrack(() => look?.sameAsImage ?? true));
  $effect(() => {
    if (look && !look.sameAsImage) same = false;
  });
  /** The pose shown while dragging or scrolling, before it is written. */
  let draft = $state.raw<Pose | undefined>();
  const pose = $derived(draft ?? look?.pose ?? CENTRED);
  const ring = $derived(look?.ring ?? { enabled: false, colors: { ring: null, background: null } });
  /** The token's side (px): the size factor of the grid square (#168). */
  const tokenPx = $derived(SIZE * (look?.sizeFactor ?? 1));

  /** The world's ring style (#135); `undefined` until loaded or without one. */
  let style = $state.raw<RingPreview | undefined>();
  void ctx.ringPreview().then((s) => (style = s));
  const order = $derived<Order>(look?.order ?? 'ring');
  /** The subject's crop radius with the ring on (the same as the file's); none without. */
  const crop = $derived(
    ring.enabled ? subjectCrop(style?.edges ?? DEFAULT_EDGES, order) : undefined,
  );
  /** The token image's width / height, once loaded. */
  let aspect = $state(1);

  async function commit(edit: ImageEdit) {
    await run('element.setImage', { id, ...edit });
    draft = undefined;
    written++;
  }

  /** v1.1 §G.3.1: an imported actor's original look back (also while hooded). */
  async function restore() {
    await run('element.restoreImages', { id });
    draft = undefined;
    same = true;
    written++;
  }

  async function pickSheet() {
    const img = await ctx.pickImage(look?.img ?? '');
    if (img !== undefined) await commit(same ? { img, token: { sameAsImage: true } } : { img });
  }
  async function pickToken() {
    const src = await ctx.pickImage(look?.token ?? '');
    if (src !== undefined) await commit({ token: { src, sameAsImage: false } });
  }
  function setSame(on: boolean) {
    same = on;
    if (on) void commit({ token: { sameAsImage: true } });
  }
  const setColor = (key: 'ring' | 'background', value: string | null) =>
    commit({ token: { ring: { colors: { [key]: value } } } });

  const writePose = (p: Pose) =>
    commit({ token: { anchor: { x: p.anchorX, y: p.anchorY }, scale: p.scale } });

  // Drag: the image point under the centre is the texture anchor.
  let drag: { x: number; y: number; from: Pose } | undefined;
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, from: pose };
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / tokenPx;
    const dy = (e.clientY - drag.y) / tokenPx;
    draft = dragPose(drag.from, dx, dy, crop, aspect);
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
    const scale = pose.scale * (e.deltaY < 0 ? 1.05 : 1 / 1.05);
    draft = clampPose({ ...pose, scale }, crop, aspect);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => draft && void writePose(draft), 300);
  }
  onDestroy(() => clearTimeout(wheelTimer));
  const slide = (value: string) => clampPose({ ...pose, scale: Number(value) }, crop, aspect);

  function reset() {
    void commit({
      token: {
        anchor: { x: CENTRED.anchorX, y: CENTRED.anchorY },
        scale: CENTRED.scale,
        ring: { colors: { ring: null, background: null } },
      },
    });
  }

  const subject = $derived(subjectBox(pose, crop, aspect));
  const box = $derived(subject.box);
  /** CSS drawing one spritesheet frame at the token size. */
  function sprite(rect: SheetRect | undefined) {
    if (!style || !rect) return undefined;
    const k = tokenPx / rect.w;
    return [
      `background-image: url("${style.src}")`,
      `background-size: ${style.sheet.w * k}px ${style.sheet.h * k}px`,
      `background-position: ${-rect.x * k}px ${-rect.y * k}px`,
    ].join(';');
  }
  const ringColor = $derived(ring.colors.ring ?? style?.colors.ring);
  const backgroundColor = $derived(ring.colors.background ?? style?.colors.background);
  /** The colour band as a radial gradient (radius 1 = 50% of the frame). */
  const band = $derived(
    style && ringColor
      ? `radial-gradient(circle closest-side, transparent ${style.edges.inner * 100}%, ${ringColor} ${style.edges.inner * 100}%, ${ringColor} ${style.edges.outer * 100}%, transparent ${style.edges.outer * 100}%)`
      : undefined,
  );
</script>

{#snippet color(key: 'ring' | 'background', label: string)}
  <div class="row" data-silk-image-color={key}>
    <span class="label">{label}</span>
    <input
      type="color"
      value={ring.colors[key] ?? '#ffffff'}
      disabled={!ring.enabled}
      onchange={(e) => setColor(key, e.currentTarget.value)}
      data-silk-image-color-input={key}
    />
    {#if ring.colors[key]}
      <button
        type="button"
        class="icon"
        disabled={!ring.enabled}
        title={t('WorldDefault')}
        onclick={() => setColor(key, null)}
        data-silk-image-color-clear={key}><i class="fa-solid fa-xmark"></i></button
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
        <button type="button" onclick={pickSheet} data-silk-image-sheet-choose>{t('Choose')}</button
        >
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
          <button type="button" onclick={pickToken} data-silk-image-token-choose
            >{t('Choose')}</button
          >
        </div>
      {/if}
      <label class="row">
        <input
          type="checkbox"
          checked={look.lockRotation}
          onchange={(e) => commit({ token: { lockRotation: e.currentTarget.checked } })}
          data-silk-image-lock-rotation
        />
        {t('LockRotation')}
      </label>
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
      <div class="row" data-silk-image-order>
        <span class="label">{t('DrawOrder')}</span>
        <select
          value={order}
          disabled={!ring.enabled}
          onchange={(e) => commit({ token: { order: e.currentTarget.value as Order } })}
          data-silk-image-order-select
        >
          <option value="ring">{t('OrderRing')}</option>
          <option value="illustration">{t('OrderIllustration')}</option>
        </select>
      </div>
      {@render color('ring', t('RingColor'))}
      {@render color('background', t('BackgroundColor'))}
    </DetailSection>
    <DetailSection title={t('Position')} data-silk-image-position>
      <div
        class="frame"
        style:width="{SIZE}px"
        style:height="{SIZE}px"
        style:--ring={ringColor ?? 'currentColor'}
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
        <div
          class="token"
          class:ring={ring.enabled}
          class:styled={ring.enabled && style}
          style:width="{tokenPx}px"
          style:height="{tokenPx}px"
          data-silk-image-preview-token
        >
          {#if ring.enabled}
            <div class="layer" style={sprite(style?.background)} data-silk-image-preview-background>
              {#if backgroundColor}
                <div
                  class="layer tint"
                  style:background={backgroundColor}
                  style:clip-path="circle({(style?.edges.outer ?? 1) * 50}% at 50% 50%)"
                ></div>
              {/if}
            </div>
          {/if}
          {#if ring.enabled && style}
            <div class="layer" style={sprite(style.ring)} data-silk-image-preview-ring>
              {#if band}
                <div class="layer tint" style:background={band}></div>
              {/if}
            </div>
          {/if}
          <div
            class="layer"
            style:clip-path={subject.circle !== undefined
              ? `circle(${subject.circle * 100}% at 50% 50%)`
              : undefined}
          >
            <img
              src={look.token || undefined}
              alt=""
              draggable="false"
              onload={(e) => {
                const img = e.currentTarget as HTMLImageElement;
                aspect = img.naturalWidth / (img.naturalHeight || 1) || 1;
              }}
              style:left="{box.left * tokenPx}px"
              style:top="{box.top * tokenPx}px"
              style:width="{box.width * tokenPx}px"
              style:height="{box.height * tokenPx}px"
            />
          </div>
        </div>
      </div>
      <label class="row">
        <span class="label">{t('Scale')}</span>
        <input
          type="range"
          min={SCALE.min}
          max={SCALE.max}
          step={SCALE.step}
          value={pose.scale}
          oninput={(e) => (draft = slide(e.currentTarget.value))}
          onchange={(e) => writePose(slide(e.currentTarget.value))}
          data-silk-image-scale
        />
        <span class="value">{pose.scale.toFixed(2)}</span>
      </label>
      <button type="button" class="reset" onclick={reset} data-silk-image-reset>{t('Reset')}</button
      >
    </DetailSection>
    {#if look.restorable}
      <button
        type="button"
        class="reset"
        title={t('RestoreHint')}
        onclick={() => restore()}
        data-silk-image-restore>{t('Restore')}</button
      >
    {/if}
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
  }
  .token {
    position: absolute;
    left: 50%;
    top: 50%;
    overflow: hidden;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .token.ring {
    border-radius: 50%;
    box-shadow: inset 0 0 0 6px var(--ring);
  }
  .token.styled {
    box-shadow: none;
  }
  .frame:active {
    cursor: grabbing;
  }
  .layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .tint {
    border-radius: 50%;
    mix-blend-mode: multiply;
  }
  .token img {
    position: absolute;
    max-width: none;
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
