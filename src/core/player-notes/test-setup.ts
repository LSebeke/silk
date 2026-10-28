/** Player Notes unit-test wiring: the Reveal setup plus the Player Notes service. */
import { setup as revealSetup } from '../reveal/test-setup';
import { createPlayerNotes, playerNoteCommands } from './player-notes';

export function setup(opts: { adventure?: boolean } = {}) {
  const t = revealSetup(opts.adventure === false ? { adventure: false } : {});
  let isGM = true;
  let gmOnline = true;
  let n = 0;
  let campaign: string | null = opts.adventure === false ? null : 'camp1';
  const relayed: { name: string; args: object }[] = [];
  const notes = createPlayerNotes({
    workingCopy: () => t.workingCopy,
    docs: t.docs,
    materializer: t.materializer,
    reveal: t.reveal,
    campaign: async () => campaign,
    newId: () => `note${String(++n).padStart(12, '0')}`,
    localize: (key) => key.split('.').pop() ?? key,
  });
  for (const command of playerNoteCommands(notes, {
    isGM: () => isGM,
    gmOnline: () => gmOnline,
    relay: async (name, args) => {
      relayed.push({ name, args });
      // The active GM runs it.
      const was = isGM;
      isGM = true;
      try {
        return await t.registry.run(name, args);
      } finally {
        isGM = was;
      }
    },
  }))
    t.registry.register(command);
  return {
    ...t,
    notes,
    relayed,
    setGM: (v: boolean) => (isGM = v),
    setGmOnline: (v: boolean) => (gmOnline = v),
    /** Another Campaign checked out in this World. */
    checkout: (id: string | null) => {
      campaign = id;
      t.setCampaign(id);
    },
  };
}
