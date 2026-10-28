import { describe, expect, it } from 'vitest';
import { readSheet, sheetId } from './lifecycle';
import { must, setup } from './test-setup';

describe('Commit capture (spec §11.2)', () => {
  it('writes every Materialized element’s full doc data into its sheet record', async () => {
    const t = setup({ mode: 'immediate' });
    const alrik = await t.create('person', 'Alrik');
    const ghost = await t.create('note', 'Ghost');
    await t.registry.run('materialize.unmaterialize', { ids: [ghost] });
    const ghostSheet = t.workingCopy.get(sheetId(ghost));
    t.doc(alrik).system = { status: { wounds: { value: 2 } } };
    const captured: string[] = [];
    t.lifecycle.contribute({ capture: async () => void captured.push('eventScenes') });

    await t.lifecycle.capture();

    const sheet = must(readSheet(t.workingCopy.get(sheetId(alrik))));
    expect(sheet.doc.system).toEqual({ status: { wounds: { value: 2 } } });
    expect(t.workingCopy.get(sheetId(ghost))).toBe(ghostSheet);
    expect(captured).toEqual(['eventScenes']);
  });
});

describe('reconcile on load (spec §7)', () => {
  it('a doc deleted while Silk wasn’t listening: Ghost with the last Commit’s snapshot, flagged', async () => {
    const t = setup({ mode: 'immediate' });
    const alrik = await t.create('person', 'Alrik');
    t.doc(alrik).system = { status: { wounds: { value: 4 } } };
    await t.lifecycle.capture();
    t.commit('abcdef0123456789');
    const actor = t.doc(alrik);
    const companion = t.companion(alrik).uuid;
    actor.system = { status: { wounds: { value: 9 } } };
    t.docs.docs.delete(actor.uuid); // no hook

    await t.lifecycle.reconcile();

    expect(t.element(alrik).uuid).toBeUndefined();
    expect(t.element(alrik).restoredFrom).toBe('abcdef0123456789');
    expect(t.docs.docs.has(companion)).toBe(false);
    const sheet = must(readSheet(t.workingCopy.get(sheetId(alrik))));
    expect(sheet.doc.system).toEqual({ status: { wounds: { value: 4 } } });
    expect(t.warnings).toEqual([expect.stringContaining('abcdef01')]);

    // Materializing again uses that snapshot and clears the flag.
    await t.registry.run('materialize.elements', { ids: [alrik] });
    expect(t.doc(alrik).system).toEqual({ status: { wounds: { value: 4 } } });
    expect(t.element(alrik).restoredFrom).toBeUndefined();
  });

  it('a missing Companion Journal is restored; present docs are mirrored again', async () => {
    const t = setup({ mode: 'immediate' });
    const alrik = await t.create('person', 'Alrik');
    const inn = await t.create('location', 'Inn');
    t.docs.docs.delete(t.companion(alrik).uuid);
    t.doc(inn).name = 'The Inn'; // edit without a hook

    await t.lifecycle.reconcile();

    expect(t.companion(alrik).flags.silk.companionOf).toBe(alrik);
    expect(t.element(inn).name).toBe('The Inn');
  });

  it('then runs every contributor’s reconcile (owns, Dead, present at, Revealed)', async () => {
    const t = setup();
    const ran: string[] = [];
    t.lifecycle.contribute({ reconcile: async () => void ran.push('owns') });
    t.lifecycle.contribute({ reconcile: async () => void ran.push('dead') });
    await t.lifecycle.reconcile();
    expect(ran).toEqual(['owns', 'dead']);
  });
});
