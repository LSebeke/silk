/**
 * Foundry's ProseMirror editor for Info Block text in Element Detail (v1.1 §C.1): a toggled
 * `<prose-mirror>` showing the enriched HTML; its save hands the edited HTML on.
 */
export function mountProseEditor(
  host: HTMLElement,
  html: string,
  save: (html: string) => void,
): () => void {
  let editor: HTMLElement | undefined;
  let gone = false;
  void foundry.applications.ux.TextEditor.implementation.enrichHTML(html).then((enriched) => {
    if (gone) return;
    const el = foundry.applications.elements.HTMLProseMirrorElement.create({
      name: 'text',
      value: html,
      enriched,
      toggled: true,
    });
    el.addEventListener('change', () => {
      if (el.value !== html) save(el.value ?? '');
    });
    host.replaceChildren(el);
    editor = el;
  });
  return () => {
    gone = true;
    editor?.remove();
  };
}
