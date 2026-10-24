/**
 * Campaigns, their Revelation Maps, and starting Adventures (spec §3, §11.3, §11.5).
 * Pure core over the World's history and working copy. What a Revelation Map does to
 * Foundry ownership is injected (`applyRevelationMap`, filled in by Reveal).
 */
import { newCanonId, type Campaign } from '../canon';
import type { History } from '../history';
import type { WorkingCopy } from '../working-copy';
import { parseRevelationMap, serializeRevelationMap, type RevelationMap } from './revelation-map';

export interface CampaignsDeps {
  history: History;
  workingCopy: WorkingCopy;
  /** Make World ownership match `map` (spec §8 "Truth"). Called on checkout of an Adventure. */
  applyRevelationMap(map: RevelationMap, campaignId: string): Promise<void>;
  /** ISO 8601; default now. */
  now?(): string;
  /** Id for new Campaigns and Adventures; default a random 128-bit hex id. */
  newId?(): string;
}

/** What the Canon window shows. */
export interface CanonOverview {
  canon: { id: string; name: string; readOnly: boolean } | null;
  checkout:
    | { kind: 'main' }
    | { kind: 'adventure'; id: string; name: string; campaignId: string; campaignName: string }
    | null;
  /** Uncommitted changes in this World. */
  dirty: boolean;
  adventures: {
    id: string;
    name: string;
    campaignId: string;
    campaignName: string;
    current: boolean;
  }[];
  campaigns: Campaign[];
  /** Commit history of the Checkout, newest first. */
  log: { hash: string; label: string; date: string }[];
}

export interface Campaigns {
  /** `campaign.create` */
  create(args: { name: string }): Promise<Campaign>;
  /** `campaign.rename` */
  rename(args: { id: string; name: string }): Promise<void>;
  /** `campaign.close` */
  close(args: { id: string }): Promise<void>;
  /** `campaign.reopen` */
  reopen(args: { id: string }): Promise<void>;
  /** Sorted by creation. */
  list(): Promise<Campaign[]>;
  readRevelationMap(campaignId: string): Promise<RevelationMap>;
  /** Overwrite the map. Refused for a closed Campaign unless it is the one checked out. */
  writeRevelationMap(campaignId: string, map: RevelationMap): Promise<void>;
  /** The Campaign of the checked-out Adventure; `null` under main or unbound. */
  checkedOutCampaign(): Promise<Campaign | null>;
  /** `adventure.start`: branch from clean main's head and check the Adventure out. */
  startAdventure(args: { name: string; campaignId: string }): Promise<{ adventureId: string }>;
  overview(): Promise<CanonOverview>;
}

export function createCampaigns(deps: CampaignsDeps): Campaigns {
  const { history, workingCopy } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? newCanonId;

  const UNBOUND = 'Silk: this World is not bound to a Canon yet';

  async function requireCanon() {
    const canon = await history.canon();
    if (!canon) throw new Error(UNBOUND);
    return canon;
  }

  function requireBinding() {
    const binding = workingCopy.binding;
    if (!binding) throw new Error(UNBOUND);
    return binding;
  }

  async function requireCampaign(id: string): Promise<Campaign> {
    const campaign = await (await requireCanon()).getCampaign(id);
    if (!campaign) throw new Error(`Silk: no Campaign "${id}" in this Canon`);
    return campaign;
  }

  function requireName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Silk: a name is required');
    return trimmed;
  }

  async function update(id: string, change: Partial<Campaign>) {
    const campaign = await requireCampaign(id);
    await (await requireCanon()).writeCampaign({ ...campaign, ...change });
  }

  async function checkedOutAdventure() {
    const checkout = workingCopy.binding?.checkout;
    if (!checkout || !('adventure' in checkout)) return null;
    return (await requireCanon()).getAdventure(checkout.adventure);
  }

  const campaigns: Campaigns = {
    async create({ name }) {
      const canon = await requireCanon();
      const campaign: Campaign = {
        id: newId(),
        name: requireName(name),
        closed: false,
        createdAt: now(),
      };
      await canon.writeCampaign(campaign);
      return campaign;
    },

    rename: ({ id, name }) => update(id, { name: requireName(name) }),
    close: ({ id }) => update(id, { closed: true }),
    reopen: ({ id }) => update(id, { closed: false }),

    async list() {
      const all = await (await requireCanon()).listCampaigns();
      return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    },

    async readRevelationMap(campaignId) {
      await requireCampaign(campaignId);
      return parseRevelationMap(await (await requireCanon()).readRevelationMap(campaignId));
    },

    async writeRevelationMap(campaignId, map) {
      const campaign = await requireCampaign(campaignId);
      if (campaign.closed && (await checkedOutAdventure())?.campaignId !== campaignId)
        throw new Error(`Silk: Campaign "${campaign.name}" is closed; its map is read-only`);
      await (await requireCanon()).writeRevelationMap(campaignId, serializeRevelationMap(map));
    },

    async checkedOutCampaign() {
      const adventure = await checkedOutAdventure();
      return adventure ? requireCampaign(adventure.campaignId) : null;
    },

    async startAdventure({ name, campaignId }) {
      const canon = await requireCanon();
      const binding = requireBinding();
      if (!('main' in binding.checkout))
        throw new Error('Silk: Adventures start only from main; end the running Adventure first');
      const advName = requireName(name);
      const campaign = await requireCampaign(campaignId);
      if (campaign.closed)
        throw new Error(`Silk: Campaign "${campaign.name}" is closed; reopen it first`);
      if (!binding.head) throw new Error('Silk: make a first Commit on main before an Adventure');
      if ((await canon.getMain()) !== binding.head)
        throw new Error('Silk: main moved on in another World; reload to update first');
      if (await history.isDirty())
        throw new Error('Silk: commit or discard uncommitted changes before an Adventure');

      const adventureId = newId();
      await canon.writeAdventure({
        id: adventureId,
        name: advName,
        campaignId,
        base: binding.head,
        head: binding.head,
      });
      await workingCopy.setBinding({ ...binding, checkout: { adventure: adventureId } });
      await deps.applyRevelationMap(await campaigns.readRevelationMap(campaignId), campaignId);
      return { adventureId };
    },

    async overview() {
      const canon = await history.canon();
      if (!canon)
        return {
          canon: null,
          checkout: null,
          dirty: false,
          adventures: [],
          campaigns: [],
          log: [],
        };
      const [all, refs, dirty, log] = await Promise.all([
        campaigns.list(),
        canon.listAdventures(),
        history.isDirty(),
        history.log(),
      ]);
      const campaignName = (id: string) => all.find((c) => c.id === id)?.name ?? id;
      const checkout = requireBinding().checkout;
      const currentId = 'adventure' in checkout ? checkout.adventure : null;
      const adventures = refs.map((r) => ({
        id: r.id,
        name: r.name,
        campaignId: r.campaignId,
        campaignName: campaignName(r.campaignId),
        current: r.id === currentId,
      }));
      const current = adventures.find((a) => a.current);
      return {
        canon: { id: canon.manifest.id, name: canon.manifest.name, readOnly: canon.readOnly },
        checkout: current
          ? {
              kind: 'adventure',
              id: current.id,
              name: current.name,
              campaignId: current.campaignId,
              campaignName: current.campaignName,
            }
          : { kind: 'main' },
        dirty,
        adventures,
        campaigns: all,
        log: log.map(({ hash, label, date }) => ({ hash, label, date })),
      };
    },
  };
  return campaigns;
}
