// Keeps the Discord status in step with the launcher, and turns joins from Discord into games.

import type { GameSessionState, MatchmakerState } from '../../shared/contract.ts';
import type { RawGame } from '../lobby/lobbyProtocol.ts';
import type { SettingsStore } from '../settings.ts';
import { DiscordRpc } from './discordRpc.ts';
import { buildActivity, type JoinAccess, parseGameSecret } from './presence.ts';

export interface DiscordPresenceDependencies {
  settings: SettingsStore;
  gameState(): GameSessionState;
  rawGame(gameId: number): RawGame | null;
  matchmakerState(): MatchmakerState | null;
  /** Our open lobby and the password the server checks for it, which the join secret of the status carries. */
  joinAccess(): JoinAccess | null;
  /** We join through a friend's status, with the password from its secret; without one a lobby that has it asks. */
  join(access: JoinAccess): void;
  /** Whether Discord may start the launcher for a join from a friend's status (discordLaunch.ts). */
  setLaunchable(launchable: boolean): void;
}

/** TFAF's own Discord application, whose pictures the status shows; a build may name another in TFAF_DISCORD_APP_ID. */
export const DISCORD_APP_ID = process.env.TFAF_DISCORD_APP_ID || '1563526930920120541';

// Lobbies fill up and empty; the status is looked at again this often.
const REFRESH_MS = 30_000;

export class DiscordPresence {
  private readonly deps: DiscordPresenceDependencies;
  private readonly rpc: DiscordRpc;
  private searchSince: number | null = null;
  private launchable: boolean | null = null;

  constructor(clientId: string, deps: DiscordPresenceDependencies) {
    this.deps = deps;
    this.rpc = new DiscordRpc(clientId, {
      onJoin: (secret) => this.onJoin(secret),
      // Discord friends join the public party at once. Whoever Discord still has ask (not a friend, or Discord's own
      // privacy settings say so) is let in too, like the official client does.
      onJoinRequest: (userId) => {
        if (this.joinsAllowed()) {
          console.info('A friend asked to join from the Discord status; letting them in');
          this.rpc.acceptJoinRequest(userId);
        }
      },
    });
    setInterval(() => this.update(), REFRESH_MS).unref();
  }

  /** Called whenever what the status shows may have changed: the game, the search, the settings. */
  update(): void {
    const prefs = this.deps.settings.get().discord;
    this.rpc.setEnabled(prefs.showStatus);
    const launchable = this.joinsAllowed();
    if (launchable !== this.launchable) {
      this.launchable = launchable;
      this.deps.setLaunchable(launchable);
    }
    const matchmaker = this.deps.matchmakerState();
    const searching = matchmaker?.searching ?? false;
    this.searchSince = searching ? (this.searchSince ?? Date.now()) : null;
    if (!prefs.showStatus) {
      return;
    }
    const game = this.deps.gameState();
    const queues = (matchmaker?.queues ?? []).filter((queue) => queue.status === 'searching').map((queue) => queue.title);
    this.rpc.setActivity(
      buildActivity({
        game,
        lobbyGame: game.gameId === null ? null : this.deps.rawGame(game.gameId),
        search: this.searchSince === null ? null : { queues, since: this.searchSince },
        allowJoin: prefs.allowJoin,
        access: this.deps.joinAccess(),
      }),
    );
  }

  private joinsAllowed(): boolean {
    const prefs = this.deps.settings.get().discord;
    return prefs.showStatus && prefs.allowJoin;
  }

  private onJoin(secret: string): void {
    const access = parseGameSecret(secret);
    if (access !== null && this.deps.settings.get().discord.allowJoin) {
      this.deps.join(access);
    }
  }
}
