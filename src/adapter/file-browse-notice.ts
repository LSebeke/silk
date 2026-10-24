/**
 * One-time GM notice when a non-GM role can browse files (spec §12, ADR 0002):
 * file browsing lists `Data/silk/`, which exposes the unguessable Canon path.
 */

/** Foundry `CONST.USER_ROLES` below Assistant GM, with their core label keys. */
const NON_GM_ROLES = [
  { role: 1, label: 'USER.RolePlayer' },
  { role: 2, label: 'USER.RoleTrusted' },
] as const;

/** Foundry's FILES_BROWSE default when the world never changed it: Trusted and up. */
const DEFAULT_FILES_BROWSE = [2, 3, 4];

export interface FileBrowseNoticeDeps {
  isGM: boolean;
  /** `game.permissions`: permission name to the roles granted it. */
  permissions: Record<string, number[] | undefined> | undefined;
  alreadyShown: boolean;
  localize: (key: string, data?: Record<string, string>) => string;
  warn: (message: string) => void;
  markShown: () => unknown;
}

/** Shows the notice if due and records that it was shown. Returns whether it showed. */
export function showFileBrowseNotice(deps: FileBrowseNoticeDeps): boolean {
  if (!deps.isGM || deps.alreadyShown) return false;
  const granted = deps.permissions?.FILES_BROWSE ?? DEFAULT_FILES_BROWSE;
  const exposed = NON_GM_ROLES.filter(({ role }) => granted.includes(role));
  if (exposed.length === 0) return false;
  const roles = exposed.map(({ label }) => deps.localize(label)).join(', ');
  deps.warn(deps.localize('SILK.Notice.FileBrowse', { roles }));
  deps.markShown();
  return true;
}
