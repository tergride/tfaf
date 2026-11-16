// A join from a friend's Discord status. Its secret carries the password the server checks for the lobby, so the join
// goes like an invitation's; a secret without one (an older launcher's) joins like a join from the chat, which asks for
// the password. Discord may have started the launcher for it (discordLaunch.ts): the request then comes before the
// lobby server has signed us in and listed the games, so it waits for them a while.

import type { LobbyState } from '../../shared/contract.ts';
import { describeError } from '../errors.ts';
import type { GameRunner } from '../game/gameRunner.ts';
import { t } from '../i18n.ts';
import type { LobbyService } from '../lobby/lobbyService.ts';
import type { JoinAccess } from './presence.ts';

export interface DiscordJoinDependencies {
  lobby: Pick<LobbyService, 'getState' | 'getRawGame' | 'onStateChanged' | 'onGameChanged'>;
  games: Pick<GameRunner, 'join' | 'joinInvited'>;
  /** The game has a password the secret did not carry: the interface asks for it. */
  askPassword(gameId: number): void;
  failed(text: string): void;
}

// Long enough to sign in by hand after Discord started the launcher.
const SIGN_IN_WAIT_MS = 120_000;
// The server lists the games right after the login.
const GAMES_WAIT_MS = 10_000;

export class DiscordJoins {
  private readonly deps: DiscordJoinDependencies;
  private pending: JoinAccess | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(deps: DiscordJoinDependencies) {
    this.deps = deps;
    deps.lobby.onStateChanged((state) => this.onLobbyState(state));
    deps.lobby.onGameChanged((gameId) => {
      if (gameId === this.pending?.gameId) {
        this.check();
      }
    });
  }

  request(access: JoinAccess): void {
    this.cancel();
    // A launcher that has been signed in a while knows every game it can see: one it does not know fails at once.
    if (this.deps.lobby.getState().status === 'connected') {
      this.join(access);
      return;
    }
    console.info(`Join of game ${access.gameId} from Discord waits for the lobby server`);
    this.pending = access;
    this.wait(SIGN_IN_WAIT_MS);
  }

  private onLobbyState(state: LobbyState): void {
    if (this.pending !== null && state.status === 'connected') {
      this.wait(GAMES_WAIT_MS);
      this.check();
    }
  }

  private check(): void {
    const access = this.pending;
    if (access !== null && this.deps.lobby.getState().status === 'connected' && this.deps.lobby.getRawGame(access.gameId)) {
      this.cancel();
      this.join(access);
    }
  }

  private join({ gameId, password }: JoinAccess): void {
    if (!this.deps.lobby.getRawGame(gameId)) {
      this.deps.failed(t('main.discord.gameNotFound'));
      return;
    }
    const { games } = this.deps;
    (password === null ? games.join(gameId, null) : games.joinInvited(gameId, password)).then(
      (outcome) => {
        if (outcome === 'passwordRequired') {
          this.deps.askPassword(gameId);
        }
      },
      (error: unknown) => this.deps.failed(describeError(error)),
    );
  }

  private wait(ms: number): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pending !== null) {
        console.info(`Game ${this.pending.gameId} from Discord did not appear in time`);
        this.pending = null;
        this.deps.failed(t('main.discord.gameNotFound'));
      }
    }, ms);
    this.timer.unref();
  }

  private cancel(): void {
    this.pending = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
