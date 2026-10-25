import { describe, expect, it } from 'vitest';
import { createRegistry } from '../commands/registry';
import { elementRecord } from '../elements';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { devCoreCommands } from './commands';
import { generateFixture } from './fixture';

function setup(isGM = true) {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  const registry = createRegistry(() => ({ isGM }));
  for (const c of devCoreCommands({ workingCopy: () => workingCopy })) registry.register(c);
  return { registry, workingCopy };
}

describe('dev.fixture.generate', () => {
  it('replaces the working copy with the seeded fixture', async () => {
    const { registry, workingCopy } = setup();
    await workingCopy.set([
      elementRecord('old', { class: 'note', name: 'old', position: { x: 0, y: 0 } }),
    ]);
    const result = await registry.run('dev.fixture.generate', { count: 100, seed: 3 });
    const expected = generateFixture({ count: 100, seed: 3 });
    expect([...workingCopy.records().values()]).toEqual(expected);
    expect(result).toEqual({
      elements: 100,
      connections: expected.filter((r) => r.kind === 'connection').length,
    });
  });

  it('is GM only', () => {
    expect(setup(false).registry.isAvailable('dev.fixture.generate')).toBe(false);
  });
});
