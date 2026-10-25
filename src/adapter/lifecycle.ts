/**
 * Foundry side of the element lifecycle (spec §6 Foundry-side deletion): delete hooks hand
 * the deleted doc to the core. Only the active GM reacts; Silk's own deletes are skipped.
 */
import type { DeletedDoc, Lifecycle } from '../core/materialize';
import { snapshot, type FoundryDoc } from './foundry-docs';
import { isSilkWrite } from './working-copy-journal';

/** Scenes too: an Event Scene deletion clears its link (T13, via a lifecycle contributor). */
const DELETED = ['Actor', 'Item', 'JournalEntry', 'Scene'];

export function registerLifecycleHooks(
  lifecycle: Pick<Lifecycle, 'docDeleted'>,
  deps: {
    on(hook: string, fn: (...args: unknown[]) => void): void;
    isActiveGM(): boolean;
  },
): void {
  for (const name of DELETED)
    deps.on(`delete${name}`, (doc, options) => {
      const d = doc as FoundryDoc & { isToken?: boolean };
      // An unlinked token's synthetic actor carries the base actor's flags: not the element.
      if (!deps.isActiveGM() || isSilkWrite(options) || d.isToken) return;
      const deleted = snapshot(d) as DeletedDoc | undefined;
      if (deleted) lifecycle.docDeleted(deleted).catch((error: unknown) => console.error(error));
    });
}

interface DialogButton {
  action: string;
  label: string;
  default?: boolean;
  callback?: (event: Event, button: HTMLButtonElement) => unknown;
}
type Wait = (config: {
  window: { title: string };
  content: string;
  buttons: DialogButton[];
  rejectClose: boolean;
}) => Promise<unknown>;

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The delete and Unmaterialize prompts (spec §6, §13). Each has "Don't ask again", which
 * turns its client setting off.
 */
export function lifecycleDialogs(deps: {
  wait: Wait;
  localize(key: string, data?: Record<string, string>): string;
  disable(setting: 'confirmDelete' | 'warnUnmaterializeReveal'): Promise<unknown>;
}) {
  const L = (key: string, data?: Record<string, string>) =>
    deps.localize(`SILK.Lifecycle.${key}`, data);
  const dontAsk = () =>
    `<label class="silk-dont-ask"><input type="checkbox" name="dontAsk" data-silk-dont-ask> ${L('DontAsk')}</label>`;
  /** Runs `answer` with the checkbox state when a button is pressed. */
  const press =
    <T>(answer: T, setting: 'confirmDelete' | 'warnUnmaterializeReveal') =>
    async (_event: Event, button: HTMLButtonElement) => {
      const box = button.form?.elements.namedItem('dontAsk') as HTMLInputElement | null;
      if (box?.checked) await deps.disable(setting);
      return answer;
    };
  const list = (names: string[]) => names.map((n) => `<b>${escape(n)}</b>`).join(', ');

  return {
    async confirmDelete(args: { names: string[]; adopted: number; keepFoundryDoc: boolean }) {
      const content =
        `<p>${L('DeleteConfirm', { names: list(args.names) })}</p>` +
        (args.adopted ? `<p>${L('DeleteAdopted', { count: String(args.adopted) })}</p>` : '') +
        dontAsk();
      const buttons: DialogButton[] = args.adopted
        ? [
            {
              action: 'keep',
              label: L('KeepDoc'),
              default: args.keepFoundryDoc,
              callback: press({ keepFoundryDoc: true }, 'confirmDelete'),
            },
            {
              action: 'everything',
              label: L('DeleteEverything'),
              default: !args.keepFoundryDoc,
              callback: press({ keepFoundryDoc: false }, 'confirmDelete'),
            },
          ]
        : [
            {
              action: 'delete',
              label: L('Delete'),
              default: true,
              callback: press({ keepFoundryDoc: args.keepFoundryDoc }, 'confirmDelete'),
            },
          ];
      buttons.push({ action: 'cancel', label: L('Cancel'), callback: async () => null });
      const result = await deps.wait({
        window: { title: L('DeleteTitle') },
        content,
        buttons,
        rejectClose: false,
      });
      return result && typeof result === 'object' ? (result as { keepFoundryDoc: boolean }) : null;
    },

    async confirmUnmaterialize(names: string[]) {
      const result = await deps.wait({
        window: { title: L('UnmaterializeTitle') },
        content: `<p>${L('UnmaterializeRevealed', { names: list(names) })}</p>${dontAsk()}`,
        buttons: [
          {
            action: 'unmaterialize',
            label: L('Unmaterialize'),
            default: true,
            callback: press(true, 'warnUnmaterializeReveal'),
          },
          { action: 'cancel', label: L('Cancel'), callback: async () => false },
        ],
        rejectClose: false,
      });
      return result === true;
    },
  };
}
