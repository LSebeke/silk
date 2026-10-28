/**
 * Foundry side of Adopt (spec §6 Adopt): the ways in (sidebar and folder context menus,
 * sheet header, dsa5 inventory item menu; canvas drops live in the canvas), copied-id
 * stripping on create, the prompts, and `AdoptFoundry` over the running Foundry.
 * Thin: decisions live in `src/core/adopt`. Hooks fire on every client; menus are GM only,
 * create reactions run on the active GM and skip Silk's own writes.
 */
import type { Adopt, AdoptFolder, AdHocDoc, AdoptFoundry, UseForAnswer } from '../core/adopt';
import type { PipelineOrigin } from '../core/canvas';
import type { ElementClassId, Point } from '../core/elements';
import { snapshot, type FoundryDoc } from './foundry-docs';
import { SILK_WRITE, isSilkWrite } from './working-copy-journal';

const ICON = 'fa-solid fa-diagram-project';
/** Docs Adopt accepts (§6 Class inference). */
const ADOPTABLE = ['Actor', 'Item', 'JournalEntry', 'Scene'] as const;

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fail = (error: unknown) => console.error(error);

export interface StarterDeps {
  inspect: Adopt['inspect'];
  importFromCompendium(uuid: string): Promise<string>;
  run(name: string, args?: object): Promise<unknown>;
  pipeline: {
    open(origin: PipelineOrigin): void;
    create(origin: PipelineOrigin, id: ElementClassId): Promise<string>;
  };
  /** Canvas viewport centre (after `canvas.open`). */
  center(): Point;
  /** Inventory item: "Also adopt *actor*?" — `null` cancels. */
  askAlsoActor(actorName: string): Promise<boolean | null>;
  error(message: string): void;
  localize(key: string, data?: Record<string, string>): string;
}

export interface StartOptions {
  /** Drop point (canvas coordinates). */
  at?: Point;
  /** Class box anchor (window-local pixels). */
  anchor?: Point;
  /** Dropped onto this Node. */
  connectTo?: string;
}

/**
 * Every single Adopt starts here and ends in the Creation Pipeline with class and name
 * pre-filled (§6 Ways in): inferred class → name step; ambiguous → class box.
 */
export function createAdoptStarter(deps: StarterDeps) {
  return async function start(uuid: string, options: StartOptions = {}): Promise<void> {
    const worldUuid = uuid.startsWith('Compendium.') ? await deps.importFromCompendium(uuid) : uuid;
    const info = deps.inspect(worldUuid);
    if (!info) throw new Error(deps.localize('SILK.Adopt.Missing', { uuid }));
    if (info.existing) {
      // Selects and flashes its Node.
      await deps.run('canvas.open', {});
      await deps.run('adopt.doc', { uuid: worldUuid });
      return;
    }
    if ('refused' in info.inference) {
      deps.error(deps.localize('SILK.Adopt.Refused', { name: info.name }));
      return;
    }
    let alsoAdoptActor: boolean | undefined;
    if (info.embedded) {
      const answer = await deps.askAlsoActor(info.embedded.actorName);
      if (answer === null) return;
      alsoAdoptActor = answer;
    }
    await deps.run('canvas.open', {});
    const at = options.at ?? deps.center();
    const classes = 'class' in info.inference ? [info.inference.class] : info.inference.choices;
    const origin: PipelineOrigin = {
      at,
      ...(options.anchor ? { anchor: options.anchor } : {}),
      adopt: {
        uuid: worldUuid,
        classes,
        ...(options.connectTo ? { connectTo: options.connectTo } : {}),
        ...(alsoAdoptActor !== undefined ? { alsoAdoptActor } : {}),
      },
    };
    if ('class' in info.inference) await deps.pipeline.create(origin, info.inference.class);
    else deps.pipeline.open(origin);
  };
}

interface MenuEntry {
  label: string;
  icon: string;
  visible?: boolean | ((target: HTMLElement) => boolean);
  onClick: (event: Event, target: HTMLElement) => unknown;
}

interface HeaderControl {
  action: string;
  icon: string;
  label: string;
  onClick: () => unknown;
}

export interface AdoptHookDeps {
  on(hook: string, fn: (...args: unknown[]) => void): void;
  isGM(): boolean;
  isActiveGM(): boolean;
  start(uuid: string): Promise<void>;
  run(name: string, args: object): Promise<unknown>;
  /** The doc is a Story Element already (no "Adopt into Silk" entry). */
  isStoryElement(uuid: string): boolean;
  /** Folder type (`Actor`, …) by folder id. */
  folderType(id: string): string | undefined;
  docCreated: Adopt['docCreated'];
  error(message: string): void;
}

