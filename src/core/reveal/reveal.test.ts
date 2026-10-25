import { describe, expect, it } from 'vitest';
import { emptyRevelationMap } from '../campaigns';
import { connectionSentences } from '../connections';
import { must, page } from '../materialize/test-setup';
import { HOOD, setup } from './test-setup';

const NONE = 0;
const LIMITED = 1;
const OBSERVER = 2;

async function materialized(t: ReturnType<typeof setup>, cls: string, name: string) {
  const id = await t.create(cls, name);
  await t.registry.run('materialize.elements', { ids: [id] });
  return id;
}
const blockId = (t: ReturnType<typeof setup>, id: string, name: string) =>
  must(t.element(id).infoBlocks.find((b) => b.name === name)?._id, name);

describe('reveal.element (spec §8)', () => {
  it('a journal element: entry and Cover OBSERVER, Info Blocks stay NONE; the map records it', async () => {
    const t = setup();
    const id = await materialized(t, 'location', 'Gareth');
    await t.run('reveal.element', { id, revealed: true });
    const doc = t.doc(id);
    expect(t.level(doc)).toBe(OBSERVER);
    expect(t.level(page(doc, doc.flags.silk.cover))).toBe(OBSERVER);
    for (const block of t.element(id).infoBlocks) expect(t.level(page(doc, block._id))).toBe(NONE);
    expect(t.level(page(doc, doc.flags.silk.connections))).toBe(NONE);
    expect(t.map().elements).toEqual([id]);
    expect(t.world().elements).toEqual([id]);
    expect(t.reveal.isRevealed('element', id)).toBe(true);
  });

  it('an Actor element: doc LIMITED, Companion Journal stays NONE', async () => {
    const t = setup();
    const id = await materialized(t, 'person', 'Alrik');
    await t.run('reveal.element', { id });
    expect(t.level(t.doc(id))).toBe(LIMITED);
    expect(t.level(t.companion(id))).toBe(NONE);
  });

  it('a Ghost is Materialized first, regardless of the mode', async () => {
    const t = setup();
    const id = await t.create('faction', 'Gilde');
    expect(t.element(id).uuid).toBeUndefined();
    await t.run('reveal.element', { id });
    expect(t.level(t.doc(id))).toBe(OBSERVER);
  });

  it('is unavailable under the main Checkout ("start an Adventure to Reveal")', async () => {
    const t = setup({ adventure: false });
    const id = await materialized(t, 'location', 'Gareth');
    expect(t.registry.isAvailable('reveal.element')).toBe(false);
    await expect(t.run('reveal.element', { id })).rejects.toThrow();
    expect(t.level(t.doc(id))).toBe(NONE);
  });
});

describe('reveal.infoBlock', () => {
  it('a journal block: page OBSERVER plus the element Reveal, nothing more', async () => {
    const t = setup();
    const id = await materialized(t, 'location', 'Gareth');
    const desc = blockId(t, id, 'Description');
    const secrets = blockId(t, id, 'Secrets');
    await t.run('reveal.infoBlock', { id: desc });
    const doc = t.doc(id);
    expect(t.level(doc)).toBe(OBSERVER);
    expect(t.level(page(doc, desc))).toBe(OBSERVER);
    expect(t.level(page(doc, secrets))).toBe(NONE);
    expect(t.map().infoBlocks).toEqual([desc]);
    expect(t.map().elements).toEqual([id]);
  });

  it('an Actor block: the Companion Journal becomes OBSERVER on its first Revealed block', async () => {
    const t = setup();
    const id = await materialized(t, 'person', 'Alrik');
    const personality = blockId(t, id, 'Personality');
    await t.run('reveal.infoBlock', { id: personality });
    const companion = t.companion(id);
    expect(t.level(t.doc(id))).toBe(LIMITED);
    expect(t.level(companion)).toBe(OBSERVER);
    expect(t.level(page(companion, personality))).toBe(OBSERVER);
    expect(t.level(page(companion, blockId(t, id, 'Secrets')))).toBe(NONE);
  });

  it('Quest: element Reveal sets visible, each block mirrors into linkedPages', async () => {
    const t = setup();
    const id = await materialized(t, 'quest', 'Der Drache');
    const hook = blockId(t, id, 'Hook');
    const resolution = blockId(t, id, 'Resolution');
    await t.run('reveal.infoBlock', { id: hook });
    const doc = t.doc(id);
    const { quest, questKey } = doc.flags.silk;
    const q = (page(doc, quest).system as { quests: Record<string, Record<string, unknown>> })
      .quests[questKey];
    expect(q?.['visible']).toBe(true);
    const linked = q?.['linkedPages'] as Record<string, { uuid: string; visible: boolean }>;
    expect(linked[hook]).toMatchObject({
      uuid: `${doc.uuid}.JournalEntryPage.${hook}`,
      visible: true,
    });
    expect(linked[resolution]?.visible).toBe(false);
  });
});

