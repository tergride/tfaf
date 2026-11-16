// One connection to the FAF IRC server (Ergo) over WebSocket, as the official client's WebsocketNetworkHandler: one
// IRC line per WebSocket message. Registration negotiates IRCv3 capabilities and logs in with SASL PLAIN.

import { t } from '../i18n.ts';
import { formatIrcLine, type IrcMessage, parseIrcLine } from './ircMessage.ts';

export interface IrcConnectionOptions {
  url: string;
  nick: string;
  /** Shown to others by WHO and WHOIS; the nick when not given, as the official client does. */
  realname?: string;
  /** SASL PLAIN credentials: the official client uses `<login>@FAF` and `token:<chat token>`. */
  account: string;
  password: string;
  /** Capabilities to ask for when the server offers them; `sasl` is always asked for. */
  capabilities: string[];
  createSocket?: (url: string) => WebSocket;
  pingIntervalMs?: number;
}

export interface IrcConnectionEvents {
  /** Registration is complete: the server accepted the login, and messages may be sent. */
  onRegistered(capabilities: ReadonlySet<string>, nick: string): void;
  onMessage(message: IrcMessage): void;
  /** The connection is gone; `error` says why when it was not closed on purpose. */
  onClosed(error: string | null): void;
}

const PING_INTERVAL_MS = 60_000;
// A server that answers nothing for two pings is gone, even if the socket has not noticed.
const SILENCE_LIMIT_PINGS = 2;
const SASL_CHUNK = 400;
const MAX_NICK_RETRIES = 3;

export class IrcConnection {
  private readonly socket: WebSocket;
  private readonly options: IrcConnectionOptions;
  private readonly events: IrcConnectionEvents;
  private readonly offered = new Set<string>();
  private readonly enabled = new Set<string>();
  private nick: string;
  private nickRetries = 0;
  private registered = false;
  private closing = false;
  private finished = false;
  private lastReceived = Date.now();
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(options: IrcConnectionOptions, events: IrcConnectionEvents) {
    this.options = options;
    this.events = events;
    this.nick = options.nick;
    this.socket = (options.createSocket ?? ((url: string) => new WebSocket(url)))(options.url);
    this.socket.addEventListener('open', () => this.onOpen());
    this.socket.addEventListener('message', (event) => this.onData(event.data));
    this.socket.addEventListener('close', (event) => this.finish(t('main.chat.irc.closedCode', { code: event.code })));
    this.socket.addEventListener('error', () => this.finish(t('main.chat.irc.unreachable')));
  }

  get capabilities(): ReadonlySet<string> {
    return this.enabled;
  }

  send(command: string, params: string[] = [], tags: Record<string, string> = {}): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(formatIrcLine(command, params, tags));
    }
  }

  close(reason = 'Goodbye'): void {
    if (this.finished) {
      return;
    }
    this.closing = true;
    this.send('QUIT', [reason]);
    this.socket.close();
    this.finish(null);
  }

  private onOpen(): void {
    this.send('CAP', ['LS', '302']);
    this.send('NICK', [this.nick]);
    this.send('USER', [this.nick, '0', '*', this.options.realname ?? this.nick]);
    this.pingTimer = setInterval(() => this.keepAlive(), this.options.pingIntervalMs ?? PING_INTERVAL_MS);
  }

  private keepAlive(): void {
    const interval = this.options.pingIntervalMs ?? PING_INTERVAL_MS;
    if (Date.now() - this.lastReceived > interval * SILENCE_LIMIT_PINGS) {
      this.fail(t('main.chat.irc.notResponding'));
      return;
    }
    this.send('PING', ['tfaf']);
  }

  private onData(data: unknown): void {
    if (typeof data !== 'string') {
      return;
    }
    this.lastReceived = Date.now();
    for (const line of data.split(/\r?\n/)) {
      const message = line ? parseIrcLine(line) : null;
      if (message) {
        this.handle(message);
      }
    }
  }

  private handle(message: IrcMessage): void {
    switch (message.command) {
      case 'PING':
        this.send('PONG', message.params);
        return;
      case 'CAP':
        this.onCapability(message);
        return;
      case 'AUTHENTICATE':
        if (message.params[0] === '+') {
          this.sendSaslPayload();
        }
        return;
      case '903':
        this.send('CAP', ['END']);
        return;
      case '902':
      case '904':
      case '905':
      case '906':
        this.fail(t('main.chat.irc.loginRejected', { reason: message.params.at(-1) ?? message.command }));
        return;
      case '433':
        if (!this.registered && this.nickRetries < MAX_NICK_RETRIES) {
          this.nickRetries++;
          this.nick = `${this.options.nick}${'_'.repeat(this.nickRetries)}`;
          this.send('NICK', [this.nick]);
        }
        break;
      case '001':
        this.registered = true;
        this.nick = message.params[0] ?? this.nick;
        this.events.onRegistered(this.enabled, this.nick);
        break;
      case 'ERROR':
        this.fail(t('main.chat.irc.closedReason', { reason: message.params[0] ?? '' }));
        return;
      default:
        break;
    }
    if (this.registered) {
      this.events.onMessage(message);
    }
  }

  private onCapability(message: IrcMessage): void {
    const [, subcommand, ...rest] = message.params;
    const list = (rest.at(-1) ?? '').split(' ').filter(Boolean);
    switch (subcommand) {
      case 'LS': {
        // `CAP * LS * :...` continues on the next line; values after '=' (e.g. sasl=PLAIN) are not needed.
        list.forEach((capability) => this.offered.add(capability.split('=')[0]!));
        if (rest[0] === '*' && rest.length > 1) {
          return;
        }
        const wanted = ['sasl', ...this.options.capabilities].filter((capability) => this.offered.has(capability));
        if (!this.offered.has('sasl')) {
          this.fail(t('main.chat.irc.noSasl'));
          return;
        }
        this.send('CAP', ['REQ', wanted.join(' ')]);
        return;
      }
      case 'ACK':
        list.forEach((capability) => this.enabled.add(capability.replace(/^-/, '')));
        if (!this.registered && this.enabled.has('sasl')) {
          this.send('AUTHENTICATE', ['PLAIN']);
        }
        return;
      case 'NAK':
        // Asked for as one group, so a refusal takes everything; without SASL there is no login.
        this.fail(t('main.chat.irc.capabilitiesRejected', { capabilities: list.join(' ') }));
        return;
      default:
        return;
    }
  }

  private sendSaslPayload(): void {
    const { account, password } = this.options;
    const payload = Buffer.from(`${account}\0${account}\0${password}`, 'utf8').toString('base64');
    for (let offset = 0; offset < payload.length; offset += SASL_CHUNK) {
      this.send('AUTHENTICATE', [payload.slice(offset, offset + SASL_CHUNK)]);
    }
    if (payload.length % SASL_CHUNK === 0) {
      this.send('AUTHENTICATE', ['+']);
    }
  }

  /** Reports the end once, whichever of the socket events, an error or a close on purpose comes first. */
  private finish(error: string | null): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.events.onClosed(this.closing ? null : error);
  }

  /** Closes the socket because of a protocol failure, which `finish` then reports. */
  private fail(error: string): void {
    this.finish(error);
    this.socket.close();
  }
}
