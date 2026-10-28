/**
 * Connection Points (spec §10.2): outgoing, incoming and mutual, on all four sides of a
 * card. Each is a Svelte Flow source Handle; its id says its kind (`out-top`, …).
 */
import type { RelativeDirection } from '../../core/connections';

type Side = 'top' | 'right' | 'bottom' | 'left';
const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
const KINDS: RelativeDirection[] = ['out', 'in', 'mutual'];
/** Along the side: out, in, mutual. */
const AT = ['30%', '50%', '70%'];
const POSITION = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' } as const;

export interface ConnectionPoint {
  id: string;
  kind: RelativeDirection;
  side: Side;
  position: (typeof POSITION)[Side];
  style: string;
}

export const CONNECTION_POINTS: ConnectionPoint[] = SIDES.flatMap((side) =>
  KINDS.map((kind, i) => ({
    id: `${kind}-${side}`,
    kind,
    side,
    position: POSITION[side],
    style: side === 'top' || side === 'bottom' ? `left: ${AT[i]}` : `top: ${AT[i]}`,
  })),
);

/** The kind of a Connection Point from its Handle id. */
export function pointKind(handleId: string | null | undefined): RelativeDirection {
  const kind = handleId?.split('-')[0];
  return kind === 'in' || kind === 'mutual' ? kind : 'out';
}
