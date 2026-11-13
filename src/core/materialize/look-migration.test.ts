import { describe, expect, it, vi } from 'vitest';
import { lookWriter } from '../portrait';
import { lookMigration } from './look-migration';
import { setup } from './test-setup';

type Ringed = { prototypeToken: { texture: Record<string, unknown>; ring: { enabled: boolean } } };

describe('Round 2 look migration on the first GM load (v1.1 §G.3.2)', () => {
  async function world(writeFails = false) {
    const t = setup({ mode: 'immediate' });
    const id = await t.create('creature', 'Wolf');
    const doc = t.doc(id) as ReturnType<typeof t.doc> & Ringed;
    // Round 2: ring on, fit cover, the pose as texture scale and anchor, no subject file.
    doc.prototypeToken = {
      texture: { src: 'wolf.webp', fit: 'cover', anchorX: 0.4, scaleX: 1.5, scaleY: 1.5 },
      ring: { enabled: true },
    };
    (doc as { system?: unknown }).system = { status: { size: { value: 'small' } } };
    let done = false;
    const sweep = lookMigration({
      workingCopy: () => t.workingCopy,
      materializer: t.materializer,
      system: { sizeFactor: () => 0.8 },
      writeLook: writeFails
        ? async () => {
            throw new Error('upload refused');
          }
        : lookWriter(t.look, (u, d) => t.docs.update(u, d)),
      done: () => done,
      markDone: async () => void (done = true),
    });
    return { t, id, doc, sweep, isDone: () => done };
  }

  it('one sweep over every Garn actor: subject file built, prototype scale 1, tokens the size factor', async () => {
    const { t, id, sweep, isDone } = await world();
    t.tokens.length = 0;
    await sweep.reconcile?.();
    const doc = t.doc(id) as ReturnType<typeof t.doc> & Ringed;
    expect(t.subjects.map((s) => s.spec.pose)).toEqual([
      { anchorX: 0.4, anchorY: 0.5, scale: 1.5 },
    ]);
    expect(doc.prototypeToken.texture).toMatchObject({ fit: 'contain', anchorX: 0.5, scaleX: 1 });
    expect(doc.flags.garn.pose).toEqual({ anchorX: 0.4, anchorY: 0.5, scale: 1.5 });
    expect(t.tokens.at(-1)?.data).toMatchObject({ 'texture.scaleX': 0.8, 'texture.scaleY': 0.8 });
    expect(isDone()).toBe(true);
  });

  it('marked done: later loads never check again', async () => {
    const { t, sweep } = await world();
    await sweep.reconcile?.();
    const subjects = t.subjects.length;
    await sweep.reconcile?.();
    expect(t.subjects.length).toBe(subjects);
  });

  it('an actor that fails leaves the sweep pending for the next load; the load goes on', async () => {
    const { sweep, isDone } = await world(true);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await sweep.reconcile?.();
    expect(isDone()).toBe(false);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