describe('reveal.connection', () => {
  it('Reveals both endpoints and opens their Connections pages; others stay NONE', async () => {
    const t = setup();
    const a = await materialized(t, 'person', 'Alrik');
    const b = await materialized(t, 'location', 'Gareth');
    const c = await materialized(t, 'faction', 'Gilde');
    const ab = await t.connect(a, b, 'lives in');
    await t.connect(b, c, 'hosts');
    await t.run('reveal.connection', { id: ab });
    expect(t.map().connections).toEqual([ab]);
    expect(t.level(t.doc(a))).toBe(LIMITED);
    expect(t.level(t.doc(b))).toBe(OBSERVER);
    expect(t.level(t.doc(c))).toBe(NONE);
    expect(t.level(t.companion(a))).toBe(OBSERVER);
    expect(t.level(page(t.companion(a), t.companion(a).flags.silk.connections))).toBe(OBSERVER);
    expect(t.level(page(t.doc(b), t.doc(b).flags.silk.connections))).toBe(OBSERVER);
    expect(t.pageRefreshes.flat()).toEqual(expect.arrayContaining([a, b]));
  });

  it('players see only Revealed sentences (the page filter reads the World state)', async () => {
    const t = setup();
    const a = await materialized(t, 'person', 'Alrik');
    const b = await materialized(t, 'location', 'Gareth');
    const ab = await t.connect(a, b, 'lives in');
    await t.connect(a, b, 'hates');
    await t.run('reveal.connection', { id: ab });
    const sentences = connectionSentences(
      t.workingCopy.records(),
      a,
      (_k, d) => `${d['from']} ${d['label']} ${d['to']}`,
      (conn) => t.reveal.isRevealed('connection', conn.id),
    );
    expect(sentences).toEqual(['Alrik lives in Gareth']);
  });
});

