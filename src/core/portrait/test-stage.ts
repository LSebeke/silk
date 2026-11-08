/** A `LookStage` for unit tests: records token writes and rendered subjects. */
import type { LookStage, SubjectSpec } from './subject';

export const TEST_EDGES = { inner: 0.6, outer: 0.7 };

export function testLookStage() {
  const tokens: { actor: string; data: Record<string, unknown> }[] = [];
  const subjects: { actor: string; spec: SubjectSpec; file: string }[] = [];
  const stage: LookStage = {
    updateTokens: async (actor, data) => void tokens.push({ actor, data }),
    ringEdges: async () => TEST_EDGES,
    async renderSubject(actor, spec) {
      const file = `silk/test/tokens/${actor.split('.').pop()}-${subjects.length + 1}.webp`;
      subjects.push({ actor, spec, file });
      return file;
    },
  };
  return { stage, tokens, subjects };
}
