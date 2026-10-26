/**
 * Player Canvas content from the Foundry docs the player can see (spec §9): names, Covers
 * (hooded actor images until Appearance) and opening docs on click. Never touches the
 * Working Copy or Canon files.
 */
import type { PlayerViewNode } from '../core/player-view';

type Level = 'NONE' | 'LIMITED' | 'OBSERVER';

/** The slice of a Foundry document (entry, page, actor, item) used here. */
export interface PlayerDoc {
  documentName: string;
  name: string | null;
  img?: string | null;
  src?: string | null;
  flags: { silk?: { cover?: string; companion?: string } };
  pages?: { get(id: string): PlayerDoc | undefined };
  testUserPermission(user: unknown, level: Level): boolean;
  sheet?: { render(force: boolean): Promise<unknown> | unknown } | null;
}

export function resolvePlayerNode(
  node: PlayerViewNode,
  get: (uuid: string) => PlayerDoc | null | undefined,
  user: unknown,
): { name: string; img?: string } {
  const doc = get(node.uuid);
  if (!doc?.testUserPermission(user, 'LIMITED')) return { name: '' };
  const name = doc.name ?? '';
  if (doc.documentName === 'JournalEntry') {
    const coverId = doc.flags.silk?.cover;
    const cover = coverId ? doc.pages?.get(coverId) : undefined;
    const src = cover?.testUserPermission(user, 'OBSERVER') ? cover.src : undefined;
    return src ? { name, img: src } : { name };
  }
  return doc.img ? { name, img: doc.img } : { name };
}

export async function openPlayerDoc(
  node: PlayerViewNode,
  deps: {
    get(uuid: string): PlayerDoc | null | undefined;
    journal(id: string): PlayerDoc | null | undefined;
    user: unknown;
  },
): Promise<void> {
  const doc = deps.get(node.uuid);
  if (!doc?.testUserPermission(deps.user, 'LIMITED')) return;
  await doc.sheet?.render(true);
  if (doc.documentName === 'JournalEntry') return;
  // Actor/Item: the Companion Journal opens once a block, Connection or note made it OBSERVER.
  const id = doc.flags.silk?.companion;
  const companion = id ? deps.journal(id) : undefined;
  if (companion?.testUserPermission(deps.user, 'OBSERVER')) await companion.sheet?.render(true);
}
