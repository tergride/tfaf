// Replays the user started watching, as ReplayHistoryPrefs of the official client keeps them, but only the latest
// WATCHED_REPLAYS_MAX: the list lives in settings.json, which is read and written whole.

import { WATCHED_REPLAYS_MAX } from '../../shared/contract.ts';

function isReplayId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Oldest first; a repeated id keeps its latest place. */
function latestUnique(ids: readonly number[], max: number): number[] {
  const seen = new Set<number>();
  const newestFirst: number[] = [];
  for (let index = ids.length - 1; index >= 0 && newestFirst.length < max; index--) {
    const id = ids[index]!;
    if (!seen.has(id)) {
      seen.add(id);
      newestFirst.push(id);
    }
  }
  return newestFirst.reverse();
}

/** The stored list with anything that is not a replay id dropped. */
export function parseWatchedReplays(stored: unknown, max = WATCHED_REPLAYS_MAX): number[] {
  return Array.isArray(stored) ? latestUnique(stored.filter(isReplayId), max) : [];
}

/** The list with the replay as the newest; the oldest fall out past `max`. */
export function withWatchedReplay(ids: readonly number[], replayId: number, max = WATCHED_REPLAYS_MAX): number[] {
  return latestUnique([...ids, replayId], max);
}
