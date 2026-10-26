import { describe, expect, it } from 'vitest';
import type { Adopt, Inference } from '../core/adopt';
import type { PipelineOrigin } from '../core/canvas';
import { createAdoptStarter, registerAdoptHooks } from './adopt';

function starter(info: ReturnType<Adopt['inspect']>, answers: { alsoActor?: boolean | null } = {}) {
  const runs: [string, object | undefined][] = [];
  const opened: PipelineOrigin[] = [];
  const created: [PipelineOrigin, string][] = [];
  const errors: string[] = [];
  const imported: string[] = [];
  const start = createAdoptStarter({
    inspect: () => info,
    importFromCompendium: async (uuid) => {
      imported.push(uuid);
      return 'Actor.copy';
    },
    run: async (name, args) => void runs.push([name, args]),
    pipeline: {
      open: (origin) => void opened.push(origin),
      create: async (origin, id) => {
        created.push([origin, id]);
        return 'el';
      },
    },
    center: () => ({ x: 5, y: 6 }),
    askAlsoActor: async () => answers.alsoActor ?? null,
    error: (message) => void errors.push(message),
    localize: (key) => key,
  });
  return { start, runs, opened, created, errors, imported };
}

const inferred = (inference: Inference, extra: object = {}) => ({ name: 'X', inference, ...extra });

describe('Adopt ways in end in the Creation Pipeline (spec §6)', () => {
  it('an inferred class goes straight to the name step at the viewport centre', async () => {
    const t = starter(inferred({ class: 'person' }));
    await t.start('Actor.a');
    expect(t.runs).toEqual([['canvas.open', {}]]);
    expect(t.created).toEqual([
      [{ at: { x: 5, y: 6 }, adopt: { uuid: 'Actor.a', classes: ['person'] } }, 'person'],
    ]);
  });

  it('a choice opens the class box at the drop point, connected to the Node dropped on', async () => {
    const t = starter(inferred({ choices: ['note', 'location'] }));
    await t.start('JournalEntry.j', { at: { x: 1, y: 2 }, connectTo: 'n1' });
    expect(t.opened).toEqual([
      {
        at: { x: 1, y: 2 },
        adopt: { uuid: 'JournalEntry.j', classes: ['note', 'location'], connectTo: 'n1' },
      },
    ]);
  });

  it('refused docs toast; Story Elements are selected via adopt.doc', async () => {
    const refused = starter(inferred({ refused: true }));
    await refused.start('Actor.g');
    expect(refused.errors).toEqual(['SILK.Adopt.Refused']);
    const existing = starter(inferred({ class: 'person' }, { existing: 'el1' }));
    await existing.start('Actor.a');
    expect(existing.runs).toEqual([
      ['canvas.open', {}],
      ['adopt.doc', { uuid: 'Actor.a' }],
    ]);
  });

  it('inventory items ask "also adopt actor?" (cancel stops)', async () => {
    const embedded = { embedded: { actor: 'Actor.a', actorName: 'Alrik' } };
    const yes = starter(inferred({ class: 'item' }, embedded), { alsoActor: true });
    await yes.start('Actor.a.Item.i');
    expect(yes.created[0]?.[0].adopt?.alsoAdoptActor).toBe(true);
    const cancel = starter(inferred({ class: 'item' }, embedded), { alsoActor: null });
    await cancel.start('Actor.a.Item.i');
    expect(cancel.created).toEqual([]);
  });

  it('compendium entries are imported first', async () => {
    const t = starter(inferred({ class: 'person' }));
    await t.start('Compendium.p.Actor.x');
    expect(t.imported).toEqual(['Compendium.p.Actor.x']);
    expect(t.created[0]?.[0].adopt?.uuid).toBe('Actor.copy');
  });
});

describe('Adopt hooks', () => {
  function hooks(opts: { gm?: boolean; element?: boolean } = {}) {
    const fns = new Map<string, (...args: unknown[]) => void>();
    const started: string[] = [];
    const runs: [string, object][] = [];
    const created: string[] = [];
    registerAdoptHooks({
      on: (name, fn) => fns.set(name, fn),
      isGM: () => opts.gm ?? true,
      isActiveGM: () => opts.gm ?? true,
      start: async (uuid) => void started.push(uuid),
      run: async (name, args) => void runs.push([name, args]),
      isStoryElement: () => opts.element ?? false,
      folderType: () => 'Actor',
      docCreated: async (doc) => void created.push(doc.uuid),
      error: () => {},
    });
    const fire = (name: string, ...args: unknown[]) => fns.get(name)?.(...args);
    return { fns, fire, started, runs, created };
  }
  const li = (attrs: Record<string, string>) => {
    const el = { dataset: attrs, closest: () => el } as unknown as HTMLElement;
    return el;
  };
  interface Entry {
    label: string;
    visible?: (el: HTMLElement) => boolean;
    onClick: (e: Event, el: HTMLElement) => void;
  }

  it('adds "Adopt into Silk" to sidebar entries of Actors, Items, Journals and Scenes', () => {
    const t = hooks();
    for (const name of ['Actor', 'Item', 'JournalEntry', 'Scene']) {
      const options: Entry[] = [];
      t.fire(`get${name}ContextOptions`, {}, options);
      const entry = options[0] as Entry;
      expect(entry.label).toBe('SILK.Adopt.Adopt');
      expect(entry.visible?.(li({ entryId: 'x1' }))).toBe(true);
      entry.onClick(new Event('click'), li({ entryId: 'x1' }));
    }
    expect(t.started).toEqual(['Actor.x1', 'Item.x1', 'JournalEntry.x1', 'Scene.x1']);
  });

  it('hides it for Story Elements and players', () => {
    for (const opts of [{ element: true }, { gm: false }]) {
      const options: Entry[] = [];
      hooks(opts).fire('getActorContextOptions', {}, options);
      expect(options[0]?.visible?.(li({ entryId: 'x1' }))).toBe(false);
    }
  });

  it('folder menu runs adopt.folder; sheet header and inventory menu start an Adopt', () => {
    const t = hooks();
    const folder: Entry[] = [];
    t.fire('getFolderContextOptions', {}, folder);
    folder[0]?.onClick(new Event('click'), li({ uuid: 'Folder.f1' }));
    expect(t.runs).toEqual([['adopt.folder', { folderId: 'f1' }]]);

    const controls: { onClick(): void }[] = [];
    t.fire(
      'getHeaderControlsDocumentSheetV2',
      { document: { documentName: 'Actor', uuid: 'Actor.a' } },
      controls,
    );
    controls[0]?.onClick();
    const items: Entry[] = [];
    t.fire('dsa5.getItemContextOptions', { uuid: 'Actor.a.Item.i' }, items);
    items[0]?.onClick(new Event('click'), li({}));
    expect(t.started).toEqual(['Actor.a', 'Actor.a.Item.i']);
  });

  it('hands docs created in Foundry to the duplicate check, not Silk’s own', () => {
    const t = hooks();
    const doc = {
      uuid: 'Actor.c',
      documentName: 'Actor',
      toObject: () => ({ flags: { silk: { id: 'e' } } }),
    };
    t.fire('createActor', doc, {});
    t.fire('createActor', doc, { silk: { internal: true } });
    t.fire('createScene', { id: 's1', toObject: () => ({ flags: {} }) }, {});
    expect(t.created).toEqual(['Actor.c', 'Scene.s1']);
  });
});
