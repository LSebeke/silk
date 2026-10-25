/**
 * Dev-only core commands (spec §14, §15 "Dev only"). Registered only in dev builds
 * (`__SILK_DEV__`), never in a release.
 */
import type { Command } from '../commands/registry';
import type { WorkingCopy } from '../working-copy';
import { generateFixture, type FixtureArgs } from './fixture';

export function devCoreCommands(deps: { workingCopy(): WorkingCopy }): Command[] {
  const generate: Command<FixtureArgs, { elements: number; connections: number }> = {
    name: 'dev.fixture.generate',
    title: 'dev.fixture.generate',
    available: (ctx) => ctx.isGM,
    async run({ count, seed }) {
      const records = generateFixture({ count, seed });
      await deps.workingCopy().replaceAll(new Map(records.map((r) => [r.id, r])));
      return {
        elements: records.filter((r) => r.kind === 'element').length,
        connections: records.filter((r) => r.kind === 'connection').length,
      };
    },
  };
  return [generate];
}
