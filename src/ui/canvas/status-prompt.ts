/**
 * Status toggle with a y/n confirm (spec §10.3 `s`, default n). The canvas owns the
 * prompt; cards reach it through this Svelte context (the Status chip).
 */
export interface StatusPrompt {
  /** Asks to move the element to its next Status; runs `element.setStatus` on y. */
  ask(id: string): void;
}

export const STATUS_PROMPT = Symbol('silk-status-prompt');
