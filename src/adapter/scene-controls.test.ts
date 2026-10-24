import { describe, expect, it } from 'vitest';
import { addSilkSceneControl, type SceneControls } from './scene-controls';

const controls = (): SceneControls => ({
  notes: { tools: { select: { name: 'select', order: 0 } } },
});

describe('Silk scene-control button', () => {
  it('adds a GM-only button to the notes controls that opens the World Canvas', () => {
    const runs: string[] = [];
    const c = controls();
    addSilkSceneControl(c, { isGM: true, run: async (name) => void runs.push(name) });

    const tool = c.notes?.tools?.['silk'];
    expect(tool).toMatchObject({ name: 'silk', button: true, visible: true, order: 1 });
    tool?.onChange?.(new Event('click'), true);
    expect(runs).toEqual(['canvas.open']);
  });

  it('is hidden from players', () => {
    const c = controls();
    addSilkSceneControl(c, { isGM: false, run: async () => undefined });
    expect(c.notes?.tools?.['silk']?.visible).toBe(false);
  });
});
