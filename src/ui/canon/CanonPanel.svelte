<script lang="ts">
  import type { CanonOverview } from '../../core/campaigns';

  let {
    overview,
    run,
    t,
  }: {
    overview: CanonOverview;
    run: (name: string, args?: object) => Promise<void>;
    t: (key: string) => string;
  } = $props();

  let canonName = $state('');
  let adventureName = $state('');
  let campaignId = $state('');
  let newCampaign = $state('');
  let renaming = $state<{ id: string; name: string } | null>(null);

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
  {/if}
</div>

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
  .badge {
    font-size: 0.8em;
    padding: 0 0.4em;
    border: 1px solid currentColor;
    border-radius: 0.6em;
  }
</style>
