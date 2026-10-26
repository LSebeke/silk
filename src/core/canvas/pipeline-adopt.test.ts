import { describe, expect, it } from 'vitest';
import { createCreationPipeline } from './pipeline';

/** The pipeline over a stub `adopt.doc` (spec §6: every Adopt ends in the Creation Pipeline). */
function setup(result: object | null = { id: 'el1', name: 'Gareth' }) {
  const calls: [string, object][] = [];
  const completed: string[] = [];
  const pipeline = createCreationPipeline({
    run: async (name, args) => {
      calls.push([name, args]);
      return name === 'adopt.doc' ? result : undefined;
    },
    label: (id) => id,
  });
  pipeline.onComplete(({ id }) => completed.push(id));
  return { pipeline, calls, completed };
}

describe('Creation Pipeline for Adopt (spec §6 Ways in)', () => {
  it('class box offers only the adoptable classes, pre-selected first', () => {
    const { pipeline } = setup();
    pipeline.open({
      at: { x: 1, y: 2 },
      adopt: { uuid: 'JournalEntry.j', classes: ['note', 'location'] },
    });
    expect(pipeline.options().map((c) => c.id)).toEqual(['note', 'location']);
  });

  it('picking a class adopts the doc, then the name step is pre-filled with its name', async () => {
    const { pipeline, calls, completed } = setup();
    pipeline.open({
      at: { x: 1, y: 2 },
      adopt: { uuid: 'JournalEntry.j', classes: ['note', 'location'], connectTo: 'n1' },
    });
    await pipeline.pickClass('location');
    expect(calls).toEqual([
      [
        'adopt.doc',
        { uuid: 'JournalEntry.j', class: 'location', at: { x: 1, y: 2 }, connectTo: 'n1' },
      ],
    ]);
    expect(pipeline.get()).toEqual({ step: 'name', id: 'el1' });
    await pipeline.submitName('Gareth');
    expect(calls).toHaveLength(1); // unchanged name: no rename
    expect(completed).toEqual(['el1']);
  });

  it('a Player Character can be adopted (never created)', async () => {
    const { pipeline, calls } = setup({ id: 'pc', name: 'Rondra' });
    await pipeline.create(
      { at: { x: 0, y: 0 }, adopt: { uuid: 'Actor.a', classes: ['playerCharacter'] } },
      'playerCharacter',
    );
    expect(calls[0]?.[0]).toBe('adopt.doc');
    expect(pipeline.get()).toEqual({ step: 'name', id: 'pc' });
  });

  it('a drop onto a Node continues with the Connection editor', async () => {
    const { pipeline } = setup({ id: 'el1', name: 'Ring', connectionId: 'c1' });
    await pipeline.create(
      { at: { x: 0, y: 0 }, adopt: { uuid: 'Item.i', classes: ['item'], connectTo: 'n1' } },
      'item',
    );
    await pipeline.submitName('');
    expect(pipeline.get()).toEqual({ step: 'connection', id: 'c1', elementId: 'el1' });
  });

  it('an existing Story Element or a cancelled prompt ends the pipeline', async () => {
    for (const result of [{ id: 'el1', name: 'X', existing: true }, null]) {
      const { pipeline } = setup(result);
      await pipeline.create(
        { at: { x: 0, y: 0 }, adopt: { uuid: 'Actor.a', classes: ['person'] } },
        'person',
      );
      expect(pipeline.get()).toEqual({ step: 'idle' });
    }
  });
});
