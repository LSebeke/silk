/**
 * Foundry side of Reveal (spec §8): placed tokens, the forced Show popup, Silk header
 * buttons on journal and actor/item sheets, and flow-back of hand edits that undo the hood.
 */
import { MODULE_ID } from '../constants';
import type { Reveal, RevealStage } from '../core/reveal';
import { SILK_WRITE, isSilkWrite } from './working-copy-journal';

interface TokenLike {
  id: string | null;
  actorId: string | null;
}

const getPath = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);

/** Update data for the actor's placed tokens that differ from `data` (dotted keys). Pure. */
export function tokenUpdates(
  tokens: Iterable<TokenLike>,
  actorId: string,
  data: Record<string, unknown>,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const token of tokens) {
    if (token.actorId !== actorId || !token.id) continue;
    if (Object.entries(data).every(([k, v]) => getPath(token, k) === v)) continue;
    out.push({ _id: token.id, ...data });
  }
  return out;
}

type Scene = {
  tokens: Iterable<TokenLike>;
  updateEmbeddedDocuments(name: string, data: object[], options?: object): Promise<unknown>;
};

export function foundryRevealStage(): RevealStage {
  return {
    async updateTokens(actorUuid, data) {
      const actor = fromUuidSync(actorUuid) as { id?: string; parent?: unknown } | null;
      // Embedded Items have no tokens; only world Actors.
      if (!actor?.id || actor.parent) return;
      for (const scene of (game.scenes ?? []) as unknown as Iterable<Scene>) {
        const updates = tokenUpdates(scene.tokens, actor.id, data);
        if (updates.length)
          await scene.updateEmbeddedDocuments('Token', updates, { ...SILK_WRITE });
      }
    },
    async show({ uuid, image, title }) {
      const Journal = foundry.documents.collections.Journal as unknown as {
        show(doc: unknown, options: object): Promise<unknown>;
        showImage(src: string, options: object): void;
      };
      if (uuid) await Journal.show(fromUuidSync(uuid), { force: true });
      else if (image) Journal.showImage(image, { title });
    },
  };
}

interface HeaderControl {
  icon: string;
  label: string;
  action: string;
  onClick(): void;
}

export function registerRevealHooks(
  reveal: Pick<Reveal, 'repair' | 'reload' | 'isRevealed' | 'available'>,
  deps: {
    on(hook: string, fn: (...args: unknown[]) => void): void;
    isActiveGM(): boolean;
    isGM(): boolean;
    elementIdOf(doc: { flags?: unknown }): string | undefined;
    run(name: string, args: object): Promise<unknown>;
    localize(key: string): string;
  },
): void {
  const fail = (error: unknown) => console.error(error);
  // AppV2 document sheets (journals, DSA5 actor/item sheets): Silk entries in the header menu.
  deps.on('getHeaderControlsDocumentSheetV2', (app, controls) => {
    const doc = (app as { document?: { flags?: unknown } }).document;
    const id = doc && deps.isGM() ? deps.elementIdOf(doc) : undefined;
    if (!id) return;
    const list = controls as HeaderControl[];
    const control = (action: string, icon: string, label: string, name: string, args: object) =>
      list.push({
        action: `silk-${action}`,
        icon,
        label: deps.localize(label),
        onClick: () => void deps.run(name, args).catch(fail),
      });
    if (reveal.available()) {
      const revealed = reveal.isRevealed('element', id);
      control(
        'reveal',
        revealed ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye',
        revealed ? 'SILK.Reveal.Unreveal' : 'SILK.Reveal.Reveal',
        'reveal.element',
        { id, revealed: !revealed },
      );
      control(
        'show',
        'fa-solid fa-display',
        'SILK.Commands.reveal.showToPlayers',
        'reveal.showToPlayers',
        { id },
      );
    }
    control(
      'detail',
      'fa-solid fa-diagram-project',
      'SILK.Commands.element.openDetail',
      'element.openDetail',
      { id },
    );
  });

  // A hand edit of the image or token while hooded: re-apply the hood (§8 Appearance).
  deps.on('updateActor', (doc, changed, options) => {
    if (!deps.isActiveGM() || isSilkWrite(options)) return;
    const c = changed as Record<string, unknown>;
    if (!('img' in c) && !('prototypeToken' in c)) return;
    const id = deps.elementIdOf(doc as { flags?: unknown });
    if (id) reveal.repair(id).catch(fail);
  });

  deps.on('updateSetting', (setting) => {
    if ((setting as { key?: string }).key === `${MODULE_ID}.revealState`) reveal.reload();
  });
}
