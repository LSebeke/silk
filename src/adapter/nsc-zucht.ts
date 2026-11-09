/**
 * Source Step Generator: NSC Zucht, the NPC generator of `dsa5-mastersworkshop` (spec 1.1
 * §B.3). The module has no public API: Garn imports its `npcgenerator.js` the way the
 * module's own GM menu does, renders it, and takes the first NPC Actor the GM creates
 * while it is open (`createActor`). The import is guarded: a failure greys the choice.
 */
import type { SourcePick, SourceProvider, SourceRequest } from '../core/canvas/pipeline';
import type { Dsa5ActorType } from './dsa5';

export const NSC_ZUCHT_MODULE = 'dsa5-mastersworkshop';
const GENERATOR_PATH = `/modules/${NSC_ZUCHT_MODULE}/modules/npcgenerator.js`;

/** The generator window (an ApplicationV2). */
export interface GeneratorApp {
  render(force: boolean): unknown;
  close(): Promise<unknown>;
  addEventListener(type: 'close', listener: () => void, options?: { once?: boolean }): void;
}

/** A just-created Actor as the `createActor` hook passes it. */
export interface CreatedActor {
  uuid: string;
  name: string;
  type: string;
  /** Already a Garn doc (flagged at create): Materialize, not the generator, made it. */
  garn?: boolean;
}

export interface NscZuchtDeps {
  /** `game.modules.get('dsa5-mastersworkshop')?.active`. */
  active(): boolean;
  isGM(): boolean;
  /** Imports the generator and builds its window (what the module's GM menu does). */
  load(): Promise<GeneratorApp>;
  /** Checks the import works, without opening anything. */
  probe?(): Promise<void>;
  /** `Hooks.on('createActor')`; returns the unsubscribe. */
  onCreateActor(listener: (actor: CreatedActor, userId: string) => void): () => void;
  userId(): string;
  warn(message: string): void;
  localize(key: string): string;
}

export interface NscZucht extends SourceProvider {
  /** Guarded import at startup: greys the choice early if the module changed. */
  probe(): Promise<void>;
}

/** The NPC Actor type DSA5 uses for Persons. */
const NPC: Dsa5ActorType = 'npc';

export function createNscZucht(deps: NscZuchtDeps): NscZucht {
  let failed = false;

  function unavailable() {
    if (!deps.active()) return 'GARN.Source.GeneratorMissing';
    if (!deps.isGM()) return 'GARN.Source.GeneratorGMOnly';
    return failed ? 'GARN.Source.GeneratorFailed' : undefined;
  }

  /** The import failed: the choice greys from now on. */
  function importFailed(err: unknown) {
    failed = true;
    console.warn('Garn | NSC Zucht import failed', err);
  }

  async function open(): Promise<GeneratorApp | undefined> {
    try {
      return await deps.load();
    } catch (err) {
      importFailed(err);
      deps.warn(deps.localize('GARN.Source.GeneratorFailed'));
      return undefined;
    }
  }

  async function pick({ signal }: SourceRequest): Promise<SourcePick | undefined> {
    const app = await open();
    if (!app || signal.aborted) {
      void app?.close();
      return undefined;
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = (result: SourcePick | undefined) => {
        if (done) return;
        done = true;
        off();
        signal.removeEventListener('abort', onAbort);
        resolve(result);
        void app.close();
      };
      const onAbort = () => finish(undefined);
      const off = deps.onCreateActor((actor, userId) => {
        if (userId !== deps.userId() || actor.garn || actor.type !== NPC) return;
        finish({
          source: { kind: 'generator', id: 'nsc-zucht', actorUuid: actor.uuid },
          name: actor.name,
        });
      });
      signal.addEventListener('abort', onAbort, { once: true });
      app.addEventListener('close', () => finish(undefined), { once: true });
      app.render(true);
    });
  }

  return {
    unavailable,
    pick,
    async probe() {
      if (unavailable() || !deps.probe) return;
      await deps.probe().catch(importFailed);
    },
  };
}

interface FoundryActor {
  uuid: string;
  name: string;
  type: string;
  flags?: { garn?: { id?: unknown } };
}

type GeneratorModule = { default?: () => Promise<GeneratorApp> };

/** The real wiring: Foundry globals and the module's file. */
export function foundryNscZucht(localize: (key: string) => string): NscZucht {
  let imported: Promise<GeneratorModule> | undefined;
  const importModule = async () => {
    imported ??= import(/* @vite-ignore */ GENERATOR_PATH) as Promise<GeneratorModule>;
    const mod = await imported.catch((err: unknown) => {
      imported = undefined;
      throw err;
    });
    if (typeof mod.default !== 'function')
      throw new Error('Garn: npcgenerator.js has no default getInstance()');
    return mod.default;
  };
  return createNscZucht({
    active: () => !!game.modules?.get(NSC_ZUCHT_MODULE)?.active,
    isGM: () => !!game.user?.isGM,
    async probe() {
      await importModule();
    },
    async load() {
      const getInstance = await importModule();
      // As the module's GM menu: the generator reads the equipment index.
      const dsa5 = (
        game as unknown as { dsa5?: { itemLibrary?: { buildEquipmentIndex?(): Promise<unknown> } } }
      ).dsa5;
      await dsa5?.itemLibrary?.buildEquipmentIndex?.();
      return getInstance();
    },
    onCreateActor(listener) {
      const onCreate = (actor: FoundryActor, _options: unknown, userId: string) =>
        listener(
          { uuid: actor.uuid, name: actor.name, type: actor.type, garn: !!actor.flags?.garn?.id },
          userId,
        );
      const id = Hooks.on('createActor', onCreate as never);
      return () => Hooks.off('createActor', id);
    },
    userId: () => game.user?.id ?? '',
    warn: (message) => ui.notifications?.warn(message),
    localize,
  });
}
