/**
 * Foundry's ProseMirror editor for Garn rich text (Info Blocks, Connection Notes; v1.1 §C.1,
 * §G.1): a toggled `<prose-mirror>` showing the enriched HTML, sized to its content (Foundry's
 * `content-sized`: no inner scroll, read-only or open); its save hands the edited HTML on.
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
    el.classList.add('content-sized');
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
