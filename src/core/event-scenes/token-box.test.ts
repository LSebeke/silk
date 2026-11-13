/**
 * Token Box (spec 1.1 §I): every Event Scene has one, outside the map in the Scene padding;
 * tokens of present at actors are placed hidden in it. Scene Preset stored in
 * `flags.garn.preset`, migrated on load.
 */
import { describe, expect, it } from 'vitest';
import { must } from '../materialize/test-setup';
import type { SceneSnapshot, TokenData } from './port';
import { setup } from './test-setup';

type Setup = ReturnType<typeof setup>;
interface Box {
  _id: string;
  x: number;
  y: number;
  shape: { width: number; height: number };
  text: string;
  fillColor: string;
  strokeColor: string;
  flags: { garn: { box: boolean } };
}

const boxOf = (scene: SceneSnapshot) =>
  ((scene.drawings ?? []) as Box[]).filter((d) => d.flags?.garn?.box);
const rect = (b: Box) => [b.x, b.y, b.shape.width, b.shape.height];
const at = (tokens: TokenData[]) => tokens.map((t) => [t.x, t.y, t.hidden]);

const MAP = 'Compendium.dsa5-core.coremaps.Scene.keep';
/** A small pack Scene: 1000 × 1000 map, no padding, grid 100. */
function withSmallMap(t: Setup) {
  t.docs.compendium.set(MAP, {
    name: 'Keep',
    width: 1000,
    height: 1000,
    padding: 0,
    grid: { type: 1, size: 100 },
    walls: [{ _id: 'wall000000000001', c: [0, 0, 100, 0] }],
    tokens: [],
  });
}
const fromMap = (t: Setup) =>
  t.registry
    .run<{ id: string }>('element.create', {
      class: 'event',
      name: 'Keep',
      source: { kind: 'compendium', uuid: MAP },
    })
    .then((r) => r.id);

const theBox = (scene: SceneSnapshot) => must(boxOf(scene)[0], 'Token Box');

/** `n` Materialized persons, present at the Event. */
async function present(t: Setup, event: string, n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = await t.create('person', `P${i}`);
    await t.materialize(id);
    await t.connect(id, event);
    ids.push(id);
  }
  return ids;
}

describe('Token Box (spec 1.1 §I)', () => {
  it('a Preset Event Scene has the box just outside the map’s top-left corner', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    const [box, ...more] = boxOf(t.scene(ambush));
    expect(more).toEqual([]);
    // 4000 × 3000, default padding 0.25 → map at (1000, 800); a grid square away.
    expect(rect(must(box))).toEqual([700, 500, 200, 200]);
    expect(box).toMatchObject({ text: 'Box', fillColor: '#ffffff', strokeColor: '#000000' });
    expect(t.scene(ambush).flags.garn?.preset).toBe('narrative');
  });

  it('present at places hidden tokens in the box, which grows along the padding', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    await present(t, ambush, 2);
    expect(at(t.scene(ambush).tokens)).toEqual([
      [750, 550, true],
      [650, 550, true],
    ]);
    expect(rect(theBox(t.scene(ambush)))).toEqual([600, 500, 300, 200]);
  });

  it('Battle and Travel Scenes have a box too', async () => {
    const t = setup({ mode: 'onDemand' });
    const fight = await t.create('event', 'Fight');
    await t.registry.run('event.createScene', { id: fight, preset: 'battle' });
    await present(t, fight, 1);
    expect(t.scene(fight).flags.garn?.preset).toBe('battle');
    expect(at(t.scene(fight).tokens)).toEqual([[750, 550, true]]);
  });

  it('a freed slot is reused', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    await present(t, ambush, 1);
    const ab = await t.connect(await t.create('person', 'B'), ambush);
    await t.registry.run('connection.delete', { ids: [ab] });
    await present(t, ambush, 1);
    expect(at(t.scene(ambush).tokens)).toEqual([
      [750, 550, true],
      [650, 550, true],
    ]);
  });

  it('an imported Scene gets a box (Preset none); padding raised just enough, up to 0.5, then rows', async () => {
    const t = setup();
    withSmallMap(t);
    const keep = await fromMap(t);
    expect(t.scene(keep).flags.garn?.preset).toBe('none');
    // One cell needs 300 px of padding: 0.25 (Foundry rounds the padding to whole squares).
    expect(t.scene(keep).padding).toBe(0.25);
    expect(rect(theBox(t.scene(keep)))).toEqual([0, 0, 200, 200]);
    await present(t, keep, 2);
    expect(t.scene(keep).padding).toBe(0.35);
    await present(t, keep, 2);
    // 4 tokens: 0.5 holds 3 per row → 2 rows along the top edge.
    expect(t.scene(keep).padding).toBe(0.5);
    expect(rect(theBox(t.scene(keep)))).toEqual([0, 100, 400, 300]);
    expect(at(t.scene(keep).tokens)).toEqual([
      [250, 250, true],
      [150, 250, true],
      [50, 250, true],
      [250, 150, true],
    ]);
    // The rest of the imported config is untouched (walls follow the padding).
    expect(t.scene(keep).walls).toEqual([{ _id: 'wall000000000001', c: [500, 500, 600, 500] }]);
  });

  it('a box the GM moved or resized keeps its place; Garn places into it', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    const box = theBox(must(t.scenes.all.get(t.scene(ambush)._id)));
    Object.assign(box, { x: 200, y: 200, shape: { ...box.shape, width: 300, height: 200 } });
    await present(t, ambush, 2);
    expect(rect(theBox(t.scene(ambush)))).toEqual([200, 200, 300, 200]);
    expect(at(t.scene(ambush).tokens)).toEqual([
      [350, 250, true],
      [250, 250, true],
    ]);
  });

  it('a full box the GM moved grows a row above, its bottom-right kept: never stacks', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    const box = theBox(must(t.scenes.all.get(t.scene(ambush)._id)));
    Object.assign(box, { x: 200, y: 200, shape: { ...box.shape, width: 300, height: 200 } });
    await present(t, ambush, 3);
    const grown = theBox(t.scene(ambush));
    expect(rect(grown)).toEqual([200, 100, 300, 300]);
    // Still the GM's box: Garn does not take it over.
    expect(grown.flags.garn).toMatchObject({ rect: { x: 700, y: 500 } });
    expect(at(t.scene(ambush).tokens)).toEqual([
      [350, 250, true],
      [250, 250, true],
      [350, 150, true],
    ]);
  });

  it('past padding 0.5 the box keeps adding rows: never stacks', async () => {
    const t = setup();
    withSmallMap(t);
    const keep = await fromMap(t);
    await present(t, keep, 7);
    expect(t.scene(keep).padding).toBe(0.5);
    // 3 per row → 3 rows.
    expect(rect(theBox(t.scene(keep)))).toEqual([0, 0, 400, 400]);
    const spots = at(t.scene(keep).tokens).map(([x, y]) => `${x},${y}`);
    expect(new Set(spots).size).toBe(7);
  });

  it('a Location Overview Scene has no box', async () => {
    const t = setup();
    const town = await t.create('location', 'Town');
    await t.registry.run('event.createScene', { id: town });
    expect(boxOf(t.scene(town))).toEqual([]);
    expect(t.scene(town).flags.garn?.preset).toBe('overview');
  });
});

