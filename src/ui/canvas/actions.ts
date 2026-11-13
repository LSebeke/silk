/** Small helpers shared by the canvas components. */

/** Svelte action: focus the element once it is mounted (typing starts at once). */
export function focus(el: HTMLElement): void {
  queueMicrotask(() => el.focus());
}

/** Rejected command from a UI handler: logged, the UI stays as it is. */
export const fail = (error: unknown): void => console.error(error);
