import { describe, expect, it } from 'vitest';
import { must, setup } from './test-setup';

/** A world Actor as NSC Zucht leaves it: in its own folder, no Silk flags. */
function generated(t: ReturnType<typeof setup>, name = 'Ulf Hjaldarson') {
  return t.docs.create('Actor', {
    _id: 'gen00000000001',
    name,
    type: 'npc',
    img: 'tokens/ulf.webp',
    folder: 'zuchtFolder',
    system: {},
    flags: { silk: {} },
  });
}

const source = (actorUuid: string) => ({ kind: 'generator', id: 'nsc-zucht', actorUuid });

const createFrom = async (
  t: ReturnType<typeof setup>,
  actorUuid: string,
  name = 'Ulf Hjaldarson',
) =>
  (
    await t.registry.run<{ id: string }>('element.create', {
      class: 'person',
      name,
      source: source(actorUuid),
    })
  ).id;

describe('Generator pick binds the created Actor (spec 1.1 §B.3, §D)', () => {
  it('on demand: the Actor becomes the element doc at once, with Companion Journal and default blocks', async () => {
    const t = setup({ mode: 'onDemand' });
    const actor = await generated(t);
    const id = await createFrom(t, actor);
    expect(t.element(id).uuid).toBe(actor);
    const doc = t.doc(id);
    expect(doc.flags.silk.id).toBe(id);
    expect(doc.folder).toBe(t.docs.folders.find((f) => f.key === 'person')?.id);
    expect(doc.ownership).toEqual({ default: 0 });
    const companion = t.companion(id);
    expect(companion.flags.silk.companionOf).toBe(id);
    expect(companion.pages.map((p) => p.name)).toEqual([
      'Appearance',
      'Personality',
      'Secrets',
      'Connections',
    ]);
    expect(companion.pages[0]?.flags?.silk?.appearance).toBe(true);
    // Only the generated Actor and its Companion Journal: nothing else is created.
    expect(t.docs.docs.size).toBe(2);
  });

  it('keeps what the generator made: the image comes from the Actor', async () => {
    const t = setup({ mode: 'immediate' });
    const id = await createFrom(t, await generated(t));
    expect(t.element(id).img).toBe('tokens/ulf.webp');
    expect(t.docs.docs.size).toBe(2);
    // v1.1 §G.3.1: no compendium source, so the flag is the only copy.
    expect(t.doc(id).flags.silk.original).toEqual({
      img: 'tokens/ulf.webp',
      texture: {},
      ring: {},
    });
  });

  it('a rename in the name step writes through to the bound Actor', async () => {
    const t = setup({ mode: 'onDemand' });
    const actor = await generated(t);
    const id = await createFrom(t, actor);
    await t.registry.run('element.rename', { id, name: 'Ulf' });
    expect(must(t.docs.docs.get(actor)).name).toBe('Ulf');
    expect(t.companion(id).name).toBe('Ulf');
  });

  it('never takes an Actor that is already a Story Element: a fresh Actor instead', async () => {
    const t = setup({ mode: 'onDemand' });
    const actor = await generated(t);
    const first = await createFrom(t, actor);
    const second = await createFrom(t, actor);
    expect(t.element(second).uuid).toBeTruthy();
    expect(t.element(second).uuid).not.toBe(actor);
    expect(must(t.docs.docs.get(actor)).flags.silk.id).toBe(first);
  });

  it('the Actor gone before binding: a fresh Actor is Materialized instead', async () => {
    const t = setup({ mode: 'onDemand' });
    const id = await createFrom(t, 'Actor.gone0000000001', 'Ulf');
    expect(t.element(id).uuid).toBeTruthy();
    expect(t.doc(id).name).toBe('Ulf');
  });
});
