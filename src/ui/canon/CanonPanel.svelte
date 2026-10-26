<script lang="ts">
  import type { CanonOverview } from '../../core/campaigns';

  let {
    overview,
    merging = false,
    run,
    t,
  }: {
    overview: CanonOverview;
    merging?: boolean;
    run: (name: string, args?: object) => Promise<void>;
    t: (key: string) => string;
  } = $props();

  let canonName = $state('');
  let adventureName = $state('');
  let campaignId = $state('');
  let newCampaign = $state('');
  let renaming = $state<{ id: string; name: string } | null>(null);
  /** Abandon: typed confirmation (spec §11.3). `null` = not asking. */
  let abandonTyped = $state<string | null>(null);

  const openCampaigns = $derived(overview.campaigns.filter((c) => !c.closed));
  const onMain = $derived(overview.checkout?.kind === 'main');
  const canStart = $derived(
    onMain && !overview.dirty && adventureName.trim() !== '' && campaignId !== '',
  );

  const date = (iso: string) => new Date(iso).toLocaleString();

  async function startAdventure() {
    await run('adventure.start', { name: adventureName, campaignId });
    adventureName = '';
  }

  async function createCampaign() {
    await run('campaign.create', { name: newCampaign });
    newCampaign = '';
  }

  /** Share source: a Commit hash or an Adventure id; defaults to the Checkout's head. */
  let shareFrom = $state('');
  const shareCommit = $derived(shareFrom || overview.log[0]?.hash || '');

  async function importFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (file) await run('canon.import', { file });
  }

  async function rename() {
    if (!renaming) return;
    await run('campaign.rename', renaming);
    renaming = null;
  }
</script>