export function registerAdoptHooks(deps: AdoptHookDeps): void {
  const report = (error: unknown) =>
    deps.error(error instanceof Error ? error.message : String(error));
  const start = (uuid: string) => void deps.start(uuid).catch(report);

  // Sidebar context menus: "Adopt into Silk".
  for (const name of ADOPTABLE)
    deps.on(`get${name}ContextOptions`, (_app, options) => {
      const uuidOf = (li: HTMLElement) => {
        const id = li.closest<HTMLElement>('[data-entry-id]')?.dataset['entryId'];
        return id ? `${name}.${id}` : undefined;
      };
      (options as MenuEntry[]).push({
        label: 'SILK.Adopt.Adopt',
        icon: ICON,
        visible: (li) => {
          const uuid = uuidOf(li);
          return deps.isGM() && !!uuid && !deps.isStoryElement(uuid);
        },
        onClick: (_event, li) => {
          const uuid = uuidOf(li);
          if (uuid) start(uuid);
        },
      });
    });

  // Folder context menu: "Adopt folder into Silk" (bulk, one confirmation).
  deps.on('getFolderContextOptions', (_app, options) => {
    const folderOf = (header: HTMLElement) => {
      const uuid = header.closest<HTMLElement>('.directory-item')?.dataset['uuid'];
      return uuid?.startsWith('Folder.') ? uuid.slice('Folder.'.length) : undefined;
    };
    (options as MenuEntry[]).push({
      label: 'SILK.Adopt.AdoptFolder',
      icon: ICON,
      visible: (header) => {
        const id = folderOf(header);
        const type = id ? deps.folderType(id) : undefined;
        return deps.isGM() && !!type && (ADOPTABLE as readonly string[]).includes(type);
      },
      onClick: (_event, header) => {
        const folderId = folderOf(header);
        if (folderId) void deps.run('adopt.folder', { folderId }).catch(report);
      },
    });
  });

  // Sheet header (journals, dsa5 actor/item sheets, Scene config are DocumentSheetV2).
  deps.on('getHeaderControlsDocumentSheetV2', (app, controls) => {
    const doc = (app as { document?: { documentName?: string; uuid?: string; pack?: unknown } })
      .document;
    if (!deps.isGM() || !doc?.uuid || doc.pack) return;
    if (!(ADOPTABLE as readonly string[]).includes(doc.documentName ?? '')) return;
    if (deps.isStoryElement(doc.uuid)) return;
    const uuid = doc.uuid;
    (controls as HeaderControl[]).push({
      action: 'silkAdopt',
      icon: ICON,
      label: 'SILK.Adopt.Adopt',
      onClick: () => start(uuid),
    });
  });

  // dsa5 inventory item context menus (actor sheet).
  for (const hook of ['dsa5.getItemContextOptions', 'dsa5.getWeaponItemContextOptions'])
    deps.on(hook, (item, items) => {
      const uuid = (item as { uuid?: string }).uuid;
      if (!deps.isGM() || !uuid || deps.isStoryElement(uuid)) return;
      (items as MenuEntry[]).push({
        label: 'SILK.Adopt.Adopt',
        icon: `<i class="${ICON} fa-fw"></i>`,
        onClick: () => start(uuid),
      });
    });

  // Copied Silk ids are stripped (§6 Duplicates). Items: owns (T12) handles their copies.
  for (const name of ['Actor', 'JournalEntry', 'Scene'])
    deps.on(`create${name}`, (doc, options) => {
      if (!deps.isActiveGM() || isSilkWrite(options)) return;
      const snap =
        name === 'Scene'
          ? sceneSnapshot(doc as { id: string | null; toObject(): object })
          : snapshot(doc as FoundryDoc);
      if (snap) deps.docCreated(snap).catch(fail);
    });
}

function sceneSnapshot(scene: { id: string | null; toObject(): object }) {
  const data = scene.toObject() as { flags?: { silk?: object } };
  if (!scene.id) return undefined;
  return {
    uuid: `Scene.${scene.id}`,
    documentName: 'Scene',
    flags: { silk: { ...data.flags?.silk } },
  };
}

type Wait = (config: {
  window: { title: string };
  content: string;
  buttons: { action: string; label: string; default?: boolean; callback?: () => unknown }[];
  rejectClose: boolean;
  render?: (event: Event, dialog: { element: HTMLElement; close(): unknown }) => void;
}) => Promise<unknown>;

