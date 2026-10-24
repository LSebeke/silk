import { describe, expect, it } from 'vitest';
import { createRegistry } from '../commands/registry';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { elementCommands } from './commands';

function setup(isGM = true) {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  let n = 0;
  const registry = createRegistry(() => ({ isGM }));
  for (const command of elementCommands({
    workingCopy: () => workingCopy,
    newId: () => `el-${++n}`,
  }))
    registry.register(command);
  return { registry, workingCopy };
}

describe('element commands', () => {
  it('element.create stores a Ghost element record at the given spot', async () => {
    const { registry, workingCopy } = setup();
    const { id } = await registry.run<{ id: string }>('element.create', {
      class: 'location',
      name: 'Gareth',
      at: { x: 120, y: -40 },
    });
    expect(id).toBe('el-1');
    expect(workingCopy.get(id)).toEqual({
      kind: 'element',
      id: 'el-1',
      data: { class: 'location', name: 'Gareth', position: { x: 120, y: -40 } },
    });
  });

  it('element.create places the element at the origin without a spot', async () => {
    const { registry, workingCopy } = setup();
    const { id } = await registry.run<{ id: string }>('element.create', {
      class: 'note',
      name: 'Rumour',
    });
    expect(workingCopy.get(id)?.data['position']).toEqual({ x: 0, y: 0 });
  });

  it('element.create refuses unknown classes and Player Characters (Adopt only)', async () => {
    const { registry, workingCopy } = setup();
    await expect(registry.run('element.create', { class: 'dragon', name: 'x' })).rejects.toThrow(
      /class/,
    );
    await expect(
      registry.run('element.create', { class: 'playerCharacter', name: 'x' }),
    ).rejects.toThrow(/Adopt/);
    expect(workingCopy.records().size).toBe(0);
  });

  it('element.rename changes only the name', async () => {
    const { registry, workingCopy } = setup();
    const { id } = await registry.run<{ id: string }>('element.create', {
      class: 'person',
      name: 'Person',
      at: { x: 1, y: 2 },
    });
    await registry.run('element.rename', { id, name: '  Alrik ' });
    expect(workingCopy.get(id)?.data).toEqual({
      class: 'person',
      name: 'Alrik',
      position: { x: 1, y: 2 },
    });
    await expect(registry.run('element.rename', { id: 'nope', name: 'x' })).rejects.toThrow(/nope/);
  });

  it('are GM-only', () => {
    const { registry } = setup(false);
    for (const name of ['element.create', 'element.rename'])
      expect(registry.isAvailable(name)).toBe(false);
  });
});