<div class="silk-canon" data-silk-canon>
  {#if !overview.canon}
    <section>
      <p>{t('SILK.Canon.Unbound')}</p>
      <form
        class="row"
        onsubmit={(e) => {
          e.preventDefault();
          void run('canon.create', { name: canonName });
        }}
      >
        <input bind:value={canonName} placeholder={t('SILK.Canon.Name')} data-silk-canon-name />
        <button type="submit" disabled={!canonName.trim()} data-silk-canon-create>
          {t('SILK.Commands.canon.create')}
        </button>
      </form>
    </section>
    <section>{@render importer()}</section>
  {:else}
    <header>
      <h2 data-silk-canon-title>{overview.canon.name}</h2>
      <p data-silk-checkout>
        {t('SILK.Canon.Checkout')}:
        {#if overview.checkout?.kind === 'adventure'}
          <strong>{overview.checkout.name}</strong> · {overview.checkout.campaignName}
        {:else}
          <strong>{t('SILK.Canon.Main')}</strong>
        {/if}
        {#if overview.dirty}<span class="badge">{t('SILK.Canon.Dirty')}</span>{/if}
        {#if overview.canon.readOnly}<span class="badge">{t('SILK.Canon.ReadOnly')}</span>{/if}
      </p>
    </header>

    <section>
      <h3>{t('SILK.Canon.Adventures')}</h3>
      {#if onMain}
        <form
          class="row"
          onsubmit={(e) => {
            e.preventDefault();
            if (canStart) void startAdventure();
          }}
        >
          <input
            bind:value={adventureName}
            placeholder={t('SILK.Canon.AdventureName')}
            data-silk-adventure-name
          />
          <select bind:value={campaignId} data-silk-adventure-campaign>
            <option value="" disabled>{t('SILK.Canon.PickCampaign')}</option>
            {#each openCampaigns as campaign (campaign.id)}
              <option value={campaign.id}>{campaign.name}</option>
            {/each}
          </select>
          <button type="submit" disabled={!canStart} data-silk-adventure-start>
            {t('SILK.Commands.adventure.start')}
          </button>
        </form>
        {#if overview.dirty}<p class="hint">{t('SILK.Canon.StartNeedsClean')}</p>{/if}
      {:else if overview.checkout?.kind === 'adventure'}
        <div class="row">
          <button type="button" onclick={() => run('adventure.end')} data-silk-adventure-end>
            {merging ? t('SILK.Merge.Resume') : t('SILK.Commands.adventure.end')}
          </button>
          <button
            type="button"
            onclick={() => (abandonTyped = abandonTyped === null ? '' : null)}
            data-silk-adventure-abandon
          >
            {t('SILK.Canon.Abandon')}
          </button>
        </div>
        {#if abandonTyped !== null}
          {@const name = overview.checkout.name}
          <form
            class="abandon"
            data-silk-abandon-dialog
            onsubmit={async (e) => {
              e.preventDefault();
              if (abandonTyped !== name) return;
              await run('adventure.abandon', { confirm: abandonTyped });
              abandonTyped = null;
            }}
          >
            <p>{t('SILK.Canon.AbandonPrompt')} <strong>{name}</strong></p>
            <div class="row">
              <input bind:value={abandonTyped} placeholder={name} data-silk-abandon-input />
              <button type="submit" disabled={abandonTyped !== name} data-silk-abandon-confirm>
                {t('SILK.Canon.AbandonConfirm')}
              </button>
            </div>
          </form>
        {/if}
      {/if}
      <ul data-silk-adventures>
        {#each overview.adventures as adventure (adventure.id)}
          <li class:current={adventure.current} data-silk-adventure={adventure.id}>
            {adventure.name} <span class="muted">· {adventure.campaignName}</span>
          </li>
        {:else}
          <li class="muted">{t('SILK.Canon.NoAdventures')}</li>
        {/each}
      </ul>
    </section>

    <section>
      <h3>{t('SILK.Canon.History')}</h3>
      <ol data-silk-history>
        {#each overview.log as commit (commit.hash)}
          <li data-silk-commit={commit.hash}>
            <span>{commit.label || t('SILK.Canon.Unlabelled')}</span>
            <span class="muted">{date(commit.date)}</span>
          </li>
        {:else}
          <li class="muted">{t('SILK.Canon.NoCommits')}</li>
        {/each}
      </ol>
    </section>

    <section>
      <h3>{t('SILK.Canon.Campaigns')}</h3>
      <ul data-silk-campaigns>
        {#each overview.campaigns as campaign (campaign.id)}
          <li class:closed={campaign.closed} data-silk-campaign={campaign.id}>
            {#if renaming?.id === campaign.id}
              <form
                class="row"
                onsubmit={(e) => {
                  e.preventDefault();
                  void rename();
                }}
              >
                <input bind:value={renaming.name} data-silk-campaign-rename-input />
                <button type="submit" data-silk-campaign-rename-confirm>OK</button>
              </form>
            {:else}
              <span>{campaign.name}</span>
              {#if campaign.closed}<span class="badge">{t('SILK.Canon.Closed')}</span>{/if}
              <button
                type="button"
                onclick={() => (renaming = { id: campaign.id, name: campaign.name })}
                data-silk-campaign-rename
              >
                {t('SILK.Commands.campaign.rename')}
              </button>
              {#if campaign.closed}
                <button
                  type="button"
                  onclick={() => run('campaign.reopen', { id: campaign.id })}
                  data-silk-campaign-reopen
                >
                  {t('SILK.Commands.campaign.reopen')}
                </button>
              {:else}
                <button
                  type="button"
                  onclick={() => run('campaign.close', { id: campaign.id })}
                  data-silk-campaign-close
                >
                  {t('SILK.Commands.campaign.close')}
                </button>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
      <form
        class="row"
        onsubmit={(e) => {
          e.preventDefault();
          if (newCampaign.trim()) void createCampaign();
        }}
      >
        <input
          bind:value={newCampaign}
          placeholder={t('SILK.Canon.CampaignName')}
          data-silk-campaign-name
        />
        <button type="submit" disabled={!newCampaign.trim()} data-silk-campaign-create>
          {t('SILK.Commands.campaign.create')}
        </button>
      </form>
    </section>

    <section data-silk-portability>
      <h3>{t('SILK.Canon.Portability.Heading')}</h3>
      <div class="row">
        <button type="button" onclick={() => run('canon.exportBackup')} data-silk-canon-backup>
          {t('SILK.Commands.canon.exportBackup')}
        </button>
      </div>
      <div class="row">
        <label for="silk-share-from">{t('SILK.Canon.Portability.ShareCommit')}</label>
        <select id="silk-share-from" bind:value={shareFrom} data-silk-share-commit>
          <option value="">{overview.log[0]?.label || t('SILK.Canon.Unlabelled')}</option>
          {#each overview.log.slice(1) as commit (commit.hash)}
            <option value={commit.hash}>
              {commit.label || t('SILK.Canon.Unlabelled')} · {date(commit.date)}
            </option>
          {/each}
          {#each overview.adventures.filter((a) => !a.current) as adventure (adventure.id)}
            <option value={adventure.id}>
              {t('SILK.Canon.Portability.AdventureHead')}: {adventure.name}
            </option>
          {/each}
        </select>
        <button
          type="button"
          disabled={!shareCommit}
          onclick={() => run('canon.exportShare', { commit: shareCommit })}
          data-silk-canon-share
        >
          {t('SILK.Commands.canon.exportShare')}
        </button>
      </div>
      {@render importer()}
    </section>
  {/if}
</div>

{#snippet importer()}
  <label class="row">
    {t('SILK.Canon.Portability.ImportFile')}
    <input
      type="file"
      accept=".zip,application/zip"
      onchange={(e) => importFile(e.currentTarget)}
      data-silk-canon-import
    />
  </label>
{/snippet}

<style>
  .silk-canon {
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    overflow-y: auto;
    height: 100%;
  }
  h2,
  h3 {
    margin: 0 0 0.25rem;
  }
  ul,
  ol {
    margin: 0.25rem 0 0;
    padding-left: 1.25rem;
  }
  li {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  li.current {
    font-weight: bold;
  }
  li.closed > span:first-child {
    opacity: 0.6;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .row input {
    flex: 1;
  }
  .muted,
  .hint {
    opacity: 0.7;
  }
  .abandon {
    border: 1px solid var(--color-level-error, #c33);
    border-radius: 4px;
    padding: 0.5rem;
  }
  .abandon p {
    margin: 0 0 0.5rem;
  }
  .badge {
    font-size: 0.8em;
    padding: 0 0.4em;
    border: 1px solid currentColor;
    border-radius: 0.6em;
  }
</style>
