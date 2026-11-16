import net from 'node:net';
import { CancelledError, describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import { isFafWebSocketUrl } from '../servers.ts';

// The server holds data back until it is a few minutes old, so a game watched right at the delay may take a moment.
const FIRST_DATA_TIMEOUT_MS = 90_000;

export interface LiveReplayOptions {
  firstDataTimeoutMs?: number;
  createSocket?: (url: string) => WebSocket;
  /** Stops waiting for the stream, as when the user cancels the start. */
  signal?: AbortSignal;
}

/**
 * A live game from the FAF replay server, which the game reads from `gpgnet://127.0.0.1:<port>/...`. The stream is
 * requested before Forged Alliance starts: LiveReplayProxyServer of the official client connects only when the game
 * asks, and a stream the server refuses then ends in the game's "Premature EOF" crash. Here a refusal is an error the
 * launcher shows, and the game does not start.
 */
export class LiveReplaySource {
  private readonly remote: WebSocket;
  private readonly gameId: number;
  private server: net.Server | null = null;
  private game: net.Socket | null = null;
  private readonly buffered: Buffer[] = [];
  private remoteClosed = false;
  private stopped = false;
  private received = 0;

  private constructor(remote: WebSocket, gameId: number) {
    this.remote = remote;
    this.gameId = gameId;
  }

  static async open(
    getAccessUrl: () => Promise<string>,
    gameId: number,
    login: string,
    options: LiveReplayOptions = {},
  ): Promise<LiveReplaySource> {
    const { signal } = options;
    const url = await getAccessUrl();
    if (signal?.aborted) {
      throw new CancelledError();
    }
    if (!isFafWebSocketUrl(url)) {
      throw new Error(t('main.replays.invalidServerUrl'));
    }
    const remote = (options.createSocket ?? ((address: string) => new WebSocket(address)))(url);
    remote.binaryType = 'arraybuffer';
    const source = new LiveReplaySource(remote, gameId);
    try {
      // The request line of the replay server protocol, the same one the game itself would send.
      await source.request(`G/${gameId}/${login}.scfareplay\0`, options.firstDataTimeoutMs ?? FIRST_DATA_TIMEOUT_MS, signal);
      await source.listen();
    } catch (error) {
      source.stop();
      throw error;
    }
    return source;
  }

  get port(): number {
    const address = this.server?.address();
    return address && typeof address !== 'string' ? address.port : 0;
  }

  stop(): void {
    this.stopped = true;
    this.server?.close();
    this.game?.destroy();
    this.remote.close();
  }

  /** Resolves with the first data of the stream; until the game connects, data is kept here. */
  private request(line: string, timeoutMs: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(t('main.replays.live.noData'))),
        timeoutMs,
      );
      const settle = (error?: Error): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const cancel = (): void => settle(new CancelledError());
      signal?.addEventListener('abort', cancel, { once: true });
      this.remote.addEventListener('open', () => this.remote.send(Buffer.from(line, 'utf8')));
      this.remote.addEventListener('message', (event) => {
        if (!(event.data instanceof ArrayBuffer)) {
          return;
        }
        const chunk = Buffer.from(event.data);
        this.received += chunk.length;
        if (this.game) {
          this.game.write(chunk);
        } else {
          this.buffered.push(chunk);
        }
        settle();
      });
      this.remote.addEventListener('close', (event) => {
        this.remoteClosed = true;
        const detail = `${event.code}${event.reason ? `, ${event.reason}` : ''}`;
        const by = this.stopped ? 'by the launcher' : 'by the server';
        console.info(`Live replay of game ${this.gameId} closed ${by} (code ${detail}), ${this.received} bytes received`);
        this.game?.end();
        settle(new Error(t('main.replays.live.closed', { detail })));
      });
      this.remote.addEventListener('error', () => settle(new Error(t('main.replays.live.unreachable'))));
    });
  }

  private async listen(): Promise<void> {
    // Half-open: the game may finish sending its request line while the stream to it keeps going.
    const server = net.createServer({ allowHalfOpen: true }, (socket) => this.accept(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
  }

  private accept(socket: net.Socket): void {
    if (this.game) {
      socket.destroy();
      return;
    }
    this.game = socket;
    // The game sends its own request line; the stream is already open, so whatever it sends is dropped.
    socket.on('data', () => undefined);
    socket.on('error', (error) => console.warn('Live replay stream to the game failed', describeError(error)));
    for (const chunk of this.buffered.splice(0)) {
      socket.write(chunk);
    }
    if (this.remoteClosed) {
      socket.end();
    }
  }
}
