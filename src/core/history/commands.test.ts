import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../canon';
import { createRegistry } from '../commands/registry';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { historyCommands } from './commands';
import { createHistory } from './history';

function setup(isGM = true) {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  const history = createHistory({
    files: createMemoryFiles(),
    workingCopy,
    author: () => 'GM',
    createdWith: 'test',
  });
  const registry = createRegistry(() => ({ isGM }));
  for (const command of historyCommands(() => history)) registry.register(command);
  return { registry, workingCopy };
}

describe('history commands', () => {
  it('create, commit and discard through the registry', async () => {
    const { registry, workingCopy } = setup();
    const { canonId } = await registry.run<{ canonId: string }>('canon.create', { name: 'A' });
    await workingCopy.set([{ kind: 'element', id: 'e1', data: {} }]);
    const head = await registry.run<string>('history.commit', { label: 'x' });
    await workingCopy.delete(['e1']);
    await registry.run('history.discard');

    expect(workingCopy.binding).toEqual({ canonId, checkout: { main: true }, head });
    expect(workingCopy.get('e1')).toBeDefined();
    await expect(registry.run('canon.bind', { canonId })).rejects.toThrow(/bound/);
  });

  it('are GM-only', () => {
    const { registry } = setup(false);
    for (const name of ['canon.create', 'canon.bind', 'history.commit', 'history.discard'])
      expect(registry.isAvailable(name)).toBe(false);
  });
});
