import { describe, expect, it } from 'vitest';
import { must } from '../materialize/test-setup';
import { BOX } from './presets';
import { setup } from './test-setup';

const grid = (scene: Record<string, unknown>) => (scene['grid'] as { type: number }).type;

describe('Event Scenes: generated from the Preset (spec §4, §6 Immediate)', () => {
  it('Materializing an Event creates its Narrative Scene, linked both ways', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    const scene = t.scene(ambush);
    expect(scene.name).toBe('Ambush');
    expect(t.doc(ambush).flags.silk.scene).toBe(scene._id);
    expect(scene.tokenVision).toBe(false);
    expect(grid(scene)).toBe(0);
    expect(scene.drawings).toHaveLength(1);
  });

  it('the Narrative mood image is the Event image', async () => {
    const t = setup({ mode: 'onDemand' });
    const ambush = await t.create('event', 'Ambush');
    await t.registry.run('element.setImage', { id: ambush, img: 'mood.webp' });
    await t.materialize(ambush);
    expect(t.scene(ambush).background).toEqual({ src: 'mood.webp' });
  });

  it('Presets: Travel hex without vision, Battle square with vision and fog', async () => {
    const t = setup({ mode: 'onDemand' });
    const road = await t.create('event', 'Road');
    const fight = await t.create('event', 'Fight');
    await t.registry.run('event.createScene', { id: road, preset: 'travel' });
    await t.registry.run('event.createScene', { id: fight, preset: 'battle' });
    expect(t.element(road).uuid).toBeTruthy();
    expect(t.toasts.length).toBe(2);
    expect([grid(t.scene(road)), t.scene(road).tokenVision]).toEqual([2, false]);
    expect([grid(t.scene(fight)), t.scene(fight).tokenVision]).toEqual([1, true]);
    expect((t.scene(fight).fog as { mode: number }).mode).toBe(1);
    expect(t.element(fight).fields?.scenePreset).toBe('battle');
  });

  it('a Location gets an Overview Scene only on request, no grid or vision', async () => {
    const t = setup();
    const town = await t.create('location', 'Town');
    expect(t.eventScenes.sceneOf(town)).toBeUndefined();
    await expect(
      t.registry.run('event.createScene', { id: town, preset: 'battle' }),
    ).rejects.toThrow();
    await t.registry.run('event.createScene', { id: town });
    expect([grid(t.scene(town)), t.scene(town).tokenVision]).toEqual([0, false]);
    expect(t.doc(town).flags.silk.scene).toBe(t.scene(town)._id);
    const ambush = await t.create('event', 'Ambush');
    await expect(
      t.registry.run('event.createScene', { id: ambush, preset: 'overview' }),
    ).rejects.toThrow();
  });

  it('renaming the Event renames its Scene', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    await t.registry.run('element.rename', { id: ambush, name: 'Night ambush' });
    expect(t.scene(ambush).name).toBe('Night ambush');
  });
});

describe('Event Scenes: activation and Happened (spec §7)', () => {
  it('activating sets Happened once; after an undo, activating again keeps it undone', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    await t.registry.run('event.activateScene', { id: ambush });
    expect(t.scene(ambush).active).toBe(true);
    expect(t.element(ambush).status).toBe('happened');
    await t.registry.run('element.setStatus', { id: ambush, status: 'planned' });
    await t.registry.run('event.activateScene', { id: ambush });
    await t.eventScenes.sceneActivated(t.scene(ambush)._id);
    expect(t.element(ambush).status).toBeUndefined();
  });

  it('activation in Foundry (hook) sets Happened too; a skipped Event stays skipped', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    const feast = await t.create('event', 'Feast');
    await t.registry.run('element.setStatus', { id: feast, status: 'skipped' });
    await t.eventScenes.sceneActivated(t.scene(ambush)._id);
    await t.eventScenes.sceneActivated(t.scene(feast)._id);
    expect(t.element(ambush).status).toBe('happened');
    expect(t.element(feast).status).toBe('skipped');
  });

  it('activating a Ghost Event Materializes it implicitly (on demand)', async () => {
    const t = setup({ mode: 'onDemand' });
    const ambush = await t.create('event', 'Ambush');
    await t.registry.run('event.activateScene', { id: ambush });
    expect(t.toasts.some((m) => m.startsWith('Implicit'))).toBe(true);
    expect(t.scene(ambush).active).toBe(true);
    expect(t.element(ambush).status).toBe('happened');
  });

  it('an Overview Scene activates without Happened; view shows the Scene', async () => {
    const t = setup();
    const town = await t.create('location', 'Town');
    await t.registry.run('event.createScene', { id: town });
    await t.registry.run('event.activateScene', { id: town });
    expect(t.scene(town).active).toBe(true);
    await t.registry.run('event.viewScene', { id: town });
    expect(t.scenes.viewed).toEqual([t.scene(town)._id]);
  });
});

