import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../canon';
import { createCampaigns } from '../campaigns';
import { createRegistry } from '../commands/registry';
import { createHistory } from '../history';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { mergeCommands, type MergeUi } from './commands';
import { createMerges } from './merges';

async function setup(isGM = true) {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  const history = createHistory({
    files: createMemoryFiles(),
    workingCopy,
    author: () => 'GM',
    createdWith: 'test',
  });
  const campaigns = createCampaigns({ history, workingCopy, applyRevelationMap: async () => {} });
  const merges = createMerges({
    history,
    workingCopy,
    campaigns,
    author: () => 'GM',
    applyResult: (result) => workingCopy.replaceAll(result),
  });
  const calls: string[] = [];
  let answer = true;
  const ui: MergeUi = {
    open: async () => void calls.push('open'),
    close: async () => void calls.push('close'),
    confirmNoUndo: async () => {
      calls.push('ask');
      return answer;
    },
    focus: async (ref) => void calls.push(`focus ${ref.recordId}`),
  };
  const registry = createRegistry(() => ({ isGM }));
  for (const command of mergeCommands(() => merges, ui)) registry.register(command);
  await history.createCanon({ name: 'A' });
  await workingCopy.set([{ kind: 'element', id: 'e1', data: { name: 'A' } }]);
  await history.commit({});
  const { id } = await campaigns.create({ name: 'C' });
  await campaigns.startAdventure({ name: 'Adv', campaignId: id });
  return { registry, workingCopy, calls, setAnswer: (a: boolean) => (answer = a) };
}

describe('merge commands (spec §15)', () => {
  it('adventure.end opens the merge window; confirm asks first (no undo)', async () => {
    const t = await setup();
    await t.workingCopy.set([{ kind: 'element', id: 'e1', data: { name: 'B' } }]);
    await t.registry.run('adventure.end');
    expect(t.calls).toEqual(['open']);

    await t.registry.run('merge.pick', { recordId: 'e1', field: '/name', side: 'base' });
    expect(await t.registry.run('merge.nextConflict')).toBeNull();

    t.setAnswer(false);
    expect(await t.registry.run('merge.confirm')).toEqual({ confirmed: false });
    expect(t.workingCopy.binding?.checkout).not.toEqual({ main: true });

    t.setAnswer(true);
    const result = await t.registry.run<{ confirmed: boolean; commit: string }>('merge.confirm');
    expect(result.confirmed).toBe(true);
    expect(t.workingCopy.binding).toMatchObject({ checkout: { main: true }, head: result.commit });
    expect(t.workingCopy.get('e1')?.data.name).toBe('A');
    expect(t.calls).toEqual(['open', 'ask', 'ask', 'close']);
  });

  it('merge.nextConflict focuses the conflict in the window', async () => {
    const t = await setup();
    await t.registry.run('adventure.end');
    expect(await t.registry.run('merge.nextConflict')).toBeNull();
    expect(t.calls).toEqual(['open']);
  });

  it('merge.confirm with `confirmed` skips the dialog; merge.cancel closes the window', async () => {
    const t = await setup();
    await t.registry.run('adventure.end');
    await t.registry.run('merge.cancel');
    expect(t.calls).toEqual(['open', 'close']);
    await t.registry.run('adventure.end');
    await t.registry.run('merge.confirm', { confirmed: true });
    expect(t.calls).not.toContain('ask');
  });

  it('are GM-only', async () => {
    const t = await setup(false);
    for (const name of [
      'adventure.end',
      'merge.nextConflict',
      'merge.pick',
      'merge.confirm',
      'merge.cancel',
    ])
      expect(t.registry.isAvailable(name)).toBe(false);
  });
});
