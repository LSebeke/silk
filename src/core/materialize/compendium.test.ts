/** Ghost worlds (spec 1.1 §B.1, §B.2): a Compendium pick imports its entry on Materialize. */
import { describe, expect, it } from 'vitest';
import { setup } from './test-setup';

const WOLF = 'Compendium.dsa5.creatures.Actor.wolf';

function withPack(t: ReturnType<typeof setup>) {
  t.docs.compendium.set(WOLF, {
    name: 'Wolf',
    type: 'creature',
    img: 'packs/wolf.webp',
    system: { status: { wounds: { value: 21 } }, description: { value: 'grey' } },
    items: [
      {
        _id: 'bite0000000000001',
        name: 'Bite',
        type: 'meleeweapon',
        folder: null,
        flags: { garn: {} },
      },
    ],
    flags: { dsa5: { lang: 'de' } },
    _stats: { compendiumSource: WOLF },
  });
}

const createFromPack = (t: ReturnType<typeof setup>, name = 'Wolf') =>
  t.registry
    .run<{ id: string }>('element.create', {
      class: 'creature',
      name,
      source: { kind: 'compendium', uuid: WOLF },
    })
    .then((r) => r.id);

describe('Compendium source', () => {
  it('on demand: a Ghost with default Info Blocks; nothing is imported yet', async () => {
    const t = setup({ mode: 'onDemand' });
    withPack(t);
    const id = await createFromPack(t);
    expect(t.element(id)).toMatchObject({ source: { kind: 'compendium', uuid: WOLF } });
    expect(t.element(id).uuid).toBeUndefined();
    expect(t.element(id).infoBlocks.map((b) => b.name)).toContain('Appearance');
    expect(t.docs.docs.size).toBe(0);
  });

  it('Materialize imports the entry: its system data and items, under the element name, in the Garn folder', async () => {
    const t = setup({ mode: 'onDemand' });
    withPack(t);
    const id = await createFromPack(t, 'Grauwolf');
    await t.registry.run('materialize.elements', { ids: [id] });
    const doc = t.doc(id);
    expect(doc).toMatchObject({
      name: 'Grauwolf',
      type: 'creature',
      img: 'packs/wolf.webp',
      ownership: { default: 0 },
      system: { status: { wounds: { value: 21 } } },
      items: [{ name: 'Bite' }],
      flags: { dsa5: { lang: 'de' }, garn: { id } },
      _stats: { compendiumSource: WOLF },
    });
    expect(doc.folder).toBe(t.docs.folders.find((f) => f.key === 'creature')?.id);
    // Handled as Garn-created: Companion Journal with the default Info Blocks.
    expect(t.companion(id).pages.map((p) => p.name)).toContain('Appearance');
    expect(t.element(id)).toMatchObject({ name: 'Grauwolf', img: 'packs/wolf.webp' });
  });

  it('keeps the entry look as the original (v1.1 §G.3.1), even after a Ghost image edit', async () => {
    const t = setup({ mode: 'onDemand' });
    withPack(t);
    const entry = t.docs.compendium.get(WOLF) as Record<string, unknown>;
    entry.prototypeToken = { texture: { src: 'packs/wolf-token.webp' }, ring: { enabled: true } };
    const id = await createFromPack(t);
    await t.registry.run('element.setImage', { id, img: 'mine.webp' });
    await t.registry.run('materialize.elements', { ids: [id] });
    expect(t.doc(id).img).toBe('mine.webp');
    expect(t.doc(id).flags.garn.original).toEqual({
      img: 'packs/wolf.webp',
      texture: { src: 'packs/wolf-token.webp' },
      ring: { enabled: true },
    });
  });

  it('element.restoreImages (v1.1 §G.3.1): the entry look back, everywhere', async () => {
    const t = setup({ mode: 'onDemand' });
    withPack(t);
    const entry = t.docs.compendium.get(WOLF) as Record<string, unknown>;
    entry.prototypeToken = { texture: { src: 'packs/wolf-token.webp', fit: 'cover' } };
    const id = await createFromPack(t);
    await t.registry.run('materialize.elements', { ids: [id] });
    expect(t.materializer.look(id)?.restorable).toBe(true);
    await t.registry.run('element.setImage', {
      id,
      img: 'mine.webp',
      token: { sameAsImage: true, anchor: { x: 0.3, y: 0.3 } },
    });
    await t.registry.run('element.restoreImages', { id });
    const doc = t.doc(id) as ReturnType<typeof t.doc> & { prototypeToken: { texture: object } };
    expect(doc.img).toBe('packs/wolf.webp');
    expect(doc.prototypeToken.texture).toMatchObject({
      src: 'packs/wolf-token.webp',
      fit: 'cover',
      anchorX: 0.5,
    });
    expect(doc.flags.garn.pose).toBeUndefined();
    expect(t.element(id).img).toBe('packs/wolf.webp');
    expect(t.tokens.at(-1)?.data).toMatchObject({ 'texture.src': 'packs/wolf-token.webp' });
  });

  it('element.restoreImages is rejected without imported images', async () => {
    const t = setup({ mode: 'immediate' });
    const id = await t.create('person', 'Alrik');
    expect(t.materializer.look(id)?.restorable).toBe(false);
    await expect(t.registry.run('element.restoreImages', { id })).rejects.toThrow();
  });

  it('immediate: imported once the pipeline ends', async () => {
    const t = setup({ mode: 'immediate' });
    withPack(t);
    const id = await createFromPack(t);
    expect(t.doc(id).system).toMatchObject({ status: { wounds: { value: 21 } } });
  });

  it('a missing entry Materializes blank, with a warning toast', async () => {
    const t = setup({ mode: 'onDemand' });
    const id = await createFromPack(t);
    await t.registry.run('materialize.elements', { ids: [id] });
    expect(t.doc(id)).toMatchObject({ name: 'Wolf', type: 'creature' });
    expect(t.toasts).toContain('CompendiumMissing');
  });
});
