/**
 * `Del`/`Backspace` on the canvas selection (spec 1.1 §E.4). Only Connections: deleted at once.
 * With Nodes: the Node delete flow (`element.delete`, which confirms) runs first; the selected
 * Connections go only when it deleted something, so a declined confirmation keeps them too.
 */
export interface SelectionToDelete {
  /** Selected Story Element ids (frames are not elements). */
  elements: readonly string[];
  connections: readonly string[];
}

export async function deleteSelection(
  run: (name: string, args?: object) => Promise<unknown>,
  { elements, connections }: SelectionToDelete,
): Promise<void> {
  if (elements.length) {
    const result = (await run('element.delete', { ids: elements })) as { ids: string[] };
    if (!result.ids.length) return;
  }
  if (connections.length) await run('connection.delete', { ids: connections });
}
