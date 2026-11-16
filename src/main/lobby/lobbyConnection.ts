import { t } from '../i18n.ts';
import { LineDecoder } from '../lineDecoder.ts';
import { type LobbyMessage, parseLobbyMessage, serializeLobbyMessage } from './lobbyProtocol.ts';

export interface LobbyConnectionHandlers {
  onMessage(message: LobbyMessage): void;
  onClose(reason: string): void;
}

const OPEN_TIMEOUT_MS = 15_000;

/** One WebSocket session with the lobby server, exchanging newline-delimited JSON messages. */
export class LobbyConnection {
  private readonly socket: WebSocket;
  private readonly handlers: LobbyConnectionHandlers;
  private readonly lines = new LineDecoder();
  private readonly text = new TextDecoder();
  private closed = false;
  private finished = false;

  private constructor(socket: WebSocket, handlers: LobbyConnectionHandlers) {
    this.socket = socket;
    this.handlers = handlers;
    socket.addEventListener('message', (event) => this.receive(event.data));
    socket.addEventListener('close', (event) => this.finish(event.reason || t('main.lobby.closedCode', { code: event.code })));
    socket.addEventListener('error', () => this.finish(t('main.lobby.connectionError')));
  }

  static open(url: string, handlers: LobbyConnectionHandlers): Promise<LobbyConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error(t('main.lobby.notResponding')));
      }, OPEN_TIMEOUT_MS);
      const onOpen = (): void => {
        clearTimeout(timeout);
        socket.removeEventListener('error', onError);
        resolve(new LobbyConnection(socket, handlers));
      };
      const onError = (): void => {
        clearTimeout(timeout);
        socket.removeEventListener('open', onOpen);
        reject(new Error(t('main.lobby.connectFailed')));
      };
      socket.addEventListener('open', onOpen, { once: true });
      socket.addEventListener('error', onError, { once: true });
    });
  }

  send(message: LobbyMessage): void {
    if (!this.closed) {
      this.socket.send(`${serializeLobbyMessage(message)}\n`);
    }
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.socket.close();
    }
  }

  private receive(data: unknown): void {
    const chunk =
      typeof data === 'string' ? data : data instanceof ArrayBuffer ? this.text.decode(data, { stream: true }) : null;
    if (chunk === null || this.closed) {
      return;
    }
    let lines: string[];
    try {
      lines = this.lines.push(chunk);
    } catch (error) {
      this.finish(error instanceof Error ? error.message : String(error));
      this.socket.close();
      return;
    }
    for (const line of lines) {
      const message = parseLobbyMessage(line);
      if (message) {
        this.handlers.onMessage(message);
      } else {
        console.warn('Ignoring malformed lobby message');
      }
    }
  }

  private finish(reason: string): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.closed = true;
    this.handlers.onClose(reason);
  }
}
