import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasCoreCommands, createCanvasState } from '../canvas';
import { setup as revealSetup } from '../reveal/test-setup';
import { parsePlayerView, type PlayerView } from './player-view';
import { createPlayerViewPublisher } from './publisher';

const DELAY = 250;

function setup() {
  const t = revealSetup();
  for (const command of canvasCoreCommands({
    workingCopy: () => t.workingCopy,
    state: createCanvasState(),
  }))
    t.registry.register(command);
  let stored: unknown = {};
  const writes: PlayerView[] = [];
  const publisher = createPlayerViewPublisher({
    workingCopy: () => t.workingCopy,
    reveal: t.reveal,
    frozen: () => !t.reveal.available(),
    current: () => stored,
    write: async (view) => {
      writes.push(view);
      stored = JSON.parse(JSON.stringify(view));
    },
    delay: DELAY,
  });
  const materialized = async (cls: string, name: string) => {
    const id = await t.create(cls, name);
    await t.run('materialize.elements', { ids: [id] });
    return id;
  };
  const settle = async () => {
    await t.reveal.idle();
    await vi.advanceTimersByTimeAsync(DELAY + 10);
  };
  return { ...t, publisher, writes, stored: () => parsePlayerView(stored), materialized, settle };
}

describe('Player View publisher (spec §9: active GM writes it on Reveal or move)', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('writes the Revealed Nodes on Reveal, once per burst (debounced)', async () => {
    const t = setup();
    const a = await t.materialized('person', 'Alrik');
    const b = await t.materialized('location', 'Gareth');
    t.publisher.start();
    await t.settle();
    t.writes.length = 0;

    await t.run('reveal.element', { id: a });
    await t.run('reveal.element', { id: b });
    await t.settle();

    expect(t.writes).toHaveLength(1);
    expect(
      t
        .stored()
        .nodes.map((n) => n.id)
        .sort(),
    ).toEqual([a, b].sort());
  });

  it('follows moves of Revealed Nodes and Revealed Connections', async () => {
    const t = setup();
    const a = await t.materialized('person', 'Alrik');
    const b = await t.materialized('location', 'Gareth');
    const c = await t.connect(a, b, 'lives in');
    t.publisher.start();
    await t.run('reveal.connection', { id: c });
    await t.settle();
    expect(t.stored().connections.map((x) => x.label)).toEqual(['lives in']);

    await t.run('canvas.moveNodes', { moves: [{ id: a, x: 123, y: 456 }] });
    await t.settle();
    expect(t.stored().nodes.find((n) => n.id === a)).toMatchObject({ x: 123, y: 456 });
  });

  it('skips writes that would not change the stored view', async () => {
    const t = setup();
    const a = await t.materialized('person', 'Alrik');
    const hidden = await t.materialized('person', 'Spy');
    t.publisher.start();
    await t.run('reveal.element', { id: a });
    await t.settle();
    t.writes.length = 0;

    await t.run('canvas.moveNodes', { moves: [{ id: hidden, x: 9, y: 9 }] });
    await t.settle();
    expect(t.writes).toEqual([]);
  });

  it('is frozen under the main Checkout (no Adventure)', async () => {
    const t = setup();
    const a = await t.materialized('person', 'Alrik');
    t.publisher.start();
    await t.run('reveal.element', { id: a });
    await t.settle();
    const before = t.stored();

    t.setCampaign(null);
    await t.run('canvas.moveNodes', { moves: [{ id: a, x: 500, y: 500 }] });
    await t.settle();
    expect(t.stored()).toEqual(before);
  });

  it('stops following after the returned unsubscribe', async () => {
    const t = setup();
    const a = await t.materialized('person', 'Alrik');
    const stop = t.publisher.start();
    await t.settle();
    t.writes.length = 0;
    stop();
    await t.run('reveal.element', { id: a });
    await t.settle();
    expect(t.writes).toEqual([]);
  });
});
