/**
 * A `LookStage` for unit tests: records token writes and rendered subjects, and applies the
 * writes to the placed tokens a test puts in `placed` (by actor uuid).
 */
import { applyUpdate } from '../materialize/memory-docs';
import { placedTokenUpdate } from './placed';
import type { PlacedToken, SnapshotMode } from './portrait';
import type { LookStage, SubjectSpec } from './subject';

export const TEST_EDGES = { inner: 0.6, outer: 0.7 };

export function testLookStage() {
  const tokens: { actor: string; data: Record<string, unknown>; snapshot?: SnapshotMode }[] = [];
  const subjects: { actor: string; spec: SubjectSpec; file: string }[] = [];
  const placed = new Map<string, PlacedToken[]>();
  const stage: LookStage = {
    async updateTokens(actor, data, snapshot) {
      tokens.push({ actor, data, ...(snapshot ? { snapshot } : {}) });
      for (const token of placed.get(actor) ?? []) {
        const update = placedTokenUpdate(token, data, snapshot);
        if (update) applyUpdate(token, update);
      }
    },
    ringEdges: async () => TEST_EDGES,
    async renderSubject(actor, spec) {
      const file = `silk/test/tokens/${actor.split('.').pop()}-${subjects.length + 1}.webp`;
      subjects.push({ actor, spec, file });
      return file;
    },
  };
  return { stage, tokens, subjects, placed };
}
