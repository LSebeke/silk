import { describe, expect, it } from 'vitest';
import { dsa5Mapping } from '../../adapter/dsa5';
import { createMaterializer } from './materializer';
import { setup } from './test-setup';

describe('Materialize triggers (spec §6)', () => {
  it('immediate mode: element.create Materializes', async () => {
    const t = setup({ mode: 'immediate' });
    const id = await t.create('faction', 'Guild');
    expect(t.element(id).uuid).toBe(t.doc(id).uuid);
    expect(t.doc(id).pages?.map((p) => p.name)).toContain('Overview');
  });

  it('on demand: element.create leaves a Ghost with default Info Blocks', async () => {
    const t = setup({ mode: 'onDemand' });
    const id = await t.create('event', 'Ambush');
    expect(t.element(id).uuid).toBeUndefined();
    expect(t.element(id).infoBlocks?.map((b) => b.name)).toEqual(['Setup', 'Outcome']);
    expect(t.docs.docs.size).toBe(0);
  });

  it('no retroactive Materialize on a mode switch', async () => {
    const t = setup({ mode: 'onDemand' });
    const id = await t.create('note', 'N');
    t.setMode('immediate');
    await t.create('note', 'M');
    expect(t.element(id).uuid).toBeUndefined();
  });

  it('inside the Creation Pipeline, immediate Materialize waits for the name step', async () => {
    const t = setup();
    let creating = true;
    const m = createMaterializer({
      workingCopy: () => t.workingCopy,
      docs: t.docs,
      system: dsa5Mapping,
      mode: () => 'immediate',
      newId: (() => {
        let n = 100;
        return () => `id${++n}`;
      })(),
      localize: (k) => k,
      notify: () => {},
      confirm: async () => true,
      visibleIds: () => [],
      selection: () => [],
      deferImmediate: () => creating,
    });
    const data = { class: 'note' as const, name: 'Note', position: { x: 0, y: 0 } };
    await t.workingCopy.set([{ kind: 'element', id: 'e1', data }]);
    await m.afterCreate({ id: 'e1', ...data });
    expect(t.element('e1').uuid).toBeUndefined();
    creating = false;
    await m.afterPipeline('e1');
    expect(t.element('e1').uuid).toBeTruthy();
  });

  it('m without ids Materializes the selection', async () => {
    const t = setup();
    const a = await t.create('note', 'A');
    const b = await t.create('note', 'B');
    t.select([b]);
    expect(await t.registry.run('materialize.elements')).toEqual({ ids: [b] });
    expect(t.element(a).uuid).toBeUndefined();
    expect(t.registry.get('materialize.elements')?.keys).toEqual([{ key: 'KeyM' }]);
  });

  it('opening the sheet of a Ghost Materializes it with a toast, then opens doc + Companion', async () => {
    const t = setup();
    const id = await t.create('person', 'Alrik');
    await t.registry.run('element.openSheet', { id });
    expect(t.toasts).toEqual(['Implicit']);
    const doc = t.doc(id);
    expect(t.docs.opened).toEqual([doc.uuid, `JournalEntry.${doc.flags.silk.companion}`]);
    await t.registry.run('element.openSheet', { id });
    expect(t.toasts).toHaveLength(1);
  });

  it('Materialize visible: confirms the count; skips PCs, Materialized and unrendered', async () => {
    const t = setup({ visible: ['a', 'b', 'c', 'pc'] });
    const at = { x: 0, y: 0 };
    await t.workingCopy.set([
      { kind: 'element', id: 'a', data: { class: 'note', name: 'A', position: at } },
      { kind: 'element', id: 'b', data: { class: 'note', name: 'B', position: at } },
      { kind: 'element', id: 'c', data: { class: 'note', name: 'C', position: at } },
      { kind: 'element', id: 'hidden', data: { class: 'note', name: 'H', position: at } },
      { kind: 'element', id: 'pc', data: { class: 'playerCharacter', name: 'P', position: at } },
    ]);
    await t.registry.run('materialize.elements', { ids: ['c'] });
    expect(await t.registry.run('materialize.visible')).toEqual({ ids: ['a', 'b'] });
    expect(t.confirms).toEqual([2]);
    expect(t.element('hidden').uuid).toBeUndefined();
    expect(await t.registry.run('materialize.visible')).toEqual({ ids: [] });
    expect(t.confirms).toEqual([2]);
  });

  it('Materialize visible does nothing when the GM declines', async () => {
    const t = setup({ confirm: false });
    const id = await t.create('note', 'A');
    expect(await t.registry.run('materialize.visible')).toEqual({ ids: [] });
    expect(t.element(id).uuid).toBeUndefined();
    expect(await t.registry.run('materialize.visible', { confirmed: true })).toEqual({
      ids: [id],
    });
  });

  it('concurrent Materialize of one element creates one doc', async () => {
    const t = setup();
    const id = await t.create('person', 'P');
    await Promise.all([
      t.materializer.ensureMaterialized(id),
      t.registry.run('materialize.elements', { ids: [id] }),
    ]);
    expect(t.docs.docs.size).toBe(2);
  });
});
