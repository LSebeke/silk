/**
 * What code outside the canvas window asks of the open canvas (Adopt, spec §6 Placement and
 * Duplicates). The mounted canvas fills it in; it is empty while the canvas is closed.
 */
import type { Point } from '../../core/elements';

export interface CanvasBridge {
  /** Viewport centre in canvas coordinates (a card's top-left). */
  center?(): Point;
  /** Briefly highlights a Node. */
  flash?(id: string): void;
}

export const canvasBridge: CanvasBridge = {};
