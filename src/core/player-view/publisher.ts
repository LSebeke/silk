/**
 * Keeps the Player View world setting current (spec §9): the active GM rebuilds it after
 * every Reveal (World reveal state) or working-copy change (moves, Connections), debounced.
 * Frozen under the main Checkout (§8): the setting stays as the last Adventure left it.
 */
import type { Reveal } from '../reveal';
import type { WorkingCopy } from '../working-copy';
import { buildPlayerView, parsePlayerView, type PlayerView } from './player-view';

export interface PlayerViewPublisherDeps {
  workingCopy(): Pick<WorkingCopy, 'records' | 'watch'>;
  reveal: Pick<Reveal, 'state' | 'subscribe'>;
  /** True under the main Checkout or unbound: nothing is written. */
  frozen(): boolean;
  /** The stored setting. */
  current(): unknown;
  write(view: PlayerView): Promise<void>;
  /** Debounce in ms. */
  delay?: number;
}

export interface PlayerViewPublisher {
  /** Follow reveal state and the working copy (active GM); returns the unsubscribe. */
  start(): () => void;
  /** Rebuild and write now, if not frozen and changed. */
  publish(): Promise<void>;
}

export function createPlayerViewPublisher(deps: PlayerViewPublisherDeps): PlayerViewPublisher {
  const delay = deps.delay ?? 250;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function publish() {
    if (deps.frozen()) return;
    const view = buildPlayerView(deps.workingCopy().records(), deps.reveal.state());
    if (JSON.stringify(view) === JSON.stringify(parsePlayerView(deps.current()))) return;
    await deps.write(view);
  }

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      publish().catch((error: unknown) => console.error(error));
    }, delay);
  };

  return {
    publish,
    start() {
      const offReveal = deps.reveal.subscribe(schedule);
      const offRecords = deps.workingCopy().watch(schedule);
      return () => {
        offReveal();
        offRecords();
        clearTimeout(timer);
      };
    },
  };
}
