/** E2E helper: Reveal needs a bound Canon with an Adventure checked out (spec §8). */
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate over Silk internals */
import type { Page } from '@playwright/test';

/** Binds a Canon and starts an Adventure unless one is already checked out (shared world). */
export async function ensureAdventure(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const mod = game.modules?.get('silk') as any;
    const session = mod.session();
    if (!session.workingCopy.binding) await mod.api.run('canon.create', { name: 'E2E' });
    if ('adventure' in session.workingCopy.binding.checkout) return;
    await mod.api.run('history.commit', { label: 'e2e start' });
    const campaign = await mod.api.run('campaign.create', { name: 'E2E' });
    await mod.api.run('adventure.start', { name: 'E2E 1', campaignId: campaign.id });
  });
}
