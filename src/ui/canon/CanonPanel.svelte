<script lang="ts">
  import type { CanonOverview } from '../../core/campaigns';

  let {
    overview,
    merging = false,
    mergeOpen = false,
    run,
    t,
  }: {
    overview: CanonOverview;
    merging?: boolean;
    mergeOpen?: boolean;
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
  /** Join into… (spec §11.5): the source being joined, `null` = not asking. */
  let joining = $state<{ sourceId: string; targetId: string; closeSource: boolean } | null>(null);

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

  async function join() {
    if (!joining?.targetId) return;
    await run('campaign.join', joining);
    joining = null;
  }

  async function rename() {
    if (!renaming) return;
    await run('campaign.rename', renaming);
    renaming = null;
  }
</script>

<div class="garn-canon" data-garn-canon>
  {#if !overview.canon}
    <section>
      <p>{t('GARN.Canon.Unbound')}</p>
      <form
        class="row"
        onsubmit={(e) => {
          e.preventDefault();
          void run('canon.create', { name: canonName });
        }}
      >
        <input bind:value={canonName} placeholder={t('GARN.Canon.Name')} data-garn-canon-name />
        <button type="submit" disabled={!canonName.trim()} data-garn-canon-create>
          {t('GARN.Commands.canon.create')}
        </button>
      </form>
    </section>
    <section>{@render importer()}</section>
  {:else}
    <header>
      <h2 data-garn-canon-title>{overview.canon.name}</h2>
      <p data-garn-checkout>
        {t('GARN.Canon.Checkout')}:
        {#if overview.checkout?.kind === 'adventure'}
          <strong>{overview.checkout.name}</strong> · {overview.checkout.campaignName}
        {:else}
          <strong>{t('GARN.Canon.Main')}</strong>
        {/if}
        {#if overview.dirty}<span class="badge">{t('GARN.Canon.Dirty')}</span>{/if}
        {#if overview.canon.readOnly}<span class="badge">{t('GARN.Canon.ReadOnly')}</span>{/if}
      </p>
    </header>

    <section>
      <h3>{t('GARN.Canon.Adventures')}</h3>
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
            placeholder={t('GARN.Canon.AdventureName')}
            data-garn-adventure-name
          />
          <select bind:value={campaignId} data-garn-adventure-campaign>
            <option value="" disabled>{t('GARN.Canon.PickCampaign')}</option>
            {#each openCampaigns as campaign (campaign.id)}
              <option value={campaign.id}>{campaign.name}</option>
            {/each}
          </select>
          <button type="submit" disabled={!canStart} data-garn-adventure-start>
            {t('GARN.Commands.adventure.start')}
          </button>
        </form>
        {#if overview.dirty}<p class="hint">{t('GARN.Canon.StartNeedsClean')}</p>{/if}
      {:else if overview.checkout?.kind === 'adventure'}
        <div class="row">
          <button type="button" onclick={() => run('adventure.end')} data-garn-adventure-end>
            {merging ? t('GARN.Merge.Resume') : t('GARN.Commands.adventure.end')}
          </button>
          <button
            type="button"
            onclick={() => (abandonTyped = abandonTyped === null ? '' : null)}
            data-garn-adventure-abandon
          >
            {t('GARN.Canon.Abandon')}
          </button>
        </div>
        {#if abandonTyped !== null}
          {@const name = overview.checkout.name}
          <form
            class="abandon"
            data-garn-abandon-dialog
            onsubmit={async (e) => {
              e.preventDefault();
              if (abandonTyped !== name) return;
              await run('adventure.abandon', { confirm: abandonTyped });
              abandonTyped = null;
            }}
          >
            <p>{t('GARN.Canon.AbandonPrompt')} <strong>{name}</strong></p>
            <div class="row">
              <input bind:value={abandonTyped} placeholder={name} data-garn-abandon-input />
              <button type="submit" disabled={abandonTyped !== name} data-garn-abandon-confirm>
                {t('GARN.Canon.AbandonConfirm')}
              </button>
            </div>
          </form>
        {/if}
      {/if}
      <ul data-garn-adventures>
        {#each overview.adventures as adventure (adventure.id)}
          <li class:current={adventure.current} data-garn-adventure={adventure.id}>
            {adventure.name} <span class="muted">· {adventure.campaignName}</span>
          </li>
        {:else}
          <li class="muted">{t('GARN.Canon.NoAdventures')}</li>
        {/each}
      </ul>
    </section>

    <section>
      <h3>{t('GARN.Canon.History')}</h3>
      <button type="button" onclick={() => run('history.endPlaySession')} data-garn-end-session>
        {t('GARN.Commands.history.endPlaySession')}
      </button>
      <ol data-garn-history>
        {#each overview.log as commit (commit.hash)}
          <li data-garn-commit={commit.hash}>
            <span>{commit.label || t('GARN.Canon.Unlabelled')}</span>
            <span class="muted">{date(commit.date)}</span>
          </li>
        {:else}
          <li class="muted">{t('GARN.Canon.NoCommits')}</li>
        {/each}
      </ol>
    </section>

    <section>
      <h3>{t('GARN.Canon.Campaigns')}</h3>
      <ul data-garn-campaigns>
        {#each overview.campaigns as campaign (campaign.id)}
          <li class:closed={campaign.closed} data-garn-campaign={campaign.id}>
            {#if renaming?.id === campaign.id}
              <form
                class="row"
                onsubmit={(e) => {
                  e.preventDefault();
                  void rename();
                }}
              >
                <input bind:value={renaming.name} data-garn-campaign-rename-input />
                <button type="submit" data-garn-campaign-rename-confirm>OK</button>
              </form>
            {:else}
              <span>{campaign.name}</span>
              {#if campaign.closed}<span class="badge">{t('GARN.Canon.Closed')}</span>{/if}
              <button
                type="button"
                onclick={() => (renaming = { id: campaign.id, name: campaign.name })}
                data-garn-campaign-rename
              >
                {t('GARN.Commands.campaign.rename')}
              </button>
              {#if campaign.closed}
                <button
                  type="button"
                  onclick={() => run('campaign.reopen', { id: campaign.id })}
                  data-garn-campaign-reopen
                >
                  {t('GARN.Commands.campaign.reopen')}
                </button>
              {:else}
                <button
                  type="button"
                  onclick={() => run('campaign.close', { id: campaign.id })}
                  data-garn-campaign-close
                >
                  {t('GARN.Commands.campaign.close')}
                </button>
              {/if}
              <button
                type="button"
                disabled={mergeOpen}
                onclick={() =>
                  (joining =
                    joining?.sourceId === campaign.id
                      ? null
                      : { sourceId: campaign.id, targetId: '', closeSource: true })}
                data-garn-campaign-join
              >
                {t('GARN.Commands.campaign.join')}
              </button>
            {/if}
          </li>
          {#if joining?.sourceId === campaign.id}
            <li>
              <form
                class="row"
                onsubmit={(e) => {
                  e.preventDefault();
                  void join();
                }}
                data-garn-join
              >
                <!-- Closed Campaigns can't be a join target (spec §11.5). -->
                <select bind:value={joining.targetId} data-garn-join-target>
                  <option value="" disabled>{t('GARN.Canon.JoinTarget')}</option>
                  {#each openCampaigns.filter((c) => c.id !== campaign.id) as target (target.id)}
                    <option value={target.id}>{target.name}</option>
                  {/each}
                </select>
                <label>
                  <input
                    type="checkbox"
                    bind:checked={joining.closeSource}
                    data-garn-join-close-source
                  />
                  {t('GARN.Canon.CloseSource')}
                </label>
                <button type="submit" disabled={!joining.targetId} data-garn-join-confirm>
                  OK
                </button>
              </form>
            </li>
          {/if}
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
          placeholder={t('GARN.Canon.CampaignName')}
          data-garn-campaign-name
        />
        <button type="submit" disabled={!newCampaign.trim()} data-garn-campaign-create>
          {t('GARN.Commands.campaign.create')}
        </button>
      </form>
    </section>

    <section data-garn-portability>
      <h3>{t('GARN.Canon.Portability.Heading')}</h3>
      <div class="row">
        <button type="button" onclick={() => run('canon.exportBackup')} data-garn-canon-backup>
          {t('GARN.Commands.canon.exportBackup')}
        </button>
      </div>
      <div class="row">
        <label for="garn-share-from">{t('GARN.Canon.Portability.ShareCommit')}</label>
        <select id="garn-share-from" bind:value={shareFrom} data-garn-share-commit>
          <option value="">{overview.log[0]?.label || t('GARN.Canon.Unlabelled')}</option>
          {#each overview.log.slice(1) as commit (commit.hash)}
            <option value={commit.hash}>
              {commit.label || t('GARN.Canon.Unlabelled')} · {date(commit.date)}
            </option>
          {/each}
          {#each overview.adventures.filter((a) => !a.current) as adventure (adventure.id)}
            <option value={adventure.id}>
              {t('GARN.Canon.Portability.AdventureHead')}: {adventure.name}
            </option>
          {/each}
        </select>
        <button
          type="button"
          disabled={!shareCommit}
          onclick={() => run('canon.exportShare', { commit: shareCommit })}
          data-garn-canon-share
        >
          {t('GARN.Commands.canon.exportShare')}
        </button>
      </div>
      {@render importer()}
    </section>
  {/if}
</div>

{#snippet importer()}
  <label class="row">
    {t('GARN.Canon.Portability.ImportFile')}
    <input
      type="file"
      accept=".zip,application/zip"
      onchange={(e) => importFile(e.currentTarget)}
      data-garn-canon-import
    />
  </label>
{/snippet}

<style>
  .garn-canon {
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
