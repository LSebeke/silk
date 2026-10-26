import { describe, expect, it } from 'vitest';
import type { CanonRecord, JsonObject } from '../canon';
import { createDocRewriter } from '../materialize';
import { must } from '../materialize/test-setup';
import { eventSceneId, type EventSceneData } from './event-scenes';
import { setup } from './test-setup';

/** An Event with a Scene, Alrik present (one token), committed. */
async function brawl() {
  const t = setup();
  const event = await t.create('event', 'Brawl');
  const alrik = await t.create('person', 'Alrik');
  await t.connect(alrik, event);
  await t.commit('h1');
  const rewriter = createDocRewriter({
    workingCopy: () => t.workingCopy,
    docs: t.docs,
    materializer: t.materializer,
    lifecycle: t.lifecycle,
    scenes: t.eventScenes,
  });
  return { ...t, event, alrik, rewriter };
}

/** The working copy with the Event Scene record's Scene edited. */
function withScene(
  t: Awaited<ReturnType<typeof brawl>>,
  edit: (scene: EventSceneData['scene']) => void,
) {
  const result = new Map(t.workingCopy.records());
  const record = must(result.get(eventSceneId(t.event)));
  const data = structuredClone(record.data) as unknown as EventSceneData;
  edit(data.scene);
  result.set(record.id, { ...record, data: data as unknown as JsonObject } as CanonRecord);
  return result;
}

describe('rewriting Event Scenes to a merge result (spec §11.3, §11.4)', () => {
  it('tokens by id, walls and lights, and Scene fields follow the result', async () => {
    const t = await brawl();
    const token = must(t.scene(t.event).tokens[0]);
    const result = withScene(t, (scene) => {
      scene.tokens = [{ ...token, x: 777, y: 555 }];
      scene.walls = [{ _id: 'wall1', c: [0, 0, 100, 0] }];
      scene['lights'] = [{ _id: 'light1', x: 5, y: 5 }];
      scene.drawings = [];
      scene['navName'] = 'The Brawl';
    });

    await t.rewriter.apply(result);

    const scene = t.scene(t.event);
    expect(scene.tokens).toEqual([expect.objectContaining({ _id: token._id, x: 777, y: 555 })]);
    expect(scene.walls).toEqual([{ _id: 'wall1', c: [0, 0, 100, 0] }]);
    expect(scene['lights']).toEqual([{ _id: 'light1', x: 5, y: 5 }]);
    expect(scene.drawings).toEqual([]);
    expect(scene['navName']).toBe('The Brawl');
    expect(t.presentAt(t.event)).toEqual([t.alrik]);
  });

  it('a token the result drops goes', async () => {
    const t = await brawl();
    const result = withScene(t, (scene) => {
      scene.tokens = [];
    });

    await t.rewriter.apply(result);

    expect(t.scene(t.event).tokens).toEqual([]);
  });

  it('the Scene of an Event the result drops is deleted', async () => {
    const t = await brawl();
    const sceneId = t.scene(t.event)._id;
    const result = new Map(t.workingCopy.records());
    result.delete(t.event);
    result.delete(eventSceneId(t.event));
    for (const [id, r] of result) if (r.kind === 'connection') result.delete(id);

    await t.rewriter.apply(result);

    expect(t.scenes.all.has(sceneId)).toBe(false);
  });
});
