/**
 * Scene source (spec 1.1 §B.2.1): a Location or Event picked from a Scene pack imports that
 * Scene, config untouched, as its Overview / Event Scene when it Materializes.
 */
import { describe, expect, it } from 'vitest';
import { setup } from './test-setup';

const MAP = 'Compendium.dsa5-core.coremaps.Scene.gareth';

function withMap(t: ReturnType<typeof setup>) {
  t.docs.compendium.set(MAP, {
    name: 'Gareth (Karte)',
    background: { src: 'maps/gareth.webp' },
    grid: { type: 1, size: 140 },
    tokenVision: true,
    walls: [{ _id: 'wall000000000001', c: [0, 0, 100, 0] }],
    lights: [{ _id: 'light00000000001', x: 50, y: 50 }],
    tokens: [],
    flags: { dsa5: { lang: 'de' } },
    _stats: { compendiumSource: MAP },
  });
}

const fromMap = (t: ReturnType<typeof setup>, cls: 'location' | 'event', name = 'Gareth') =>
  t.registry
    .run<{ id: string }>('element.create', {
      class: cls,
      name,
      source: { kind: 'compendium', uuid: MAP },
      img: 'maps/gareth.webp',
    })
    .then((r) => r.id);

describe('Scene source (spec 1.1 §B.2.1)', () => {
  it('Location: Materialize imports the Scene untouched as its Overview Scene', async () => {
    const t = setup();
    withMap(t);
    const town = await fromMap(t, 'location');
    const scene = t.scene(town);
    expect(scene).toMatchObject({
      name: 'Gareth',
      background: { src: 'maps/gareth.webp' },
      grid: { type: 1, size: 140 },
      tokenVision: true,
      walls: [{ _id: 'wall000000000001' }],
      lights: [{ _id: 'light00000000001' }],
      flags: { dsa5: { lang: 'de' }, silk: { sceneOf: town } },
      folder: 'sceneFolder',
    });
    // No Preset applied: no Narrative box, no Preset flag.
    expect(scene.drawings ?? []).toEqual([]);
    expect(t.doc(town).flags.silk.scene).toBe(scene._id);
    // The journal is the Location's own, its Cover the Scene's background.
    expect(t.doc(town).documentName).toBe('JournalEntry');
    expect(t.element(town).img).toBe('maps/gareth.webp');
  });

  it('Event: the imported Scene is its Event Scene; present at places tokens; versioned', async () => {
    const t = setup();
    withMap(t);
    const siege = await fromMap(t, 'event', 'Siege');
    const alrik = await t.create('person', 'Alrik');
    await t.connect(alrik, siege);
    expect(t.scene(siege)).toMatchObject({ name: 'Siege', grid: { type: 1, size: 140 } });
    expect(t.tokens(siege)).toEqual([t.actorId(alrik)]);
    await t.commit('c1');
    expect(t.workingCopy.get(`${siege}-scene`)?.data).toMatchObject({
      scene: { walls: [{ _id: 'wall000000000001' }] },
    });
  });

  it('on demand: the Ghost has no Scene; it is imported on Materialize', async () => {
    const t = setup({ mode: 'onDemand' });
    withMap(t);
    const siege = await fromMap(t, 'event', 'Siege');
    expect(t.scenes.all.size).toBe(0);
    expect(t.element(siege)).toMatchObject({
      source: { kind: 'compendium', uuid: MAP },
      img: 'maps/gareth.webp',
    });
    await t.materialize(siege);
    expect(t.scene(siege).walls).toHaveLength(1);
  });

  it('a missing Scene entry: the Event falls back to its Preset, the Location has none; a toast', async () => {
    const t = setup();
    const siege = await fromMap(t, 'event', 'Siege');
    expect(t.scene(siege).drawings).toHaveLength(1);
    const town = await fromMap(t, 'location');
    expect(t.eventScenes.sceneOf(town)).toBeUndefined();
    expect(t.toasts.filter((m) => m.startsWith('CompendiumMissing'))).toHaveLength(2);
  });
});