describe('Scene Preset migration on load (spec 1.1 §I)', () => {
  const strip = (t: Setup, id: string) => {
    const live = must(t.scenes.all.get(t.scene(id)._id));
    delete must(live.flags.garn).preset;
    return live;
  };

  it('box → narrative; else the Canon record’s Preset; else none', async () => {
    const t = setup({ mode: 'onDemand' });
    const ambush = await t.create('event', 'Ambush');
    const fight = await t.create('event', 'Fight');
    await t.registry.run('event.createScene', { id: ambush });
    await t.registry.run('event.createScene', { id: fight, preset: 'battle' });
    withSmallMap(t);
    const keep = await fromMap(t);
    await t.materialize(keep);
    strip(t, ambush);
    const battle = strip(t, fight);
    battle.drawings = [];
    const imported = strip(t, keep);
    imported.drawings = [];
    await t.lifecycle.reconcile();
    expect(t.scene(ambush).flags.garn?.preset).toBe('narrative');
    expect(t.scene(fight).flags.garn?.preset).toBe('battle');
    expect(t.scene(keep).flags.garn?.preset).toBe('none');
  });

  it('v1’s Narrative box (its v1 rect, no `rect` flag) moves into the padding with its tokens', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    await present(t, ambush, 2);
    const live = strip(t, ambush);
    // As v1 wrote it: fixed rect, v1 look, tokens in its grid from the top left.
    const box = theBox(live);
    Object.assign(box, { x: 100, y: 100, shape: { type: 'r', width: 1000, height: 400 } });
    Object.assign(box, { fillColor: '#000000', locked: true, flags: { garn: { box: true } } });
    live.tokens.forEach((tk, i) => Object.assign(tk, { x: 150 + i * 100, y: 150 }));
    live.tokens.push({ _id: 'outside000000001', actorId: null, x: 2000, y: 2000, hidden: false });
    await t.lifecycle.reconcile();
    const moved = theBox(t.scene(ambush));
    expect(rect(moved)).toEqual([600, 500, 300, 200]);
    expect(moved).toMatchObject({ fillColor: '#ffffff', locked: false, text: 'Box' });
    expect(moved.flags.garn).toMatchObject({ rect: { x: 600, y: 500 } });
    expect(at(t.scene(ambush).tokens)).toEqual([
      [750, 550, true],
      [650, 550, true],
      [2000, 2000, false],
    ]);
    expect(t.scene(ambush).flags.garn?.preset).toBe('narrative');
    // Done once: a second load changes nothing.
    await t.lifecycle.reconcile();
    expect(rect(theBox(t.scene(ambush)))).toEqual([600, 500, 300, 200]);
  });
});
