// Filters of the running games on the replays tab, as LiveGamesFilterController of the official client has them.

import type { LiveGame } from '../../../shared/contract.ts';
import { friendsIn } from './lobbyGames.ts';

export interface LiveFilters {
  /** Technical name of the featured mod; empty for any. */
  featuredMod: string;
  withFriends: boolean;
  hideModded: boolean;
  generatedOnly: boolean;
  /** Games of one player, e.g. against the AI. */
  hideSingle: boolean;
}

export const NO_LIVE_FILTERS: Readonly<LiveFilters> = {
  featuredMod: '',
  withFriends: false,
  hideModded: false,
  generatedOnly: false,
  hideSingle: false,
};

/** Players of the game; observers do not count. */
export function activePlayers(game: LiveGame): number {
  return game.teams.filter((team) => team.team !== -1).reduce((sum, team) => sum + team.players.length, 0);
}

export function matchesLiveFilters(game: LiveGame, filters: LiveFilters): boolean {
  return (
    (!filters.featuredMod || game.featuredMod === filters.featuredMod) &&
    (!filters.withFriends || friendsIn(game).length > 0) &&
    (!filters.hideModded || game.simMods.length === 0) &&
    (!filters.generatedOnly || game.generatedMap) &&
    (!filters.hideSingle || activePlayers(game) !== 1)
  );
}

/** Filters kept from an earlier session; anything unreadable is left off. */
export function parseLiveFilters(stored: unknown): LiveFilters {
  const raw = typeof stored === 'object' && stored !== null ? (stored as Partial<Record<keyof LiveFilters, unknown>>) : {};
  return {
    featuredMod: typeof raw.featuredMod === 'string' && raw.featuredMod.length <= 64 ? raw.featuredMod : '',
    withFriends: raw.withFriends === true,
    hideModded: raw.hideModded === true,
    generatedOnly: raw.generatedOnly === true,
    hideSingle: raw.hideSingle === true,
  };
}
