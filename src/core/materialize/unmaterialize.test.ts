import { describe, expect, it } from 'vitest';
import { readSheet, sheetId } from './lifecycle';
import { must, page, pageNames, setup } from './test-setup';

describe('Unmaterialize (spec §6)', () => {
  it('snapshots the doc and Companion Journal, deletes them, keeps a Ghost with its Connections', async () => {
    const t = setup({ mode: 'immediate', connections: true });
    const alrik = await t.create('person', 'Alrik');
    const inn = await t.create('location', 'Inn');
    const { id: link } = await t.registry.run<{ id: string }>('connection.create', {
      from: alrik,
      to: inn,
      label: 'drinks at',
    });
    // A Foundry-side edit: sheet data Silk has no field for.
    const actor = t.doc(alrik);
    actor.system = { ...actor.system, status: { wounds: { value: 7 } } };
    const companionUuid = t.companion(alrik).uuid;

    await t.registry.run('materialize.unmaterialize', { ids: [alrik] });

    expect(t.docs.docs.has(actor.uuid)).toBe(false);
    expect(t.docs.docs.has(companionUuid)).toBe(false);
    expect(t.element(alrik).uuid).toBeUndefined();
    expect(t.element(alrik).name).toBe('Alrik');
    expect(t.workingCopy.get(link)).toBeDefined();
    const sheet = must(readSheet(t.workingCopy.get(sheetId(alrik))), 'sheet');
    expect(sheet.element).toBe(alrik);
    expect(sheet.documentName).toBe('Actor');
    expect(sheet.doc.system).toMatchObject({ status: { wounds: { value: 7 } } });
    expect(sheet.companion?.pages?.map((p) => p.name)).toEqual([
      'Appearance',
      'Personality',
      'Secrets',
      'Connections',
    ]);
    // Ownership, folder and sort are not versioned (§11.2).
    expect(sheet.doc).not.toHaveProperty('ownership');
    expect(sheet.doc).not.toHaveProperty('folder');
  });

  it('Materializing again restores the snapshot, with the Ghost’s edits on top', async () => {
    const t = setup({ mode: 'immediate' });
    const alrik = await t.create('person', 'Alrik');
    const actor = t.doc(alrik);
    actor.system = { ...actor.system, status: { wounds: { value: 7 } } };
    const pageIds = t.companion(alrik).pages.map((p) => p._id);
    await t.registry.run('materialize.unmaterialize', { ids: [alrik] });
    await t.registry.run('element.rename', { id: alrik, name: 'Alrik the Bold' });
    const secrets = must(t.element(alrik).infoBlocks.find((b) => b.name === 'Secrets'));
    await t.registry.run('infoBlock.edit', { id: secrets._id, text: '<p>Spy</p>' });

    await t.registry.run('materialize.elements', { ids: [alrik] });

    const doc = t.doc(alrik);
    expect(doc.name).toBe('Alrik the Bold');
    expect(doc.system).toMatchObject({ status: { wounds: { value: 7 } } });
    expect(doc.ownership).toEqual({ default: 0 });
    expect(
      t
        .companion(alrik)
        .pages.map((p) => p._id)
        .sort(),
    ).toEqual([...pageIds].sort());
    expect(page(t.companion(alrik), secrets._id).text?.content).toBe('<p>Spy</p>');
    expect(t.companion(alrik).flags.silk.companionOf).toBe(alrik);
    expect(doc.flags.silk.companion).toBe(t.companion(alrik)._id);
  });

  it('a journal element restores its pages; a class change while a Ghost adds the layout', async () => {
    const t = setup({ mode: 'immediate' });
    const note = await t.create('note', 'Rumour');
    const doc = t.doc(note);
    doc.pages.push({
      _id: 'handout0000000001',
      name: 'Handout',
      type: 'image',
      sort: 5,
      ownership: { default: 0 },
      src: 'h.webp',
    });
    await t.registry.run('materialize.unmaterialize', { ids: [note] });
    await t.registry.run('element.changeClass', { id: note, class: 'location' });
    await t.registry.run('materialize.elements', { ids: [note] });
    const restored = t.doc(note);
    expect(restored.pages.some((p) => p._id === 'handout0000000001')).toBe(true);
    expect(pageNames(restored)).toContain('Connections');
    expect(restored.flags.silk.cover).toBeTruthy();
  });

  it('a Revealed element warns first (client setting); cancel keeps it Materialized', async () => {
    const t = setup({ mode: 'immediate' });
    const alrik = await t.create('person', 'Alrik');
    const bodo = await t.create('person', 'Bodo');
    t.revealed.add(alrik);
    t.answers.unmaterialize = false;

    await t.registry.run('materialize.unmaterialize', { ids: [alrik, bodo] });
    expect(t.prompts.unmaterialize).toEqual([['Alrik']]);
    expect(t.element(alrik).uuid).toBeDefined();
    expect(t.element(bodo).uuid).toBeDefined();

    t.settings.warnUnmaterializeReveal = false;
    await t.registry.run('materialize.unmaterialize', { ids: [alrik, bodo] });
    expect(t.prompts.unmaterialize).toHaveLength(1);
    expect(t.element(alrik).uuid).toBeUndefined();
    expect(t.element(bodo).uuid).toBeUndefined();
  });

  it('Ghosts are skipped; contributors snapshot their docs before the element’s are deleted', async () => {
    const t = setup({ mode: 'immediate' });
    const event = await t.create('event', 'Ambush');
    const ghost = await t.create('person', 'Ghost');
    await t.registry.run('materialize.unmaterialize', { ids: [ghost] });
    const seen: string[] = [];
    t.lifecycle.contribute({
      async unmaterialize(el) {
        seen.push(`${el.id}:${t.docs.docs.has(must(el.uuid)) ? 'doc present' : 'doc gone'}`);
      },
    });
    const { ids } = await t.registry.run<{ ids: string[] }>('materialize.unmaterialize', {
      ids: [event, ghost],
    });
    expect(ids).toEqual([event]);
    expect(seen).toEqual([`${event}:doc present`]);
  });

  it('contributors hear about re-Materialize (Revelation Map ownership, Event Scene)', async () => {
    const t = setup({ mode: 'immediate' });
    const id = await t.create('item', 'Sword');
    const seen: string[] = [];
    t.lifecycle.contribute({ rematerialized: async (el) => void seen.push(must(el.uuid)) });
    await t.registry.run('materialize.unmaterialize', { ids: [id] });
    await t.registry.run('materialize.elements', { ids: [id] });
    expect(seen).toEqual([t.doc(id).uuid]);
  });
});