describe('present at ↔ tokens (spec §5, §7)', () => {
  it('creating present at adds one hidden token in the Narrative box', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    const alrik = await t.create('person', 'Alrik');
    await t.connect(alrik, ambush);
    const [token] = t.scene(ambush).tokens;
    expect(t.scene(ambush).tokens).toHaveLength(1);
    expect(token).toMatchObject({ actorId: t.actorId(alrik), hidden: true });
    const { x, y } = must(token);
    expect(x >= BOX.x && x < BOX.x + BOX.width && y >= BOX.y && y < BOX.y + BOX.height).toBe(true);
  });

  it('Battle/Travel stack the hidden tokens at the left edge', async () => {
    const t = setup({ mode: 'onDemand' });
    const fight = await t.create('event', 'Fight');
    await t.registry.run('event.createScene', { id: fight, preset: 'battle' });
    const wolf = await t.create('creature', 'Wolf');
    const bear = await t.create('creature', 'Bear');
    await t.materialize(wolf, bear);
    await t.connect(wolf, fight);
    await t.connect(bear, fight);
    expect(t.scene(fight).tokens.map((tk) => [tk.x, tk.y, tk.hidden])).toEqual([
      [0, 0, true],
      [0, 100, true],
    ]);
  });

  it('deleting present at removes all of the actor’s tokens, hidden or not', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    const alrik = await t.create('person', 'Alrik');
    const id = await t.connect(alrik, ambush);
    await t.scenes.createTokens(t.scene(ambush)._id, [
      { actorId: t.actorId(alrik), x: 500, y: 500, hidden: false },
    ]);
    await t.registry.run('connection.delete', { ids: [id] });
    expect(t.tokens(ambush)).toEqual([]);
  });

  it('a new Event made from a Person: the token comes when both are Materialized', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    const alrik = await t.create('person', 'Alrik', ambush);
    expect(t.presentAt(ambush)).toEqual([alrik]);
    expect(t.tokens(ambush)).toEqual([t.actorId(alrik)]);
  });

  it('on demand: present at with a Materialized Event Materializes the actor (toast)', async () => {
    const t = setup({ mode: 'onDemand' });
    const ambush = await t.create('event', 'Ambush');
    const alrik = await t.create('person', 'Alrik');
    await t.materialize(ambush);
    await t.connect(alrik, ambush);
    expect(t.element(alrik).uuid).toBeTruthy();
    expect(t.tokens(ambush)).toEqual([t.actorId(alrik)]);
  });

  it('on demand, in the Creation Pipeline: the implicit Materialize waits for the name', async () => {
    const t = setup({ mode: 'onDemand' });
    const ambush = await t.create('event', 'Ambush');
    await t.materialize(ambush);
    t.setDeferring(true);
    const alrik = await t.create('person', 'Alrik', ambush);
    expect(t.element(alrik).uuid).toBeUndefined();
    t.setDeferring(false);
    await t.eventScenes.afterPipeline(alrik);
    expect(t.tokens(ambush)).toEqual([t.actorId(alrik)]);
  });

  it('placing a token creates present at; removing the last one deletes it', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    const alrik = await t.create('person', 'Alrik');
    const sceneId = t.scene(ambush)._id;
    const actorId = t.actorId(alrik);
    await t.scenes.createTokens(sceneId, [
      { actorId, x: 0, y: 0, hidden: false },
      { actorId, x: 100, y: 0, hidden: false },
    ]);
    await t.eventScenes.tokenCreated({ sceneId, actorId });
    await t.eventScenes.tokenCreated({ sceneId, actorId });
    expect(t.presentAt(ambush)).toEqual([alrik]);
    const [first, second] = t.scene(ambush).tokens.map((tk) => tk._id);
    await t.scenes.deleteTokens(sceneId, [must(first)]);
    await t.eventScenes.tokenDeleted({ sceneId, actorId });
    expect(t.presentAt(ambush)).toEqual([alrik]);
    await t.scenes.deleteTokens(sceneId, [must(second)]);
    await t.eventScenes.tokenDeleted({ sceneId, actorId });
    expect(t.presentAt(ambush)).toEqual([]);
  });

  it('tokens on non-Event Scenes and of non-element actors are ignored', async () => {
    const t = setup();
    const town = await t.create('location', 'Town');
    await t.registry.run('event.createScene', { id: town });
    const alrik = await t.create('person', 'Alrik');
    const ambush = await t.create('event', 'Ambush');
    const before = t.workingCopy.records().size;
    await t.scenes.createTokens(t.scene(town)._id, [
      { actorId: t.actorId(alrik), x: 0, y: 0, hidden: false },
    ]);
    await t.eventScenes.tokenCreated({ sceneId: t.scene(town)._id, actorId: t.actorId(alrik) });
    await t.eventScenes.tokenCreated({ sceneId: t.scene(ambush)._id, actorId: 'stranger' });
    await t.eventScenes.tokenCreated({ sceneId: 'other', actorId: t.actorId(alrik) });
    expect(t.workingCopy.records().size).toBe(before);
  });
});

