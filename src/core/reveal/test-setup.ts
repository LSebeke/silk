/** Reveal unit-test wiring: the materialize setup plus Campaign maps and the Reveal service. */
import { dsa5Mapping } from '../../adapter/dsa5';
import { emptyRevelationMap, type RevelationMap } from '../campaigns';
import { setup as materializeSetup } from '../materialize/test-setup';
import { createReveal, revealCommands, type RevealStage } from './reveal';

export const HOOD = 'modules/silk/assets/hooded.svg';

export function setup(opts: { adventure?: boolean } = {}) {
  const hooks: ((id: string) => Promise<void>)[] = [];
  const t = materializeSetup({ connections: true, afterMaterialize: hooks });
  const maps = new Map<string, RevelationMap>();
  let campaign: string | null = opts.adventure === false ? null : 'camp1';
  let world: RevelationMap = emptyRevelationMap();
  const tokens: { actor: string; data: Record<string, unknown> }[] = [];
  const shown: { uuid?: string; image?: string; title?: string }[] = [];
  const pageRefreshes: string[][] = [];
  const stage: RevealStage = {
    async updateTokens(actor, data) {
      tokens.push({ actor, data });
    },
    async show(target) {
      shown.push(target);
    },
  };
  const reveal = createReveal({
    workingCopy: () => t.workingCopy,
    docs: t.docs,
    materializer: t.materializer,
    system: dsa5Mapping,
    campaign: {
      current: async () => campaign,
      read: async (id) => maps.get(id) ?? emptyRevelationMap(),
      write: async (id, map) => void maps.set(id, map),
    },
    world: { get: () => world, set: async (map) => void (world = map) },
    adventure: () => campaign !== null,
    hood: () => HOOD,
    stage,
    localize: (key) => key.split('.').pop() ?? key,
    refreshPages: async (ids) => void pageRefreshes.push([...ids]),
  });
  reveal.reload();
  hooks.push((id) => reveal.afterMaterialize(id));
  t.lifecycle.contribute({ reconcile: () => reveal.reconcile() });
  for (const command of revealCommands(reveal)) t.registry.register(command);
  const map = () => maps.get('camp1') ?? emptyRevelationMap();
  const run = (name: string, args: object) => t.registry.run(name, args);
  const level = (o: { ownership?: { default: number } } | undefined) => o?.ownership?.default;
  return {
    ...t,
    reveal,
    maps,
    map,
    world: () => world,
    setWorld: (m: RevelationMap) => (world = m),
    setCampaign: (id: string | null) => (campaign = id),
    tokens,
    shown,
    pageRefreshes,
    run,
    level,
    connect: async (from: string, to: string, label = 'knows') =>
      (await t.registry.run<{ id: string }>('connection.create', { from, to, label })).id,
  };
}
