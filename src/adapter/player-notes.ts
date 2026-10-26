/**
 * Foundry side of Player Notes (spec §9): the socket relay (players → active GM, who alone
 * writes docs and the Working Copy) and the "Add Player Note" sheet header control.
 */
import { MODULE_ID } from '../constants';

const CHANNEL = `module.${MODULE_ID}`;
/** Party commands a player may ask the active GM to run. */
const RELAYED = new Set(['playerNote.create', 'playerNote.edit', 'playerNote.delete']);
const TIMEOUT_MS = 60_000;

interface Socket {
  on(channel: string, fn: (data: unknown) => void): void;
  emit(channel: string, data: unknown): void;
}

type Message =
  | { silk: 'request'; id: string; from: string; name: string; args: object }
  | { silk: 'response'; id: string; to: string; result?: unknown; error?: string };

export interface SocketRelay {
  /** Player: run `name` on the active GM; resolves with its result. */
  relay(name: string, args: object): Promise<unknown>;
  /** Start listening (every client: GMs answer, players receive answers). */
  listen(): void;
}

export function createSocketRelay(deps: {
  socket: Socket;
  userId(): string;
  isActiveGM(): boolean;
  run(name: string, args: object): Promise<unknown>;
}): SocketRelay {
  const pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void }>();
  let n = 0;
  const send = (m: Message) => deps.socket.emit(CHANNEL, m);

  async function answer(m: Extract<Message, { silk: 'request' }>) {
    try {
      if (!RELAYED.has(m.name)) throw new Error(`Silk: "${m.name}" is not relayed`);
      const result = await deps.run(m.name, m.args);
      send({ silk: 'response', id: m.id, to: m.from, result: result ?? null });
    } catch (error) {
      send({ silk: 'response', id: m.id, to: m.from, error: (error as Error).message });
    }
  }

  return {
    relay(name, args) {
      if (!RELAYED.has(name)) return Promise.reject(new Error(`Silk: "${name}" is not relayed`));
      const id = `${deps.userId()}-${Date.now()}-${++n}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Silk: no answer from the GM'));
        }, TIMEOUT_MS);
        pending.set(id, {
          resolve: (v) => (clearTimeout(timer), resolve(v)),
          reject: (e) => (clearTimeout(timer), reject(e)),
        });
        send({ silk: 'request', id, from: deps.userId(), name, args });
      });
    },
    listen() {
      deps.socket.on(CHANNEL, (data) => {
        const m = data as Message | undefined;
        if (m?.silk === 'request' && deps.isActiveGM()) void answer(m);
        else if (m?.silk === 'response' && m.to === deps.userId()) {
          const p = pending.get(m.id);
          if (!p) return;
          pending.delete(m.id);
          if (m.error !== undefined) p.reject(new Error(m.error));
          else p.resolve(m.result);
        }
      });
    },
  };
}

interface HeaderControl {
  icon: string;
  label: string;
  action: string;
  onClick(): void;
}

/** "Add Player Note" on the sheets of Revealed elements and their Companion Journals. */
export function registerPlayerNoteHooks(deps: {
  on(hook: string, fn: (...args: unknown[]) => void): void;
  elementIdOf(doc: { flags?: unknown }): string | undefined;
  isRevealed(elementId: string): boolean;
  /** `playerNote.create` is available (a GM is online). */
  available(): boolean;
  /** Asks for the note text; `null` = cancelled. */
  prompt(): Promise<string | null>;
  run(name: string, args: object): Promise<unknown>;
  localize(key: string): string;
  error?(message: string): void;
}): void {
  deps.on('getHeaderControlsDocumentSheetV2', (app, controls) => {
    const doc = (app as { document?: { flags?: unknown } }).document;
    const id = doc ? deps.elementIdOf(doc) : undefined;
    if (!id || !deps.isRevealed(id) || !deps.available()) return;
    (controls as HeaderControl[]).push({
      action: 'silk-player-note',
      icon: 'fa-solid fa-note-sticky',
      label: deps.localize('SILK.PlayerNote.Add'),
      onClick: () =>
        void (async () => {
          const text = await deps.prompt();
          if (text?.trim()) await deps.run('playerNote.create', { elementId: id, text });
        })().catch((error: unknown) => {
          console.error(error);
          deps.error?.((error as Error).message);
        }),
    });
  });
}

/** Plain text from the prompt → note HTML: one paragraph per line, escaped. */
export function textToHtml(text: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => `<p>${escape(line)}</p>`)
    .join('');
}
