import { describe, expect, it } from 'vitest';
import { elementRecord } from '../elements';
import { appearanceMigration } from './appearance-migration';
import { page, setup, type TestElement } from './test-setup';

/** A Silk 1.0 element: its Appearance block carries no flag. */
async function unflag(t: ReturnType<typeof setup>, id: string) {
  const el = t.element(id);
  if (el.uuid) {
    for (const p of t.companion(id).pages) delete p.flags?.silk?.appearance;
    await t.materializer.sync(id);
  } else {
    const infoBlocks = el.infoBlocks.map((b) => ({ _id: b._id, name: b.name, text: b.text }));
    await t.workingCopy.set([elementRecord(id, { ...el, infoBlocks })]);
  }
  expect(t.element(id).infoBlocks.some((b) => b.appearance)).toBe(false);
}
const flagged = (el: TestElement) => el.infoBlocks.filter((b) => b.appearance).map((b) => b.name);

describe('Appearance migration on load (v1.1 §C.3)', () => {
  it('a Ghost Person: the block named "Appearance" gets the flag', async () => {
    const t = setup();
    const id = await t.create('person', 'Alrik');
    await unflag(t, id);
    await t.lifecycle.reconcile();
    expect(flagged(t.element(id))).toEqual(['Appearance']);
  });

  it('a Materialized Creature: the page gets the flag, the record mirrors it', async () => {
    const t = setup();
    const id = await t.create('creature', 'Wolf');
    await t.registry.run('materialize.elements', { ids: [id] });
    await unflag(t, id);
    await t.lifecycle.reconcile();
    expect(flagged(t.element(id))).toEqual(['Appearance']);
    const block = t.element(id).infoBlocks.find((b) => b.appearance);
    expect(page(t.companion(id), block?._id ?? '').flags?.silk?.appearance).toBe(true);
  });

  it('other classes and other names are left alone', async () => {
    const t = setup();
    const place = await t.create('location', 'Gareth');
    await t.registry.run('infoBlock.create', { elementId: place, name: 'Appearance' });
    const wolf = await t.create('creature', 'Wolf');
    await unflag(t, wolf);
    await t.registry.run('infoBlock.edit', {
      id: t.element(wolf).infoBlocks[0]?._id,
      name: 'Looks',
    });
    await t.lifecycle.reconcile();
    expect(flagged(t.element(place))).toEqual([]);
    expect(flagged(t.element(wolf))).toEqual([]);
  });

  it('runs once per element: a later block named "Appearance" stays a plain block', async () => {
    const t = setup();
    const id = await t.create('person', 'Alrik');
    await t.lifecycle.reconcile();
    const appearance = t.element(id).infoBlocks.find((b) => b.appearance)?._id;
    await t.registry.run('infoBlock.delete', { id: appearance });
    await t.registry.run('infoBlock.create', { elementId: id, name: 'Appearance' });
    await t.lifecycle.reconcile();
    expect(flagged(t.element(id))).toEqual([]);
  });

  it('a Materialized element whose journal is missing stays pending; the next load migrates it', async () => {
    const t = setup();
    const id = await t.create('creature', 'Wolf');
    await t.registry.run('materialize.elements', { ids: [id] });
    await unflag(t, id);
    // A load where the doc is not found (yet): nothing can be written.
    const blind = appearanceMigration({
      workingCopy: () => t.workingCopy,
      docs: t.docs,
      materializer: { docsOf: () => undefined, sync: (x) => t.materializer.sync(x) },
      localize: (key) => key.split('.').pop() ?? key,
    });
    await blind.reconcile?.();
    expect(flagged(t.element(id))).toEqual([]);
    await t.lifecycle.reconcile();
    expect(flagged(t.element(id))).toEqual(['Appearance']);
  });
});
