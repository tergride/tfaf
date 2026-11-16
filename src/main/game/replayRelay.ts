import net from 'node:net';
import type { FafApi } from '../api/fafApi.ts';
import { asObject, asString } from '../api/jsonApi.ts';
import { describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import { isFafWebSocketUrl } from '../servers.ts';

const MAX_BUFFERED_BYTES = 64 * 1024 * 1024;

export interface ReplayRelayOptions {
  /** Every byte the game sends, for keeping a local copy of the replay. */
  onGameData?: (chunk: Buffer) => void;
}

/** WebSocket address of the FAF replay server, issued per connection by the user service. */
export async function fetchReplayAccessUrl(api: FafApi): Promise<string> {
  const access = asString(asObject(await api.getFromUserService('/replay/access'))?.accessUrl);
  if (!access) {
    throw new Error(t('main.replays.noServerUrl'));
  }
  return access;
}

/**
 * Local endpoint for the game's `/savereplay gpgnet://...` stream. Like ReplayServer of the official client it forwards
 * the live replay to the FAF replay server, whose WebSocket address comes from the user service (`/replay/access`).
 * Failures never affect the game: the stream is then simply not uploaded.
 */
export class ReplayRelay {
  private readonly server: net.Server;
  private readonly getAccessUrl: () => Promise<string>;
  private readonly options: ReplayRelayOptions;
  private game: net.Socket | null = null;
  private remote: WebSocket | null = null;
  private remoteState: 'pending' | 'open' | 'closed' = 'pending';
  private queue: Buffer[] = [];
  private queuedBytes = 0;
  private sentBytes = 0;

  private constructor(server: net.Server, getAccessUrl: () => Promise<string>, options: ReplayRelayOptions) {
    this.server = server;
    this.getAccessUrl = getAccessUrl;
    this.options = options;
    server.on('connection', (socket) => this.accept(socket));
  }

  static async start(getAccessUrl: () => Promise<string>, options: ReplayRelayOptions = {}): Promise<ReplayRelay> {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    return new ReplayRelay(server, getAccessUrl, options);
  }

  get port(): number {
    const address = this.server.address();
    return address && typeof address !== 'string' ? address.port : 0;
  }

  stop(): void {
    this.server.close();
    this.game?.destroy();
    this.remote?.close();
  }

  private accept(socket: net.Socket): void {
    if (this.game) {
      socket.destroy();
      return;
    }
    this.game = socket;
    socket.on('data', (chunk: Buffer) => {
      this.options.onGameData?.(chunk);
      this.forward(chunk);
    });
    socket.on('end', () => this.remote?.close());
    socket.on('error', (error) => console.warn('Replay stream from the game failed', describeError(error)));
    void this.connectRemote();
  }

  private async connectRemote(): Promise<void> {
    try {
      const url = await this.getAccessUrl();
      if (!isFafWebSocketUrl(url)) {
        throw new Error(t('main.replays.invalidServerUrl'));
      }
      const remote = new WebSocket(url);
      remote.binaryType = 'arraybuffer';
      this.remote = remote;
      remote.addEventListener('open', () => {
        this.remoteState = 'open';
        for (const chunk of this.queue) {
          remote.send(chunk);
          this.sentBytes += chunk.length;
        }
        this.queue = [];
        this.queuedBytes = 0;
      });
      remote.addEventListener('message', (event) => {
        if (event.data instanceof ArrayBuffer) {
          this.game?.write(Buffer.from(event.data));
        }
      });
      remote.addEventListener('close', (event) => {
        this.remoteState = 'closed';
        this.remote = null;
        console.info(`Replay upload closed (code ${event.code}${event.reason ? `, ${event.reason}` : ''}), ${this.sentBytes} bytes sent`);
      });
      remote.addEventListener('error', () => console.warn('Replay server connection failed'));
    } catch (error) {
      console.warn('Replay server is not reachable', describeError(error));
      this.remoteState = 'closed';
      this.queue = [];
    }
  }

  private forward(chunk: Buffer): void {
    if (this.remoteState === 'open' && this.remote) {
      this.remote.send(chunk);
      this.sentBytes += chunk.length;
    } else if (this.remoteState === 'pending' && this.queuedBytes < MAX_BUFFERED_BYTES) {
      this.queue.push(chunk);
      this.queuedBytes += chunk.length;
    }
  }
}
