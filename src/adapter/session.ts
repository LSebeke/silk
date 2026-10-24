/**
 * The World's Silk session: its Working Copy and history, wired to Foundry on `ready`.
 * Later features read `getSession().workingCopy` (records + change notifications).
 */
import { MODULE_ID } from '../constants';
import { createCampaigns, type Campaigns, type RevelationMap } from '../core/campaigns';
import { createHistory, type History } from '../core/history';
import { createWorkingCopy, type WorkingCopy } from '../core/working-copy';
import { createFilePickerFiles, foundryFilePicker } from './canon-files';
import {
  FOLDER_NAME,
  ensureWorkingCopyJournal,
  isActiveGM,
  isWorkingCopyJournal,
  journalBackend,
  remotePatch,
  type JournalLike,
} from './working-copy-journal';

export interface Session {
  workingCopy: WorkingCopy;
  history: History;
  campaigns: Campaigns;
}

let session: Session | null = null;

export type RevelationMapApplier = (map: RevelationMap, campaignId: string) => Promise<void>;
let applyRevelationMap: RevelationMapApplier = async () => {};

/**
 * Seam for Reveal (spec §8 "Truth"): how a Revelation Map becomes World ownership.
 * Called on checkout of an Adventure. No-op until Reveal registers its applier.
 */
export function setRevelationMapApplier(applier: RevelationMapApplier): void {
  applyRevelationMap = applier;
}

export function getSession(): Session {
  if (!session) throw new Error('Silk: not ready yet');
  return session;
}

const activeGM = () => isActiveGM(game as never);
const findJournal = () =>
  game.journal?.find((j) => isWorkingCopyJournal(j)) as unknown as JournalLike | undefined;

export async function startSession(): Promise<Session> {
  if (activeGM())
    await ensureWorkingCopyJournal({
      find: findJournal,
      findFolder: () =>
        game.folders?.find((f) => f.type === 'JournalEntry' && f.name === FOLDER_NAME),
      createFolder: (data) => Folder.implementation.create(data) as never,
      createEntry: (data) => JournalEntry.implementation.create(data as never),
    });

  const workingCopy = createWorkingCopy(journalBackend(findJournal), { canWrite: activeGM });
  const history = createHistory({
    files: createFilePickerFiles(foundryFilePicker()),
    workingCopy,
    author: () => game.user?.name ?? 'GM',
    createdWith: `silk ${game.modules?.get(MODULE_ID)?.version ?? 'dev'}`,
  });

  Hooks.on('updateJournalEntry', (doc, changed, options, userId) => {
    const patch = remotePatch(doc, changed, options, userId, game.user?.id ?? null);
    if (patch) workingCopy.applyRemote(patch);
  });
  // A player connected before the GM created the journal.
  Hooks.on('createJournalEntry', (doc) => {
    if (isWorkingCopyJournal(doc)) workingCopy.reload();
  });

  const campaigns = createCampaigns({
    history,
    workingCopy,
    applyRevelationMap: (map, campaignId) => applyRevelationMap(map, campaignId),
  });

  session = { workingCopy, history, campaigns };
  return session;
}
