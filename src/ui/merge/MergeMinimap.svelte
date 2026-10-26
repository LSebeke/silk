<script lang="ts">
  /**
   * Event Scene minimap of the merge drawer (spec §11.4): each changed token at its base
   * (dashed), Canon and Adventure positions, joined by lines.
   */
  import type { JsonValue } from '../../core/canon';
  import type { RecordView } from '../../core/merge';

  let { record, t }: { record: RecordView; t: (key: string) => string } = $props();

  type At = { x: number; y: number };
  const at = (v: JsonValue | undefined): At | undefined =>
    v && typeof v === 'object' && !Array.isArray(v) && typeof v.x === 'number'
      ? { x: v.x, y: typeof v.y === 'number' ? v.y : 0 }
      : undefined;
  const scene = $derived((record.display.data.scene ?? {}) as { width?: number; height?: number });
  const width = $derived(scene.width || 4000);
  const height = $derived(scene.height || 3000);
  const r = $derived(Math.max(width, height) / 60);
  const tokens = $derived(
    record.rows
      .filter((row) => row.kind === 'token')
      .map((row) => ({
        id: row.field,
        label: row.label,
        base: at(row.base),
        ours: at(row.ours),
        theirs: at(row.theirs),
      })),
  );
  const same = (a: At | undefined, b: At | undefined) => !!a && !!b && a.x === b.x && a.y === b.y;
</script>

<figure class="silk-merge-minimap" data-silk-merge-minimap>
  <svg viewBox="0 0 {width} {height}" preserveAspectRatio="xMidYMid meet">
    <rect x="0" y="0" {width} {height} class="frame" stroke-width={r / 4} />
    {#each tokens as tok (tok.id)}
      <g data-silk-merge-minimap-token={tok.id}>
        <title>{tok.label}</title>
        {#if tok.base && tok.ours && !same(tok.base, tok.ours)}
          <line
            x1={tok.base.x}
            y1={tok.base.y}
            x2={tok.ours.x}
            y2={tok.ours.y}
            class="ours"
            stroke-width={r / 4}
          />
        {/if}
        {#if tok.base && tok.theirs && !same(tok.base, tok.theirs)}
          <line
            x1={tok.base.x}
            y1={tok.base.y}
            x2={tok.theirs.x}
            y2={tok.theirs.y}
            class="theirs"
            stroke-width={r / 4}
          />
        {/if}
        {#if tok.base}
          <circle cx={tok.base.x} cy={tok.base.y} {r} class="base" stroke-width={r / 4} />
        {/if}
        {#if tok.ours && !same(tok.base, tok.ours)}
          <circle cx={tok.ours.x} cy={tok.ours.y} {r} class="ours fill" />
        {/if}
        {#if tok.theirs && !same(tok.base, tok.theirs)}
          <circle cx={tok.theirs.x} cy={tok.theirs.y} {r} class="theirs fill" />
        {/if}
      </g>
    {/each}
  </svg>
  <figcaption>
    ○ {t('SILK.Merge.Base')} · <span class="ours-text">●</span>
    {t('SILK.Merge.CanonNow')} · <span class="theirs-text">●</span>
    {t('SILK.Merge.Adventure')}
  </figcaption>
</figure>

<style>
  .silk-merge-minimap {
    margin: 0.4rem 0;
  }
  svg {
    width: 100%;
    max-height: 180px;
    background: #1a1816;
    border-radius: 4px;
  }
  .frame {
    fill: none;
    stroke: #555;
  }
  .base {
    fill: none;
    stroke: #888;
    stroke-dasharray: 3 2;
  }
  line.ours {
    stroke: var(--merge-canon, #6fa8dc);
    stroke-dasharray: 2 2;
  }
  line.theirs {
    stroke: var(--merge-adv, #e8915a);
    stroke-dasharray: 2 2;
  }
  .fill.ours {
    fill: var(--merge-canon, #6fa8dc);
  }
  .fill.theirs {
    fill: var(--merge-adv, #e8915a);
  }
  figcaption {
    font-size: 0.8em;
    opacity: 0.75;
  }
  .ours-text {
    color: var(--merge-canon, #6fa8dc);
  }
  .theirs-text {
    color: var(--merge-adv, #e8915a);
  }
</style>
