/** What players see (spec §8, v1.1 §C.2): the hood (`hood.ts`) or the real look (`unhood.ts`). */
import { hoodWrites } from './hood';
import type { LookSource, PortraitWrites, Shown } from './portrait';
import { revealWrites } from './unhood';

/** Makes the actor show `shown`. No-op doc writes are left out. */
export const showWrites = (source: LookSource, shown: Shown): PortraitWrites =>
  shown === 'real' ? revealWrites(source) : hoodWrites(source, shown.hood);
