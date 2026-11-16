import { t } from '../i18n.ts';
import type { LobbyMessage } from './lobbyProtocol.ts';

const REPLY_TIMEOUT_MS = 30_000;

interface Waiter {
  commands: string[];
  accepts(message: LobbyMessage): boolean;
  resolve(message: LobbyMessage): void;
  reject(error: Error): void;
}

/** Requests waiting for the server's answer: each takes the first message of its commands that it accepts. */
export class LobbyReplies {
  private readonly waiters = new Set<Waiter>();

  wait(
    commands: string[],
    timeoutMs = REPLY_TIMEOUT_MS,
    accepts: (message: LobbyMessage) => boolean = () => true,
  ): Promise<LobbyMessage> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(t('main.lobby.replyTimeout')));
      }, timeoutMs);
      const waiter: Waiter = {
        commands,
        accepts,
        resolve: (message) => {
          clearTimeout(timeout);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      };
      this.waiters.add(waiter);
    });
  }

  /** Hands the message to everyone waiting for it; false when nobody was. */
  deliver(message: LobbyMessage): boolean {
    let awaited = false;
    for (const waiter of this.waiters) {
      if (waiter.commands.includes(message.command) && waiter.accepts(message)) {
        this.waiters.delete(waiter);
        waiter.resolve(message);
        awaited = true;
      }
    }
    return awaited;
  }

  rejectAll(error: Error): void {
    for (const waiter of this.waiters) {
      waiter.reject(error);
    }
    this.waiters.clear();
  }
}
