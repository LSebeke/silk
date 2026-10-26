import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/commands/registry';
import { canvasUiCommands } from './commands';

describe('canvas.open for players (spec §9 Entry)', () => {
  it('is available to players and opens the Player Canvas without the GM canvas context', async () => {
    const opened: string[] = [];
    const registry = createRegistry(() => ({ isGM: false }));
    for (const command of canvasUiCommands(
      () => {
        throw new Error('players never get the GM canvas context (working copy)');
      },
      { isGM: () => false, open: async () => void opened.push('player') },
    ))
      registry.register(command);

    expect(registry.isAvailable('canvas.open')).toBe(true);
    await registry.run('canvas.open');
    expect(opened).toEqual(['player']);
  });
});
