import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createRegistry } from './registry';

const ctx = { isGM: true };

describe('command registry', () => {
  it('runs a registered command with its args object', async () => {
    const registry = createRegistry(() => ctx);
    registry.register({
      name: 'element.rename',
      title: 'Rename',
      available: () => true,
      run: async (args: { id: string; name: string }) => `${args.id}=${args.name}`,
    });

    await expect(registry.run('element.rename', { id: 'e1', name: 'Gareth' })).resolves.toBe(
      'e1=Gareth',
    );
  });

  it('refuses to run a command that is not available in the current context', async () => {
    let isGM = false;
    let ran = false;
    const registry = createRegistry(() => ({ isGM }));
    registry.register({
      name: 'canvas.open',
      title: 'Open',
      available: (c) => c.isGM,
      run: async () => {
        ran = true;
      },
    });

    await expect(registry.run('canvas.open')).rejects.toThrow(/not available/);
    expect(ran).toBe(false);
    isGM = true;
    await registry.run('canvas.open');
    expect(ran).toBe(true);
  });

  it('rejects unknown commands', async () => {
    await expect(createRegistry(() => ctx).run('nope.nothing')).rejects.toThrow(/unknown/);
  });

  it('accepts dot-namespaced area.verb names and rejects anything else', () => {
    const registry = createRegistry(() => ctx);
    const noop = { title: 't', available: () => true, run: async () => undefined };
    for (const name of [
      'canvas.open',
      'element.setImage',
      'dev.fixture.generate',
      'infoBlock.create',
    ])
      expect(() => registry.register({ ...noop, name })).not.toThrow();
    for (const name of [
      'open',
      'canvas.',
      '.open',
      'Canvas.open',
      'canvas open',
      'canvas..open',
      '',
    ])
      expect(() => registry.register({ ...noop, name }), name).toThrow(/name/);
  });

  it('refuses to register the same name twice', () => {
    const registry = createRegistry(() => ctx);
    const cmd = { name: 'canvas.open', title: 't', available: () => true, run: async () => 1 };
    registry.register(cmd);
    expect(() => registry.register({ ...cmd, run: async () => 2 })).toThrow(/already/);
  });

  it('lists every registered command exactly once, in registration order', () => {
    fc.assert(
      fc.property(fc.uniqueArray(commandName, { maxLength: 20 }), (names) => {
        const registry = createRegistry(() => ctx);
        for (const name of names)
          registry.register({ name, title: name, available: () => true, run: async () => name });
        expect(registry.list().map((c) => c.name)).toEqual(names);
      }),
    );
  });
});

const segment = fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,8}$/);
const commandName = fc
  .array(segment, { minLength: 2, maxLength: 3 })
  .map((parts) => parts.join('.'));
