/**
 * `MergeUi` for the merge commands: the merge window (lazy chunk) and the no-undo confirm.
 * Small on purpose: it is part of the entry bundle.
 */
import type { MergeUi } from '../../core/merge';
import type { MergeDeps, MergeWindow } from './MergeWindow';

const ID = 'silk-merge';

export function createMergeUi(deps: MergeDeps): MergeUi {
  const current = () => foundry.applications.instances.get(ID) as MergeWindow | undefined;

  async function open(): Promise<MergeWindow> {
    const existing = current();
    if (existing) {
      await existing.render({ force: true });
      existing.bringToFront();
      return existing;
    }
    // Lazy chunk: the merge UI is not part of the entry bundle.
    const { MergeWindow } = await import('./MergeWindow');
    const app = new MergeWindow(deps);
    await app.render({ force: true });
    return app;
  }

  return {
    open: async () => void (await open()),
    async close() {
      await current()?.close();
    },
    async confirmNoUndo() {
      const kind = (await deps.view())?.draft.kind;
      const body =
        kind === 'join'
          ? 'SILK.Merge.JoinConfirmBody'
          : kind === 'canonEdit'
            ? 'SILK.Merge.CanonEditConfirmBody'
            : 'SILK.Merge.ConfirmBody';
      const title = kind === 'join' ? 'SILK.Merge.JoinConfirmTitle' : 'SILK.Merge.ConfirmTitle';
      return !!(await foundry.applications.api.DialogV2.confirm({
        id: 'silk-merge-confirm',
        window: { title: deps.t(title) },
        content: `<p>${deps.t(body)}</p>`,
      }));
    },
    async focus(ref) {
      await (await open()).focusOn(ref.recordId, ref.field);
    },
  };
}