describe('Event Scenes follow the element lifecycle (spec §6)', () => {
  it('Unmaterialize snapshots the Scene incl. walls and tokens; Materialize restores it', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    const alrik = await t.create('person', 'Alrik');
    await t.connect(alrik, ambush);
    const sceneId = t.scene(ambush)._id;
    await t.scenes.update(sceneId, { walls: [{ _id: 'w1', c: [0, 0, 100, 0] }] });
    await t.registry.run('materialize.unmaterialize', { ids: [ambush] });
    expect(t.scenes.get(sceneId)).toBeUndefined();
    expect(t.presentAt(ambush)).toEqual([alrik]);
    expect(t.workingCopy.get(`${ambush}-scene`)?.kind).toBe('eventScene');
    await t.materialize(ambush);
    expect(t.scene(ambush)._id).toBe(sceneId);
    expect(t.scene(ambush).walls).toEqual([{ _id: 'w1', c: [0, 0, 100, 0] }]);
    expect(t.tokens(ambush)).toEqual([t.actorId(alrik)]);
    expect(t.doc(ambush).flags.silk.scene).toBe(sceneId);
  });

  it('Unmaterializing a present actor deletes its tokens; Materializing it adds one again', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    const alrik = await t.create('person', 'Alrik');
    await t.connect(alrik, ambush);
    await t.registry.run('materialize.unmaterialize', { ids: [alrik] });
    expect(t.tokens(ambush)).toEqual([]);
    expect(t.presentAt(ambush)).toEqual([alrik]);
    await t.materialize(alrik);
    expect(t.tokens(ambush)).toEqual([t.actorId(alrik)]);
  });

  it('Scene deleted in Foundry → "no Scene"; present at stays; Restore from last commit', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    const alrik = await t.create('person', 'Alrik');
    await t.connect(alrik, ambush);
    await t.commit('c1');
    const deleted = t.scene(ambush);
    await t.deleteSceneInFoundry(ambush);
    expect(t.doc(ambush).flags.silk.scene).toBeUndefined();
    expect(t.element(ambush).uuid).toBeTruthy();
    expect(t.presentAt(ambush)).toEqual([alrik]);
    await t.registry.run('event.restoreScene', { id: ambush });
    expect(t.scene(ambush)._id).toBe(deleted._id);
    expect(t.tokens(ambush)).toEqual([t.actorId(alrik)]);
    expect(t.doc(ambush).flags.silk.scene).toBe(deleted._id);
  });

  it('Create Scene after a deletion makes a fresh one; restore without a Commit fails', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    const deleted = t.scene(ambush);
    await t.deleteSceneInFoundry(ambush);
    await expect(t.registry.run('event.restoreScene', { id: ambush })).rejects.toThrow();
    await t.registry.run('event.createScene', { id: ambush });
    expect(t.scene(ambush)._id).not.toBe(deleted._id);
    await expect(t.registry.run('event.createScene', { id: ambush })).rejects.toThrow();
  });

  it('a Commit captures the Scene; deleting the Event deletes its Scene', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    await t.commit('c1');
    const record = t.workingCopy.get(`${ambush}-scene`);
    expect((record?.data as { scene: { name: string } }).scene.name).toBe('Ambush');
    expect((record?.data as { scene: object }).scene).not.toHaveProperty('ownership');
    await t.registry.run('element.delete', { ids: [ambush] });
    expect(t.scenes.all.size).toBe(0);
    expect(t.workingCopy.get(`${ambush}-scene`)).toBeUndefined();
  });

  it('reconcile: tokens decide present at; a vanished Scene clears the link', async () => {
    const t = setup();
    const ambush = await t.create('event', 'Ambush');
    const feast = await t.create('event', 'Feast');
    const alrik = await t.create('person', 'Alrik');
    const wolf = await t.create('creature', 'Wolf');
    await t.connect(wolf, ambush);
    // Missed hooks: Alrik's token placed, Wolf's removed, Feast's Scene deleted.
    const sceneId = t.scene(ambush)._id;
    await t.scenes.createTokens(sceneId, [
      { actorId: t.actorId(alrik), x: 0, y: 0, hidden: false },
    ]);
    await t.scenes.deleteTokens(
      sceneId,
      t
        .scene(ambush)
        .tokens.filter((tk) => tk.actorId === t.actorId(wolf))
        .map((tk) => tk._id),
    );
    t.scenes.all.delete(t.scene(feast)._id);
    await t.lifecycle.reconcile();
    expect(t.presentAt(ambush)).toEqual([alrik]);
    expect(t.doc(feast).flags.silk.scene).toBeUndefined();
  });
});
