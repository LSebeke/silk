/** Connection Detail window (v1.1 §F.2), one per Connection. Loaded lazily by `connection.openDetail`. */
import ConnectionDetail from './ConnectionDetail.svelte';
import type { DetailContext } from './context';
import { DetailWindow } from './DetailWindow';

type Props = { ctx: DetailContext; id: string; close: () => void };

export class ConnectionDetailWindow extends DetailWindow<Props> {
  static override DEFAULT_OPTIONS = {
    window: { title: 'SILK.ConnectionDetail.Title', icon: 'fa-solid fa-link' },
    position: { height: 480 },
  };

  static idFor = (connectionId: string) => `silk-connection-detail-${connectionId}`;

  protected readonly component = ConnectionDetail;

  readonly #ctx: DetailContext;
  readonly #id: string;

  constructor(ctx: DetailContext, connectionId: string) {
    super({ id: ConnectionDetailWindow.idFor(connectionId) });
    this.#ctx = ctx;
    this.#id = connectionId;
  }

  protected getProps() {
    return { ctx: this.#ctx, id: this.#id, close: () => void this.close() };
  }
}
