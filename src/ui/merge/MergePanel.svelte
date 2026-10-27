<script lang="ts">
  /**
   * Merge window content (spec §11.4): summary header, canvas diff of the merged result,
   * drawer with Base | Canon now | Adventure → Result per field, footer with Cancel / Merge.
   * Every action is a command (`merge.*`).
   */
  import {
    SvelteFlow,
    Background,
    useNodesInitialized,
    useSvelteFlow,
    type EdgeTypes,
    type NodeTypes,
  } from '@xyflow/svelte';
  import type { Side } from '../../core/canon';
  import type { Attribution, Badge, MergeRow, RecordView } from '../../core/merge';
  import MergeCard from './MergeCard.svelte';
  import MergeEdge from './MergeEdge.svelte';
  import MergeFrame from './MergeFrame.svelte';
  import MergeMinimap from './MergeMinimap.svelte';
  import MergeOutline from './MergeOutline.svelte';
  import {
    chosen,
    combinedText,
    drawerRecords,
    formatRowValue,
    nodeOf,
    sectionsOf,
    toMergeEdges,
    toMergeNodes,
  } from './merge-flow';
  import type { MergePanelProps } from './MergeWindow';

  let { view, focus, select, run, t }: MergePanelProps = $props();

  const nodeTypes = {
    element: MergeCard,
    frame: MergeFrame,
    outline: MergeOutline,
  } as unknown as NodeTypes;
  const edgeTypes = { connection: MergeEdge } as unknown as EdgeTypes;
  const flow = useSvelteFlow();

  let showCanonOnly = $state(false);
  /** Join Campaigns (§11.5): Target / Source / Result, no base column, no conflicts. */
  const join = $derived(view?.draft.kind === 'join');
  const sides = $derived<Side[]>(view?.columns.base ? ['base', 'ours', 'theirs'] : ['ours', 'theirs']);
  const shown = (value: string | undefined) => (join && value === 'true' ? '✓' : value);
  let editing = $state<{ recordId: string; field: string; text: string } | null>(null);

  const nodeId = $derived(view && focus ? nodeOf(view, focus.recordId) : undefined);
  const opts = $derived({ showCanonOnly, selected: nodeId });
  const nodes = $derived(view ? toMergeNodes(view, opts) : []);
  const edges = $derived(view ? toMergeEdges(view, opts) : []);
  const drawer = $derived(view && focus ? drawerRecords(view, focus.recordId) : []);
  const record = $derived(drawer[0]);
  const badges: Exclude<Badge, 'same'>[] = [
    'conflict',
    'added',
    'deleted',
    'changed',
    'layout',
    'canonOnly',
  ];
  const countOf = (b: Exclude<Badge, 'same'>) =>
    view ? view.counts[b === 'conflict' ? 'conflicts' : b] : 0;

  // `fitView` runs on mount, before Foundry has sized the window (pane 0×0 → min zoom):
  // fit once the pane has a size and the Nodes are measured.
  const initialized = useNodesInitialized();
  let paneWidth = $state(0);
  let paneHeight = $state(0);
  let fitted = false;
  $effect(() => {
    if (fitted || !paneWidth || !paneHeight || !initialized.current) return;
    fitted = true;
    void flow.fitView();
  });

  // ⏎ Next conflict: pan the canvas to the focused Node.
  let lastFocus: string | undefined;
  $effect(() => {
    const id = nodeId;
    if (!id || id === lastFocus) return;
    lastFocus = id;
    const node = flow.getNode(id);
    if (node) void flow.fitView({ nodes: [{ id }], duration: 200, maxZoom: 1 });
  });

  const date = (iso: string) => new Date(iso).toLocaleDateString();
  const name = (r: RecordView) => {
    const data = r.display.data;
    if (r.kind === 'connection') {
      const label = (id: unknown) =>
        String(view?.records.find((x) => x.id === id)?.display.data.name ?? id);
      return `${label(data.from)} → ${label(data.to)}${data.label ? ` (${String(data.label)})` : ''}`;
    }
    return String(data.name ?? data.label ?? r.id);
  };

  function onKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (event.key !== 'Enter' || target.closest('textarea, input, button')) return;
    event.preventDefault();
    void run('merge.nextConflict');
  }

  const pick = (row: { recordId: string; field: string }, side: Side) =>
    run('merge.pick', { recordId: row.recordId, field: row.field, side });
  const pickWhole = (r: RecordView, side: Side) =>
    run('merge.pick', { recordId: r.id, field: '', side });

  async function useText() {
    if (!editing) return;
    const { recordId, field, text } = editing;
    editing = null;
    await run('merge.pick', { recordId, field, value: text });
  }

  const visible = (row: MergeRow) => showCanonOnly || !row.canonOnly;
  const decisions = (r: RecordView) => r.rows.filter((row) => visible(row) && row.conflict);
  const autos = (r: RecordView) => r.rows.filter((row) => visible(row) && !row.conflict);
  const anyDecision = $derived(drawer.some((r) => decisions(r).length > 0));
  const by = (a: Attribution) =>
    a.adventure !== undefined
      ? `${a.adventure} · ${a.campaign ?? ''} · ${date(a.date)}`
      : `${a.label} · ${date(a.date)}`;
  const recordTitle = (r: RecordView) =>
    t(`SILK.Merge.Record.${r.kind}`) +
    (r.badge === 'same' ? '' : ` · ${t(`SILK.Merge.Badge.${r.badge}`)}`);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="silk-merge" data-silk-merge onkeydown={onKeydown} tabindex="-1">
  {#if !view}
    <p class="empty">{t('SILK.Merge.NoChanges')}</p>
  {:else}
    <header class="bar">
      <div class="title" data-silk-merge-title>
        {#if join}
          {t('SILK.Merge.JoinHeading')}
          <strong class="adv">{view.title.adventure}</strong>
          {t('SILK.Merge.JoinInto')}
          <strong class="canon">{view.title.campaign}</strong>
        {:else}
          {t('SILK.Merge.Heading')}
          <strong class="adv">{view.title.adventure}</strong>
          <span class="muted">({view.title.campaign})</span>
          {t('SILK.Merge.Into')}
        {/if}
      </div>
      <div class="chips">
        {#each badges as b (b)}
          {#if countOf(b) && (b !== 'canonOnly' || showCanonOnly)}
            <span class="chip {b}" data-silk-merge-count={b}
              >{t(`SILK.Merge.Badge.${b}`)} {countOf(b)}</span
            >
          {/if}
        {/each}
        {#if view.counts.moves}
          <span class="chip layout" data-silk-merge-moves={view.counts.moves}
            >{view.counts.moves} {t('SILK.Merge.Layout')}</span
          >
        {/if}
      </div>
      <span class="grow"></span>
      {#if !join}
        <label class="toggle">
          <input type="checkbox" bind:checked={showCanonOnly} data-silk-merge-canon-only />
          {t('SILK.Merge.ShowCanonOnly')}
        </label>
        <button type="button" onclick={() => run('merge.nextConflict')} data-silk-merge-next>
          {t('SILK.Commands.merge.nextConflict')} ⏎
        </button>
      {/if}
    </header>
    <div class="received" data-silk-merge-received hidden={join}>
      {#if view.received.length}
        {t('SILK.Merge.Received')}:
        {#each view.received as m (m.commit)}
          <span class="chip canon">{m.adventure} · {m.campaign} · {date(m.date)}</span>
        {/each}
      {:else}
        <span class="muted">{t('SILK.Merge.NoneReceived')}</span>
      {/if}
    </div>

    <div class="body">
      <div class="canvas" bind:clientWidth={paneWidth} bind:clientHeight={paneHeight}>
        <SvelteFlow
          {nodes}
          {edges}
          {nodeTypes}
          {edgeTypes}
          fitView
          minZoom={0.05}
          nodesDraggable={false}
          nodesConnectable={false}
          onnodeclick={({ node }) => node.type === 'element' && select(node.id)}
          onedgeclick={({ edge }) => select(edge.id)}
          onpaneclick={() => select(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={40} />
        </SvelteFlow>
        <div class="legend muted">{t('SILK.Merge.ResultHint')}</div>
      </div>

      <aside class="drawer" data-silk-merge-drawer={record?.id ?? ''}>
        {#if !record}
          <p class="muted">{t('SILK.Merge.ClickNode')}</p>
        {:else}
          <h3>{name(record)}</h3>
          <div class="muted">
            {record.kind} · {t(
              `SILK.Merge.Badge.${record.badge === 'same' ? 'changed' : record.badge}`,
            )}
          </div>

          {#if record.whole}
            {@const w = record.whole}
            {@const keep = w.theirs !== undefined ? 'theirs' : 'ours'}
            {@const drop = w.theirs === undefined ? 'theirs' : 'ours'}
            {@const sel = w.pick
              ? 'side' in w.pick
                ? w.pick.side
                : 'value'
              : w.open
                ? null
                : w.auto}
            <div class="whole" class:open={w.open} data-silk-merge-field="">
              <span>{t('SILK.Merge.Whole')}</span>
              <button
                type="button"
                class:sel={sel === keep}
                onclick={() => pickWhole(record, keep)}
                data-silk-merge-whole="keep">{t('SILK.Merge.Keep')}</button
              >
              <button
                type="button"
                class:sel={sel === drop}
                onclick={() => pickWhole(record, drop)}
                data-silk-merge-whole="delete">{t('SILK.Merge.Delete')}</button
              >
            </div>
          {/if}

          {#each drawer as r (r.id)}
            {@const own = decisions(r)}
            {@const rest = autos(r)}
            {#if own.length || rest.length}
              <section class="record" data-silk-merge-record={r.id}>
                {#if r !== record}<h4>{recordTitle(r)}</h4>{/if}
                {#if r.kind === 'eventScene' && r.rows.some((row) => row.kind === 'token')}
                  <MergeMinimap record={r} {t} />
                {/if}
                {#if own.length}
                  {@render table(r, own)}
                {/if}
                {#if rest.length}
                  <details class="auto" open={!anyDecision && !record.whole}>
                    <summary>{t('SILK.Merge.AutoMerged')} ({rest.length})</summary>
                    {@render table(r, rest)}
                  </details>
                {/if}
              </section>
            {/if}
          {/each}
          {#if !record.whole && drawer.every((r) => !decisions(r).length && !autos(r).length)}
            <p class="muted">{t('SILK.Merge.NoChanges')}</p>
          {/if}
        {/if}
      </aside>
    </div>

    <footer class="bar">
      <span class="muted">{t(join ? 'SILK.Merge.JoinFooter' : 'SILK.Merge.Footer')}</span>
      <span class="grow"></span>
      <button type="button" onclick={() => run('merge.cancel')} data-silk-merge-cancel>
        {t('SILK.Commands.merge.cancel')}
      </button>
      <button
        type="button"
        class="primary"
        disabled={view.counts.open > 0}
        onclick={() => run('merge.confirm')}
        data-silk-merge-confirm
      >
        {view.counts.open
          ? t('SILK.Merge.ConflictsLeft', { n: String(view.counts.open) })
          : t('SILK.Commands.merge.confirm')}
      </button>
    </footer>
  {/if}
</div>

{#snippet cell(row: MergeRow, side: Side)}
  {@const value = formatRowValue(row, row[side])}
  <td
    class="pick {side}"
    class:sel={chosen(row) === side}
    onclick={() => pick(row, side)}
    data-silk-merge-cell={side}
  >
    {#if value === undefined}<span class="none">{t('SILK.Merge.None')}</span>{:else}{shown(value)}{/if}
    {#if side === 'ours' && row.by}
      <span class="chip canon by" data-silk-merge-by>{by(row.by)}</span>
    {/if}
    {#if side === 'theirs' && row.from}
      <span class="chip adv by" data-silk-merge-from>{t('SILK.Merge.From', { name: row.from })}</span>
    {/if}
  </td>
{/snippet}

{#snippet table(r: RecordView, rows: MergeRow[])}
  <table class="fields">
    <thead>
      <tr>
        <th>{t('SILK.Merge.Field')}</th>
        {#if sides.includes('base')}<th>{t(view?.columns.base ?? '')}</th>{/if}
        <th class="canon">{t(view?.columns.ours ?? '')}</th>
        <th class="adv">{t(view?.columns.theirs ?? '')}</th>
        <th>{t('SILK.Merge.Result')}</th>
      </tr>
    </thead>
    {#each sectionsOf(rows) as group (group.section)}
      <tbody data-silk-merge-section={group.section}>
        <tr class="section"><th colspan={sides.length + 2}>{t(group.section)}</th></tr>
        {#each group.rows as row (row.field)}
          {@const result = formatRowValue(row, row.result)}
          <tr
            class:open={row.open}
            class:focused={focus?.recordId === r.id &&
              (focus.field === row.field || focus.field?.startsWith(`${row.field}/`))}
            data-silk-merge-field={row.field}
            data-silk-merge-kind={row.kind}
            data-silk-merge-open={row.open ? '' : undefined}
          >
            <th scope="row">{row.label}</th>
            {#each sides as side (side)}
              {@render cell(row, side)}
            {/each}
            <td class="result" data-silk-merge-result>
              {#if editing && editing.recordId === r.id && editing.field === row.field}
                <textarea bind:value={editing.text} data-silk-merge-text></textarea>
                <button type="button" onclick={useText} data-silk-merge-use-text>
                  {t('SILK.Merge.UseText')}
                </button>
              {:else}
                {#if row.open}
                  <span class="chip conflict">{t('SILK.Merge.Open')}</span>
                {:else if result === undefined}
                  <span class="none">{t('SILK.Merge.None')}</span>
                {:else}
                  {shown(result)}
                {/if}
                {#if row.text}
                  <button
                    type="button"
                    class="ghost"
                    onclick={() =>
                      (editing = { recordId: r.id, field: row.field, text: combinedText(row) })}
                    data-silk-merge-combine>✎ {t('SILK.Merge.WriteCombined')}</button
                  >
                {/if}
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    {/each}
  </table>
{/snippet}

<style>
  .silk-merge {
    --merge-canon: #6fa8dc;
    --merge-adv: #e8915a;
    --merge-conf: #f1c232;
    --merge-ok: #7bbf6a;
    --merge-bad: #e06666;
    display: flex;
    flex-direction: column;
    height: 100%;
    outline: none;
  }
  .bar,
  .received {
    flex-shrink: 0;
  }
  .bar {
    /* Foundry/system styles position a window's header/footer absolutely. */
    position: static;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--color-border, #4a4540);
  }
  footer.bar {
    border-top: 1px solid var(--color-border, #4a4540);
    border-bottom: 0;
  }
  .received {
    padding: 0.2rem 0.6rem;
    font-size: 0.9em;
  }
  .grow {
    flex: 1;
  }
  .muted,
  .none {
    opacity: 0.65;
  }
  .none {
    font-style: italic;
  }
  .adv,
  th.adv {
    color: var(--merge-adv);
  }
  th.canon {
    color: var(--merge-canon);
  }
  .chips {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
  .chip {
    font-size: 0.8em;
    padding: 0 0.45em;
    border-radius: 0.6em;
    border: 1px solid currentColor;
    white-space: nowrap;
  }
  .chip.conflict {
    color: var(--merge-conf);
  }
  .chip.added {
    color: var(--merge-ok);
  }
  .chip.deleted {
    color: var(--merge-bad);
  }
  .chip.changed,
  .chip.layout {
    color: var(--merge-adv);
  }
  .chip.canon,
  .chip.canonOnly {
    color: var(--merge-canon);
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    white-space: nowrap;
  }
  .body {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .canvas {
    flex: 1;
    position: relative;
    min-width: 0;
  }
  .legend {
    position: absolute;
    left: 0.5rem;
    bottom: 0.5rem;
    pointer-events: none;
  }
  .drawer {
    width: 460px;
    overflow: auto;
    padding: 0.6rem;
    border-left: 1px solid var(--color-border, #4a4540);
  }
  .drawer h3 {
    margin: 0;
  }
  .whole {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    margin: 0.5rem 0;
    padding: 0.3rem;
    border-radius: 4px;
  }
  .whole.open {
    box-shadow: inset 3px 0 var(--merge-conf);
  }
  .whole button.sel {
    border-color: var(--merge-adv);
  }
  table.fields {
    width: 100%;
    border-collapse: collapse;
    margin: 0.4rem 0;
    font-size: 0.9em;
  }
  table.fields th,
  table.fields td {
    text-align: left;
    vertical-align: top;
    padding: 0.25rem 0.35rem;
    border-bottom: 1px solid #3a3632;
    word-break: break-word;
  }
  tr.open th {
    box-shadow: inset 3px 0 var(--merge-conf);
  }
  tr.focused {
    background: #f1c23214;
  }
  td.pick {
    cursor: pointer;
    border-left: 3px solid transparent;
  }
  td.pick:hover {
    background: #ffffff10;
  }
  td.pick.sel.ours {
    border-left-color: var(--merge-canon);
    background: #6fa8dc1a;
  }
  td.pick.sel.theirs {
    border-left-color: var(--merge-adv);
    background: #e8915a1a;
  }
  td.pick.sel.base {
    border-left-color: #999;
  }
  textarea {
    width: 100%;
    min-height: 5rem;
  }
  tr.section th {
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.7;
    padding-top: 0.5rem;
  }
  .chip.by {
    display: inline-block;
    margin-top: 0.15rem;
  }
  section.record h4 {
    margin: 0.8rem 0 0.2rem;
    border-bottom: 1px solid var(--color-border, #4a4540);
  }
  details.auto summary {
    cursor: pointer;
    margin-top: 0.5rem;
  }
  button.ghost {
    background: none;
    border-color: transparent;
    font-size: 0.85em;
  }
  button.primary:disabled {
    opacity: 0.5;
  }
  .empty {
    padding: 1rem;
  }
</style>
