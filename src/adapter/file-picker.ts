/** Foundry's FilePicker for one image (v1.1 §G.3). */

/** Opens the picker at `current`; resolves the picked path, `undefined` when closed without one. */
export function pickImage(current: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const FilePicker = foundry.applications.apps.FilePicker.implementation;
    const picker = new FilePicker({
      type: 'image',
      current,
      callback: (path: string) => resolve(path),
    });
    // Resolves first on a pick (the callback runs before the close).
    picker.addEventListener('close', () => resolve(undefined), { once: true });
    void picker.browse();
  });
}
