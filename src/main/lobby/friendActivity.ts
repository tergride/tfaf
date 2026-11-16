import type { LobbyPlayer, RawGame } from './lobbyProtocol.ts';

export type FriendEvent =
  | { type: 'online' | 'offline'; player: LobbyPlayer }
  | { type: 'joinedGame' | 'startedPlaying'; player: LobbyPlayer; game: RawGame };

export interface PlayerChange {
  /** Undefined when the player was not online before. */
  previous: LobbyPlayer | undefined;
  /** Null when the player has gone offline. */
  next: LobbyPlayer | null;
}

export interface GameChange {
  previous: RawGame | undefined;
  next: RawGame;
}

function playerIds(game: RawGame | undefined): Set<number> {
  return new Set(game?.teamIds.flatMap((team) => team.playerIds));
}

/**
 * Tells what friends do from lobby updates: come online, leave, join an open custom or coop game, start playing.
 * After every login the server sends everyone online and all games again. Those lists describe the lobby as it is, so
 * they raise nothing; otherwise each login and reconnect would announce every friend once more.
 */
export class FriendActivity {
  private playersSynced = false;
  private gamesSynced = false;

  /** A login follows: its first player list and its full game list are a snapshot, not news. */
  reset(): void {
    this.playersSynced = false;
    this.gamesSynced = false;
  }

  playersChanged(changes: readonly PlayerChange[], friends: ReadonlySet<number>): FriendEvent[] {
    if (!this.playersSynced) {
      this.playersSynced = true;
      return [];
    }
    const events: FriendEvent[] = [];
    for (const { previous, next } of changes) {
      if (!previous && next && friends.has(next.id)) {
        events.push({ type: 'online', player: next });
      } else if (previous && !next && friends.has(previous.id)) {
        events.push({ type: 'offline', player: previous });
      }
    }
    return events;
  }

  /**
   * `snapshot` marks the full list sent after login (a `game_info` with `games`); updates of single games before it
   * cannot be told from the state the client missed, so they raise nothing either.
   */
  gamesChanged(
    changes: readonly GameChange[],
    snapshot: boolean,
    players: ReadonlyMap<number, LobbyPlayer>,
    friends: ReadonlySet<number>,
  ): FriendEvent[] {
    if (snapshot) {
      this.gamesSynced = true;
      return [];
    }
    if (!this.gamesSynced) {
      return [];
    }
    const events: FriendEvent[] = [];
    for (const { previous, next: game } of changes) {
      const started = game.state === 'playing' && previous?.state !== 'playing';
      const joinable = game.state === 'open' && (game.gameType === 'custom' || game.gameType === 'coop');
      if (!started && !joinable) {
        continue;
      }
      const before = playerIds(previous);
      for (const id of playerIds(game)) {
        const player = players.get(id);
        if (!player || !friends.has(id)) {
          continue;
        }
        if (started) {
          events.push({ type: 'startedPlaying', player, game });
        } else if (!before.has(id)) {
          events.push({ type: 'joinedGame', player, game });
        }
      }
    }
    return events;
  }
}
