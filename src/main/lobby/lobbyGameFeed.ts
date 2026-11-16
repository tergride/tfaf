import type { LobbyGame, LobbyGamesUpdate } from '../../shared/contract.ts';
import { type GameMappingContext, isListedGame, type RawGame, toLobbyGame } from './lobbyProtocol.ts';

const FLUSH_DELAY_MS = 200;
// After a short drop the list stays as it was; only a long outage empties it.
const STALE_GAMES_MS = 60_000;
// How long after login the full game list is collected before the renderer gets it.
const RESYNC_DELAY_MS = 1_000;

export interface GameFeedSource {
  games: ReadonlyMap<number, RawGame>;
  /** What a game is shown with: its players, the friend list and the featured mod names. */
  context(): GameMappingContext;
  /** A game changed, listed or not. */
  onGameChanged(gameId: number): void;
  onUpdate(update: LobbyGamesUpdate): void;
  /** The lobby stayed away too long: its players and games are no longer current. */
  onStale(): void;
}

/** The list of games as the renderer has it: changes go out in batches, and a reconnect does not empty it at once. */
export class LobbyGameFeed {
  private readonly source: GameFeedSource;
  private readonly sentGameIds = new Set<number>();
  private readonly dirtyGameIds = new Set<number>();
  private flushTimer: NodeJS.Timeout | null = null;
  private staleTimer: NodeJS.Timeout | null = null;
  private resyncPending = false;
  private paused = false;
  private held = false;

  constructor(source: GameFeedSource) {
    this.source = source;
  }

  /** The renderer shows a list, so a reconnect may keep it until the new one has arrived. */
  get showing(): boolean {
    return this.sentGameIds.size > 0;
  }

  /** Full list of visible games; the renderer replaces its copy with it and applies later updates on top. */
  snapshot(): LobbyGame[] {
    this.cancelFlush();
    this.dirtyGameIds.clear();
    const visible = [...this.source.games.values()].filter(isListedGame);
    this.sentGameIds.clear();
    visible.forEach((game) => this.sentGameIds.add(game.id));
    const context = this.source.context();
    return visible.map((game) => toLobbyGame(game, context));
  }

  markDirty(gameId: number): void {
    this.dirtyGameIds.add(gameId);
    this.scheduleFlush();
  }

  /** The friend list changed, and with it the friend marks of players in any listed game. */
  resend(): void {
    if (this.sentGameIds.size > 0) {
      this.resyncPending = true;
      this.scheduleFlush();
    }
  }

  /** The server sends the whole list again after login; the renderer gets it in one update once it has arrived. */
  resyncSoon(): void {
    this.resyncPending = true;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, RESYNC_DELAY_MS);
  }

  /** Paused, the renderer's list stays as it is, and once resumed it gets the whole list if anything changed. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused && this.held) {
      this.held = false;
      this.resyncPending = true;
      this.scheduleFlush();
    }
  }

  markStale(): void {
    this.staleTimer ??= setTimeout(() => {
      this.staleTimer = null;
      this.source.onStale();
    }, STALE_GAMES_MS);
  }

  /** Forgets what the renderer was sent; `notify` empties its list too. */
  reset(notify: boolean): void {
    if (this.staleTimer) {
      clearTimeout(this.staleTimer);
      this.staleTimer = null;
    }
    this.cancelFlush();
    this.resyncPending = false;
    this.held = false;
    this.dirtyGameIds.clear();
    this.sentGameIds.clear();
    if (notify) {
      this.source.onUpdate({ reset: true, upserts: [], removals: [] });
    }
  }

  private scheduleFlush(): void {
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, FLUSH_DELAY_MS);
  }

  private cancelFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private flush(): void {
    for (const id of this.dirtyGameIds) {
      this.source.onGameChanged(id);
    }
    if (this.paused) {
      this.held ||= this.resyncPending || this.dirtyGameIds.size > 0;
      this.resyncPending = false;
      this.dirtyGameIds.clear();
      return;
    }
    if (this.resyncPending) {
      this.resyncPending = false;
      this.source.onUpdate({ reset: true, upserts: this.snapshot(), removals: [] });
      return;
    }
    const context = this.source.context();
    const upserts: LobbyGame[] = [];
    const removals: number[] = [];
    for (const id of this.dirtyGameIds) {
      const game = this.source.games.get(id);
      if (game && isListedGame(game)) {
        upserts.push(toLobbyGame(game, context));
        this.sentGameIds.add(id);
      } else if (this.sentGameIds.delete(id)) {
        removals.push(id);
      }
    }
    this.dirtyGameIds.clear();
    if (upserts.length > 0 || removals.length > 0) {
      this.source.onUpdate({ reset: false, upserts, removals });
    }
  }
}