/** The Adopt prompts (§6). */
export function adoptDialogs(deps: {
  wait: Wait;
  localize(key: string, data?: Record<string, string>): string;
}) {
  const L = (key: string, data?: Record<string, string>) =>
    deps.localize(`SILK.Adopt.${key}`, data);
  return {
    async chooseUseFor(args: { doc: string; element: string }): Promise<UseForAnswer> {
      const result = await deps.wait({
        window: { title: L('DuplicateTitle') },
        content: `<p>${L('DuplicateSource', { doc: `<b>${escape(args.doc)}</b>`, element: `<b>${escape(args.element)}</b>` })}</p>`,
        buttons: [
          {
            action: 'use',
            label: L('UseFor', { element: args.element }),
            default: true,
            callback: () => 'use',
          },
          { action: 'new', label: L('CreateNew'), callback: () => 'new' },
        ],
        rejectClose: false,
      });
      return result === 'use' || result === 'new' ? result : null;
    },

    async confirmFolder(rows: { name: string; class: string }[]): Promise<boolean> {
      const list = rows
        .map((r) => `<li><b>${escape(r.name)}</b> · ${escape(r.class)}</li>`)
        .join('');
      const result = await deps.wait({
        window: { title: L('FolderTitle') },
        content: `<p>${L('FolderConfirm', { count: String(rows.length) })}</p><ul data-silk-adopt-rows>${list}</ul>`,
        buttons: [
          { action: 'adopt', label: L('Adopt'), default: true, callback: () => true },
          { action: 'cancel', label: L('Cancel'), callback: () => false },
        ],
        rejectClose: false,
      });
      return result === true;
    },

    async askAlsoActor(actorName: string): Promise<boolean | null> {
      const result = await deps.wait({
        window: { title: L('Adopt') },
        content: `<p>${L('AlsoActor', { actor: `<b>${escape(actorName)}</b>` })}</p>`,
        buttons: [
          { action: 'yes', label: L('Yes'), default: true, callback: () => true },
          { action: 'no', label: L('No'), callback: () => false },
        ],
        rejectClose: false,
      });
      return typeof result === 'boolean' ? result : null;
    },

    /** End Play Session: rows with Adopt / Ignore (§6 Ad-hoc docs). Doesn't block. */
    showAdHoc(
      rows: AdHocDoc[],
      actions: { adopt(uuid: string): Promise<void>; ignore(uuid: string): Promise<unknown> },
    ): void {
      const list = rows
        .map(
          (r) =>
            `<li data-silk-adhoc="${escape(r.uuid)}"><span>${escape(r.name)}</span> ` +
            `<span class="muted">${escape(r.documentName)}</span> ` +
            `<button type="button" data-silk-adhoc-adopt>${L('Adopt')}</button>` +
            `<button type="button" data-silk-adhoc-ignore>${L('Ignore')}</button></li>`,
        )
        .join('');
      void deps
        .wait({
          window: { title: L('AdHocTitle') },
          content: `<p>${L('AdHocIntro')}</p><ul class="silk-adhoc" data-silk-adhoc-list>${list}</ul>`,
          buttons: [{ action: 'close', label: L('Close'), default: true }],
          rejectClose: false,
          render: (_event, dialog) => {
            for (const li of dialog.element.querySelectorAll<HTMLElement>('[data-silk-adhoc]')) {
              const uuid = li.dataset['silkAdhoc'] ?? '';
              const done = (job: Promise<unknown>) =>
                job.then(() => li.remove()).catch((error: unknown) => console.error(error));
              li.querySelector('[data-silk-adhoc-adopt]')?.addEventListener('click', () => {
                void dialog.close();
                void actions.adopt(uuid).catch(fail);
              });
              li.querySelector('[data-silk-adhoc-ignore]')?.addEventListener('click', () =>
                done(actions.ignore(uuid)),
              );
            }
          },
        })
        .catch(fail);
    },
  };
}

interface FoundryFolder {
  id: string | null;
  name: string;
  type: string;
  contents: { uuid: string }[];
  getSubfolders(recursive?: boolean): FoundryFolder[];
}

interface WorldDocument {
  uuid: string;
  name: string;
  documentName: string;
  flags: { silk?: object };
  _stats?: { createdTime?: number | null };
}

/** `AdoptFoundry` over the running Foundry. Globals are read lazily, per call. */
export function foundryAdopt(): AdoptFoundry {
  const tree = (folder: FoundryFolder): AdoptFolder => ({
    id: folder.id ?? '',
    name: folder.name,
    docs: folder.contents.map((d) => d.uuid),
    children: folder.getSubfolders(false).map(tree),
  });
  return {
    async importFromCompendium(uuid) {
      const source = (await fromUuid(uuid)) as unknown as {
        id: string;
        pack: string;
        documentName: string;
      } | null;
      const pack = source ? game.packs?.get(source.pack) : undefined;
      const collection = source
        ? (game.collections?.get(source.documentName as never) as unknown as {
            importFromCompendium(
              pack: unknown,
              id: string,
              data: object,
              options: object,
            ): Promise<{ uuid: string }>;
          })
        : undefined;
      if (!source || !pack || !collection) throw new Error(`Silk: no compendium entry "${uuid}"`);
      // A fresh copy (no id clash with a Story Element's doc); Silk's own hooks skip it.
      const doc = await collection.importFromCompendium(
        pack,
        source.id,
        {},
        {
          keepId: false,
          ...SILK_WRITE,
        },
      );
      return doc.uuid;
    },
    folder(id) {
      const folder = game.folders?.get(id) as unknown as FoundryFolder | undefined;
      return folder ? tree(folder) : undefined;
    },
    worldDocs() {
      const collections = [
        game.actors,
        game.items,
        game.journal,
        game.scenes,
      ] as unknown as Iterable<WorldDocument>[];
      return collections.flatMap((collection) =>
        [...(collection ?? [])].map((d) => ({
          uuid: d.uuid,
          name: d.name,
          documentName: d.documentName,
          createdTime: d._stats?.createdTime ?? 0,
          flags: { silk: { ...d.flags.silk } },
        })),
      );
    },
    isPlayer(userId) {
      const user = game.users?.get(userId);
      return !!user && !user.isGM;
    },
  };
}