describe('un-reveal', () => {
  it('reverses everything: element, its blocks, Connections and pages; Player Notes stay in the map', async () => {
    const t = setup();
    const a = await materialized(t, 'person', 'Alrik');
    const b = await materialized(t, 'location', 'Gareth');
    const ab = await t.connect(a, b);
    const desc = blockId(t, b, 'Description');
    await t.run('reveal.connection', { id: ab });
    await t.run('reveal.infoBlock', { id: desc });
    t.maps.set('camp1', { ...t.map(), playerNotes: ['note1'] });
    await t.run('reveal.element', { id: b, revealed: false });
    const doc = t.doc(b);
    expect(t.level(doc)).toBe(NONE);
    expect(t.level(page(doc, doc.flags.silk.cover))).toBe(NONE);
    expect(t.level(page(doc, desc))).toBe(NONE);
    expect(t.level(page(doc, doc.flags.silk.connections))).toBe(NONE);
    // A stays Revealed, but its only Revealed Connection is gone.
    expect(t.level(t.doc(a))).toBe(LIMITED);
    expect(t.level(t.companion(a))).toBe(NONE);
    expect(t.map()).toEqual({ ...emptyRevelationMap(), elements: [a], playerNotes: ['note1'] });
  });

  it('deleting a Revealed Connection drops it from the map and closes the pages', async () => {
    const t = setup();
    t.reveal.watch();
    const a = await materialized(t, 'location', 'A');
    const b = await materialized(t, 'location', 'B');
    const ab = await t.connect(a, b);
    await t.run('reveal.connection', { id: ab });
    await t.registry.run('connection.delete', { ids: [ab] });
    await t.reveal.idle();
    expect(t.map().connections).toEqual([]);
    expect(t.world().connections).toEqual([]);
    expect(t.level(page(t.doc(a), t.doc(a).flags.silk.connections))).toBe(NONE);
    expect(t.level(page(t.doc(b), t.doc(b).flags.silk.connections))).toBe(NONE);
    expect(t.level(t.doc(a))).toBe(OBSERVER);
  });

  it('a Connection alone: its endpoints stay Revealed', async () => {
    const t = setup();
    const a = await materialized(t, 'location', 'A');
    const b = await materialized(t, 'location', 'B');
    const ab = await t.connect(a, b);
    await t.run('reveal.connection', { id: ab });
    await t.run('reveal.connection', { id: ab, revealed: false });
    expect(t.map().elements).toEqual([a, b].sort());
    expect(t.map().connections).toEqual([]);
    expect(t.level(page(t.doc(a), t.doc(a).flags.silk.connections))).toBe(NONE);
  });
});

describe('Appearance (Person/Creature)', () => {
  it('Materialize hoods img and token; the record keeps the real image', async () => {
    const t = setup();
    const id = await t.create('person', 'Alrik');
    await t.registry.run('element.setImage', { id, img: 'alrik.webp' });
    await t.registry.run('materialize.elements', { ids: [id] });
    const doc = t.doc(id) as ReturnType<typeof t.doc> & {
      prototypeToken: { texture: { src: string }; displayName: number };
    };
    expect(doc.img).toBe(HOOD);
    expect(doc.flags.silk.img).toBe('alrik.webp');
    expect(doc.prototypeToken.texture.src).toBe(HOOD);
    expect(doc.prototypeToken.displayName).toBe(40); // OWNER before the element Reveal
    await t.materializer.sync(id);
    expect(t.element(id).img).toBe('alrik.webp');
  });

  it('reveal.appearance shows the real image and Reveals the Appearance block; un-reveal hoods again', async () => {
    const t = setup();
    const id = await t.create('person', 'Alrik');
    await t.registry.run('element.setImage', { id, img: 'alrik.webp' });
    await t.registry.run('materialize.elements', { ids: [id] });
    await t.run('reveal.appearance', { id });
    const doc = t.doc(id) as ReturnType<typeof t.doc> & {
      prototypeToken: { texture: { src: string }; displayName: number };
    };
    expect(doc.img).toBe('alrik.webp');
    expect(doc.prototypeToken.texture.src).toBe('alrik.webp');
    expect(doc.prototypeToken.displayName).toBe(30); // HOVER after
    expect(doc.flags.silk.hood).toBeUndefined();
    expect(t.level(page(t.companion(id), blockId(t, id, 'Appearance')))).toBe(OBSERVER);
    expect(t.tokens.at(-1)).toEqual({
      actor: doc.uuid,
      data: { 'texture.src': 'alrik.webp', displayName: 30 },
    });
    await t.run('reveal.infoBlock', { id: blockId(t, id, 'Appearance'), revealed: false });
    expect(t.doc(id).img).toBe(HOOD);
    expect(t.map().appearance).toEqual([]);
    expect(t.element(id).img).toBe('alrik.webp');
  });

  it('setImage while hooded changes the waiting real image, not the hood', async () => {
    const t = setup();
    const id = await materialized(t, 'creature', 'Drache');
    await t.registry.run('element.setImage', { id, img: 'dragon.webp' });
    expect(t.doc(id).img).toBe(HOOD);
    expect(t.element(id).img).toBe('dragon.webp');
    await t.run('reveal.appearance', { id });
    expect(t.doc(id).img).toBe('dragon.webp');
  });
});

