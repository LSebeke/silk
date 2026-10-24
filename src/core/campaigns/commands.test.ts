import { describe, expect, it } from 'vitest';
import { createMemoryFiles, type Campaign } from '../canon';
import { createRegistry } from '../commands/registry';
import { createHistory } from '../history';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { createCampaigns } from './campaigns';
import { campaignCommands } from './commands';

async function setup(isGM = true) {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  const history = createHistory({
    files: createMemoryFiles(),
    workingCopy,
    author: () => 'GM',
    createdWith: 'test',
  });
  const campaigns = createCampaigns({ history, workingCopy, applyRevelationMap: async () => {} });
  const registry = createRegistry(() => ({ isGM }));
  for (const command of campaignCommands(() => campaigns)) registry.register(command);
  await history.createCanon({ name: 'A' });
  await workingCopy.set([{ kind: 'element', id: 'e1', data: {} }]);
  await history.commit({});
  return { registry, campaigns, workingCopy };
}

describe('campaign and adventure commands', () => {
  it('create, rename, close, reopen and start an Adventure through the registry', async () => {
    const { registry, campaigns, workingCopy } = await setup();
    const { id } = await registry.run<Campaign>('campaign.create', { name: 'C' });
    await registry.run('campaign.rename', { id, name: 'D' });
    await registry.run('campaign.close', { id });
    await registry.run('campaign.reopen', { id });
    expect(await campaigns.list()).toMatchObject([{ id, name: 'D', closed: false }]);

    const { adventureId } = await registry.run<{ adventureId: string }>('adventure.start', {
      name: 'Adv',
      campaignId: id,
    });
    expect(workingCopy.binding?.checkout).toEqual({ adventure: adventureId });
  });

  it('are GM-only', async () => {
    const { registry } = await setup(false);
    for (const name of [
      'campaign.create',
      'campaign.rename',
      'campaign.close',
      'campaign.reopen',
      'adventure.start',
    ])
      expect(registry.isAvailable(name)).toBe(false);
  });
});
