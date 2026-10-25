/**
 * DSA5 field mapping (spec §2: hand-written types for the adapter's fields only).
 * Verified against dsa5 8.1.10 (`modules/data/actor/*`, `modules/data/journal/dsaquestlog.js`).
 * Pure, so the core can be tested with it.
 */
import type { SystemMapping } from '../core/materialize/port';
import type { ElementClassId } from '../core/elements';

export type Dsa5ActorType = 'character' | 'npc' | 'creature' | 'group' | 'vehicle';

/** `DSA5.merchantTypes`. */
export type Dsa5MerchantType = 'none' | 'merchant' | 'loot' | 'epic';

/** The slice of actor `system` Silk reads/writes. */
export interface Dsa5ActorSystem {
  merchant?: { merchantType?: Dsa5MerchantType };
}

/** Quest status 0 open / 1 done / 2 failed; audience 0 Party / 1 players / 2 GM. */
export interface Dsa5Quest {
  title: string;
  status: 0 | 1 | 2;
  audience: 0 | 1 | 2;
  visible: boolean;
  linkedPages?: Record<string, { uuid: string; visible: boolean; sort?: number }>;
}

/** `dsaquestlog` page system data: a TypedObject of quests (Silk uses one per page). */
export interface Dsa5QuestlogSystem {
  quests: Record<string, Dsa5Quest>;
}

const questStatus = (status: number): Dsa5Quest['status'] =>
  status === 1 || status === 2 ? status : 0;

const DOC_TYPES: Partial<Record<ElementClassId, string>> = {
  person: 'npc' satisfies Dsa5ActorType,
  creature: 'creature' satisfies Dsa5ActorType,
  playerCharacter: 'character' satisfies Dsa5ActorType,
  item: 'equipment',
};

const MERCHANT_TYPES: readonly unknown[] = ['none', 'merchant', 'loot', 'epic'];
const isMerchantType = (value: unknown): value is Dsa5MerchantType =>
  MERCHANT_TYPES.includes(value);

export const dsa5Mapping: SystemMapping = {
  docType: (cls) => DOC_TYPES[cls],
  toSystem(cls, fields) {
    const merchantType = fields['merchantType'];
    if (cls === 'person' && isMerchantType(merchantType))
      return { merchant: { merchantType } } satisfies Dsa5ActorSystem;
    return {};
  },
  systemUpdate(cls, fields) {
    if (cls === 'person' && 'merchantType' in fields)
      return { 'system.merchant.merchantType': fields['merchantType'] };
    return {};
  },
  fromSystem(cls, system) {
    if (cls !== 'person') return {};
    const merchantType = (system as Dsa5ActorSystem | undefined)?.merchant?.merchantType;
    return isMerchantType(merchantType) ? { merchantType } : {};
  },
  questPage(questKey, title, status = 0) {
    const system: Dsa5QuestlogSystem = {
      quests: { [questKey]: { title, status: questStatus(status), audience: 0, visible: false } },
    };
    return { type: 'dsaquestlog', system };
  },
  questStatus(questKey, pageSystem) {
    const status = (pageSystem as Dsa5QuestlogSystem | undefined)?.quests?.[questKey]?.status;
    return typeof status === 'number' ? status : undefined;
  },
  questStatusUpdate: (questKey, status) => ({
    [`system.quests.${questKey}.status`]: questStatus(status),
  }),
  /** First of `DSA5.statusEffects`; set via `actor.addCondition('dead')` (§7 Dead). */
  deadEffect: 'dead',
  questTitleUpdate: (questKey, title) => ({ [`system.quests.${questKey}.title`]: title }),
  questVisibility(questKey, pageSystem, visible, blocks) {
    const quest = (pageSystem as Dsa5QuestlogSystem | undefined)?.quests?.[questKey];
    const at = `system.quests.${questKey}`;
    const out: Record<string, unknown> = {};
    if (quest?.visible !== visible) out[`${at}.visible`] = visible;
    const linked = quest?.linkedPages ?? {};
    for (const b of blocks) {
      const have = linked[b.id];
      if (have?.uuid !== b.uuid || have.visible !== b.visible || have.sort !== b.sort)
        out[`${at}.linkedPages.${b.id}`] = { uuid: b.uuid, visible: b.visible, sort: b.sort };
    }
    for (const key of Object.keys(linked))
      if (!blocks.some((b) => b.id === key)) out[`${at}.linkedPages.-=${key}`] = null;
    return out;
  },
};
