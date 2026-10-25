/**
 * Revealed filter under the main Checkout (spec §8): the World's current ownership. An
 * element is Revealed when its doc gives players at least LIMITED (element Reveal sets
 * OBSERVER on journals, LIMITED on actors/items).
 */
const LIMITED = 1;

export function ownershipRevealed(
  ownership: Record<string, number> | undefined,
  isPlayer: (userId: string) => boolean,
): boolean {
  if (!ownership) return false;
  return Object.entries(ownership).some(
    ([id, level]) => level >= LIMITED && (id === 'default' || isPlayer(id)),
  );
}

/** Foundry lookup: the element doc's ownership by uuid. */
export function foundryOwnershipRevealed(uuid: string | undefined): boolean {
  if (!uuid) return false;
  const doc = fromUuidSync(uuid) as { ownership?: Record<string, number> } | null;
  return ownershipRevealed(doc?.ownership, (id) => {
    const user = game.users?.get(id);
    return !!user && !user.isGM;
  });
}
