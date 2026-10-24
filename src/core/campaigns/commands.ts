/** Campaign and Adventure commands (spec §15, "Adventures / merge", "Campaigns / Canon"). */
import type { Command } from '../commands/registry';
import type { Campaigns } from './campaigns';

/** `getCampaigns` throws until the adapter has wired the session (Foundry `ready`). */
export function campaignCommands(getCampaigns: () => Campaigns): Command[] {
  const gm = (ctx: { isGM: boolean }) => ctx.isGM;
  return [
    {
      name: 'campaign.create',
      title: 'SILK.Commands.campaign.create',
      available: gm,
      run: (args: { name: string }) => getCampaigns().create(args),
    },
    {
      name: 'campaign.rename',
      title: 'SILK.Commands.campaign.rename',
      available: gm,
      run: (args: { id: string; name: string }) => getCampaigns().rename(args),
    },
    {
      name: 'campaign.close',
      title: 'SILK.Commands.campaign.close',
      available: gm,
      run: (args: { id: string }) => getCampaigns().close(args),
    },
    {
      name: 'campaign.reopen',
      title: 'SILK.Commands.campaign.reopen',
      available: gm,
      run: (args: { id: string }) => getCampaigns().reopen(args),
    },
    {
      name: 'adventure.start',
      title: 'SILK.Commands.adventure.start',
      available: gm,
      run: (args: { name: string; campaignId: string }) => getCampaigns().startAdventure(args),
    },
  ];
}
