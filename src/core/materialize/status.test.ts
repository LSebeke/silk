import { describe, expect, it } from 'vitest';
import { must, page, setup } from './test-setup';

describe('Status (spec §4, §7 Dead)', () => {
  it('a Ghost Person toggles alive → dead → alive in the record', async () => {
    const t = setup();
    const id = await t.create('person', 'Alrik');
    expect(t.element(id).status).toBeUndefined();
    await t.registry.run('element.toggleStatus', { id });
    expect(t.element(id).status).toBe('dead');
    await t.registry.run('element.toggleStatus', { id });
    expect(t.element(id).status).toBeUndefined();
  });

  it('an Event cycles planned → happened → skipped → planned; Silk keeps it, also Materialized', async () => {
    const t = setup({ mode: 'immediate' });
    const id = await t.create('event', 'Feast');
    const seen = [];
    for (let i = 0; i < 3; i++) {
      await t.registry.run('element.toggleStatus', { id });
      seen.push(t.element(id).status);
    }
    expect(seen).toEqual(['happened', 'skipped', undefined]);
    await t.registry.run('element.setStatus', { id, status: 'skipped' });
    expect(t.element(id).status).toBe('skipped');
    await t.materializer.sync(id);
    expect(t.element(id).status).toBe('skipped');
  });

  it('rejects classes without Status and unknown values', async () => {
    const t = setup();
    const note = await t.create('note', 'N');
    const person = await t.create('person', 'P');
    await expect(t.registry.run('element.toggleStatus', { id: note })).rejects.toThrow(/Status/);
    await expect(
      t.registry.run('element.setStatus', { id: person, status: 'done' }),
    ).rejects.toThrow(/Status/);
  });

  it('a Materialized Person: dead ↔ the dsa5 dead condition on the actor, both ways', async () => {
    const t = setup({ mode: 'immediate' });
    const id = await t.create('person', 'Alrik');
    const statuses = () => (t.doc(id).effects ?? []).flatMap((e) => e.statuses ?? []);
    await t.registry.run('element.toggleStatus', { id });
    expect(statuses()).toEqual(['dead']);
    expect(t.element(id).status).toBe('dead');
    await t.registry.run('element.setStatus', { id, status: 'alive' });
    expect(statuses()).toEqual([]);
    expect(t.element(id).status).toBeUndefined();

    // The GM marks the token dead in Foundry: the element follows.
    t.doc(id).effects = [{ statuses: ['prone'] }, { statuses: ['dead'] }];
    await t.materializer.sync(id);
    expect(t.element(id).status).toBe('dead');
    t.doc(id).effects = [{ statuses: ['prone'] }];
    await t.materializer.sync(id);
    expect(t.element(id).status).toBeUndefined();
  });

  it('Materializing a dead Ghost Creature adds the dead condition', async () => {
    const t = setup();
    const id = await t.create('creature', 'Wolf');
    await t.registry.run('element.setStatus', { id, status: 'dead' });
    await t.registry.run('materialize.elements', { ids: [id] });
    expect((t.doc(id).effects ?? []).flatMap((e) => e.statuses ?? [])).toEqual(['dead']);
    expect(t.element(id).status).toBe('dead');
  });

  it('a Quest: open/done/failed ↔ quest status 0/1/2, both ways', async () => {
    const t = setup();
    const id = await t.create('quest', 'The Ring');
    await t.registry.run('element.setStatus', { id, status: 'done' });
    await t.registry.run('materialize.elements', { ids: [id] });
    const quest = () => {
      const q = t.doc(id);
      const system = page(q, q.flags.silk.quest).system as {
        quests: Record<string, { status: number }>;
      };
      return must(system.quests[q.flags.silk.questKey]);
    };
    expect(quest().status).toBe(1);
    expect(t.element(id).status).toBe('done');
    await t.registry.run('element.toggleStatus', { id });
    expect(quest().status).toBe(2);
    expect(t.element(id).status).toBe('failed');

    quest().status = 0; // Edited in the DSA5 quest log.
    await t.materializer.sync(id);
    expect(t.element(id).status).toBeUndefined();
  });

  it('Materializing a Quest registers its journal in the DSA5 quest log and warns about native fields', async () => {
    const t = setup({ mode: 'immediate' });
    const id = await t.create('quest', 'The Ring');
    expect(t.docs.questJournals).toEqual([{ uuid: t.doc(id).uuid, name: 'The Ring' }]);
    expect(t.toasts).toContain('QuestNativeFields');
  });

  it('a class change keeps a Status the new class has and drops one it lacks', async () => {
    const t = setup();
    const person = await t.create('person', 'P');
    const event = await t.create('event', 'E');
    await t.registry.run('element.setStatus', { id: person, status: 'dead' });
    await t.registry.run('element.setStatus', { id: event, status: 'happened' });
    await t.registry.run('element.changeClass', { id: person, class: 'creature' });
    await t.registry.run('element.changeClass', { id: event, class: 'quest' });
    expect(t.element(person).status).toBe('dead');
    expect(t.element(event).status).toBeUndefined();
  });
});
