import { describe, expect, it } from 'vitest';
import { addGarnSceneControl, type SceneControls } from './scene-controls';

const controls = (): SceneControls => ({
  notes: { tools: { select: { name: 'select', order: 0 } } },
});

describe('Garn scene-control button', () => {
  it('adds a button to the notes controls that opens the World Canvas', () => {
    const runs: string[] = [];
    const c = controls();
    addGarnSceneControl(c, { run: async (name) => void runs.push(name) });

    const tool = c.notes?.tools?.['garn'];
    expect(tool).toMatchObject({ name: 'garn', button: true, visible: true, order: 1 });
    tool?.onChange?.(new Event('click'), true);
    expect(runs).toEqual(['canvas.open']);
  });

  it('is the same button for players: it runs canvas.open, which routes to the Player Canvas (§9)', () => {
    const runs: string[] = [];
    const c = controls();
    addGarnSceneControl(c, { run: async (name) => void runs.push(name) });
    const tool = c.notes?.tools?.['garn'];
    expect(tool?.visible).toBe(true);
    tool?.onChange?.(new Event('click'), true);
    expect(runs).toEqual(['canvas.open']);
  });
});