describe('Truth: World ownership mirrored in the Revelation Map', () => {
  it('checkout applies the Campaign map to ownership and the World state', async () => {
    const t = setup();
    const a = await materialized(t, 'location', 'A');
    await t.reveal.applyMap({ ...emptyRevelationMap(), elements: [a] });
    expect(t.level(t.doc(a))).toBe(OBSERVER);
    expect(t.world().elements).toEqual([a]);
    await t.reveal.applyMap(emptyRevelationMap());
    expect(t.level(t.doc(a))).toBe(NONE);
  });

  it('a re-Materialized element gets its ownership back from the map', async () => {
    const t = setup();
    const a = await materialized(t, 'location', 'A');
    await t.run('reveal.element', { id: a });
    t.answers.unmaterialize = true;
    t.settings.warnUnmaterializeReveal = false;
    await t.registry.run('materialize.unmaterialize', { ids: [a] });
    await t.registry.run('materialize.elements', { ids: [a] });
    expect(t.level(t.doc(a))).toBe(OBSERVER);
  });

  it('reconcile: ownership wins and derived ownership is repaired', async () => {
    const t = setup();
    const a = await materialized(t, 'location', 'A');
    const b = await materialized(t, 'location', 'B');
    const ab = await t.connect(a, b);
    await t.run('reveal.connection', { id: ab });
    // Drift while Silk was off: the GM hid B by hand, and opened A's Description.
    t.doc(b).ownership = { default: NONE };
    const desc = blockId(t, a, 'Description');
    page(t.doc(a), desc).ownership = { default: OBSERVER };
    await t.lifecycle.reconcile();
    expect(t.map().elements).toEqual([a]);
    expect(t.map().connections).toEqual([]);
    expect(t.map().infoBlocks).toEqual([desc]);
    expect(t.world()).toEqual(t.map());
    expect(t.level(page(t.doc(a), t.doc(a).flags.silk.connections))).toBe(NONE);
    expect(t.level(page(t.doc(b), t.doc(b).flags.silk.cover))).toBe(NONE);
  });

  it('reconcile under main: the World state follows ownership, no Campaign map is written', async () => {
    const t = setup();
    const a = await materialized(t, 'location', 'A');
    await t.run('reveal.element', { id: a });
    t.setCampaign(null);
    t.maps.clear();
    t.doc(a).ownership = { default: NONE };
    await t.lifecycle.reconcile();
    expect(t.world().elements).toEqual([]);
    expect(t.maps.size).toBe(0);
  });

  it('reconcile keeps map entries of Ghosts (Revealed again when Materialized)', async () => {
    const t = setup();
    const ghost = await t.create('location', 'Ghost');
    t.maps.set('camp1', { ...emptyRevelationMap(), elements: [ghost] });
    await t.lifecycle.reconcile();
    expect(t.map().elements).toEqual([ghost]);
  });
});

describe('reveal.showToPlayers', () => {
  it('Reveals if needed, then a forced Show of the journal', async () => {
    const t = setup();
    const a = await materialized(t, 'location', 'A');
    await t.run('reveal.showToPlayers', { id: a });
    expect(t.level(t.doc(a))).toBe(OBSERVER);
    expect(t.shown).toEqual([{ uuid: t.doc(a).uuid }]);
  });

  it('an Actor without open Companion: shares its (hooded) image', async () => {
    const t = setup();
    const a = await materialized(t, 'person', 'Alrik');
    await t.run('reveal.showToPlayers', { id: a });
    expect(t.shown).toEqual([{ image: HOOD, title: 'Alrik' }]);
  });

  it('an Info Block: Reveals it and shows its page', async () => {
    const t = setup();
    const a = await materialized(t, 'location', 'A');
    const desc = blockId(t, a, 'Description');
    await t.run('reveal.showToPlayers', { id: desc });
    expect(t.level(page(t.doc(a), desc))).toBe(OBSERVER);
    expect(t.shown).toEqual([{ uuid: `${t.doc(a).uuid}.JournalEntryPage.${desc}` }]);
  });
});
