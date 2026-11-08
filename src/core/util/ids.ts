/** Id list helpers. Pure. */

/** The same ids, in any order (lists without duplicates). */
export const sameIdSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((id) => set.has(id));
};
