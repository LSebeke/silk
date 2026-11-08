/** Connection Detail window (v1.1 §F.2), one per Connection. Loaded lazily by `connection.openDetail`. */
import ConnectionDetail from './ConnectionDetail.svelte';
import { DetailWindow, type DetailProps } from './DetailWindow';

type Props = DetailProps & { close: () => void };

export class ConnectionDetailWindow extends DetailWindow<Props> {
  static override DEFAULT_OPTIONS = {
    window: { title: 'SILK.ConnectionDetail.Title', icon: 'fa-solid fa-link' },
    position: { height: 480 },
  };
  static override prefix = 'silk-connection-detail';

  protected readonly component = ConnectionDetail;

  protected override moreProps() {
    return { close: () => void this.close() };
  }
}
