// Discord Rich Presence over the local IPC pipe of the Discord app (`\\?\pipe\discord-ipc-N`), as discord-rpc does:
// handshake, then SET_ACTIVITY for the status and SUBSCRIBE for joins and requests to join from it. Without a running
// Discord it tries again now and then.

import net from 'node:net';
import { describeError } from '../errors.ts';
import { DISCORD_OPCODES, type DiscordFrame, encodeFrame, FrameDecoder } from './discordIpc.ts';
import type { DiscordActivity } from './presence.ts';

export interface DiscordRpcEvents {
  /** A friend accepted an invitation to the game from the status; the secret is the one the activity carried. */
  onJoin(secret: string): void;
  /** A friend pressed "Ask to Join" on the status; `acceptJoinRequest` lets them in. */
  onJoinRequest(userId: string): void;
}

const PIPE_COUNT = 10;
const RETRY_MS = 30_000;
const SUBSCRIBED_EVENTS = ['ACTIVITY_JOIN', 'ACTIVITY_JOIN_REQUEST'];
// Discord user ids are snowflakes: 64-bit integers written as strings.
const DISCORD_USER_ID = /^\d{1,20}$/;

function pipePath(index: number): string {
  return `\\\\?\\pipe\\discord-ipc-${index}`;
}

function openPipe(path: string): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection(path);
    const fail = (): void => {
      socket.destroy();
      resolve(null);
    };
    socket.once('connect', () => {
      socket.off('error', fail);
      resolve(socket);
    });
    socket.once('error', fail);
  });
}

export class DiscordRpc {
  private readonly clientId: string;
  private readonly events: DiscordRpcEvents;
  private socket: net.Socket | null = null;
  private ready = false;
  private enabled = false;
  private connecting = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private activity: DiscordActivity | null = null;
  private sentActivity: string | null = null;
  private nonce = 0;
  // The log notes once that Discord is not running, not on every retry.
  private reportedMissing = false;

  constructor(clientId: string, events: DiscordRpcEvents) {
    this.clientId = clientId;
    this.events = events;
  }

  /** Off, the status is cleared and the pipe closed; on, it connects whenever Discord runs. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) {
      return;
    }
    this.enabled = enabled;
    if (enabled) {
      void this.connect();
      return;
    }
    if (this.ready) {
      this.command('SET_ACTIVITY', { pid: process.pid, activity: null });
    }
    this.close();
  }

  setActivity(activity: DiscordActivity | null): void {
    this.activity = activity;
    this.sendActivity();
  }

  /** Discord then sends the friend the join secret of the status, as discord-rpc's Discord_Respond with YES. */
  acceptJoinRequest(userId: string): void {
    if (this.ready) {
      this.command('SEND_ACTIVITY_JOIN_INVITE', { user_id: userId });
    }
  }

  private async connect(): Promise<void> {
    if (this.connecting || this.socket || !this.enabled) {
      return;
    }
    this.connecting = true;
    try {
      for (let index = 0; index < PIPE_COUNT && this.enabled; index += 1) {
        const socket = await openPipe(pipePath(index));
        if (socket) {
          this.attach(socket);
          return;
        }
      }
      if (!this.reportedMissing) {
        this.reportedMissing = true;
        console.info(`Discord is not running; the status waits for it (tries every ${RETRY_MS / 1000} s)`);
      }
      this.scheduleRetry();
    } finally {
      this.connecting = false;
    }
  }

  private attach(socket: net.Socket): void {
    if (!this.enabled) {
      socket.destroy();
      return;
    }
    this.socket = socket;
    const decoder = new FrameDecoder();
    socket.on('data', (chunk: Buffer) => {
      try {
        decoder.push(chunk).forEach((frame) => this.onFrame(frame));
      } catch (error) {
        console.warn('Discord IPC broke off', describeError(error));
        this.close();
        this.scheduleRetry();
      }
    });
    socket.on('error', (error) => console.warn('Discord IPC error', describeError(error)));
    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null;
        this.ready = false;
        this.scheduleRetry();
      }
    });
    socket.write(encodeFrame(DISCORD_OPCODES.handshake, { v: 1, client_id: this.clientId }));
  }

  private onFrame(frame: DiscordFrame): void {
    const payload = typeof frame.payload === 'object' && frame.payload !== null ? (frame.payload as Record<string, unknown>) : {};
    if (frame.op === DISCORD_OPCODES.ping) {
      this.socket?.write(encodeFrame(DISCORD_OPCODES.pong, frame.payload));
      return;
    }
    if (frame.op === DISCORD_OPCODES.close) {
      const reason = payload.message ?? payload.code ?? '';
      console.warn(`Discord closed the IPC connection: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`);
      this.close();
      this.scheduleRetry();
      return;
    }
    if (frame.op !== DISCORD_OPCODES.frame || payload.cmd !== 'DISPATCH') {
      if (payload.evt === 'ERROR') {
        console.warn('Discord refused a command', JSON.stringify(payload.data));
      }
      return;
    }
    const data = typeof payload.data === 'object' && payload.data !== null ? (payload.data as Record<string, unknown>) : {};
    const secret = typeof data.secret === 'string' ? data.secret : null;
    switch (payload.evt) {
      case 'READY':
        console.info('Discord status connected');
        this.reportedMissing = false;
        this.ready = true;
        this.sentActivity = null;
        SUBSCRIBED_EVENTS.forEach((event) => this.command('SUBSCRIBE', {}, event));
        this.sendActivity();
        break;
      case 'ACTIVITY_JOIN':
        if (secret) {
          this.events.onJoin(secret);
        }
        break;
      case 'ACTIVITY_JOIN_REQUEST': {
        const user = typeof data.user === 'object' && data.user !== null ? (data.user as Record<string, unknown>) : {};
        if (typeof user.id === 'string' && DISCORD_USER_ID.test(user.id)) {
          this.events.onJoinRequest(user.id);
        }
        break;
      }
      default:
        break;
    }
  }

  /** Only a changed activity is sent: Discord limits how often it may be set. */
  private sendActivity(): void {
    if (!this.ready) {
      return;
    }
    const serialized = JSON.stringify(this.activity);
    if (serialized === this.sentActivity) {
      return;
    }
    this.sentActivity = serialized;
    this.command('SET_ACTIVITY', { pid: process.pid, activity: this.activity });
  }

  private command(cmd: string, args: unknown, evt?: string): void {
    this.nonce += 1;
    this.socket?.write(encodeFrame(DISCORD_OPCODES.frame, { cmd, args, ...(evt ? { evt } : {}), nonce: String(this.nonce) }));
  }

  private close(): void {
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    this.sentActivity = null;
    socket?.destroy();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private scheduleRetry(): void {
    if (!this.enabled || this.retryTimer) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, RETRY_MS);
    this.retryTimer.unref();
  }
}
