// Replays of the FAF vault: the JSON:API query of each listing and the mapping of a `game` resource.

import type {
  Faction,
  GameResult,
  ReplayPeriod,
  ReplayPlayer,
  ReplayQuery,
  ReplayTeam,
  VaultReplay,
} from '../../shared/contract.ts';
import { asNumber, asObject, asString, type Resource } from '../api/jsonApi.ts';
import { rsqlAnd, rsqlContains, rsqlEquals, rsqlQuote } from '../api/rsql.ts';
import { t } from '../i18n.ts';
import { toReviews } from '../vault/apiMappers.ts';
import { type RatedPlayer, replayQuality } from './matchQuality.ts';

export const GAME_INCLUDES = [
  'featuredMod',
  'playerStats',
  'playerStats.player',
  'playerStats.ratingChanges',
  'mapVersion',
  'mapVersion.map',
  'reviewsSummary',
];
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PERIOD_MS: Record<Exclude<ReplayPeriod, 'all'>, number> = {
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
  year: 365 * DAY_MS,
};
// The game simulates 10 ticks per second.
const TICKS_PER_SECOND = 10;

const FACTIONS: Record<string, Faction> = {
  uef: 'uef',
  aeon: 'aeon',
  cybran: 'cybran',
  seraphim: 'seraphim',
  nomad: 'nomad',
  nomads: 'nomad',
  random: 'random',
};
const FACTIONS_BY_NUMBER: (Faction | null)[] = [null, 'uef', 'aeon', 'cybran', 'seraphim', 'nomad'];

const RESULTS: Record<string, GameResult> = {
  VICTORY: 'victory',
  DEFEAT: 'defeat',
  DRAW: 'draw',
  MUTUAL_DRAW: 'draw',
};

function parseFaction(value: unknown): Faction | null {
  if (typeof value === 'number') {
    return FACTIONS_BY_NUMBER[value] ?? null;
  }
  return FACTIONS[asString(value)?.toLowerCase() ?? ''] ?? null;
}

function displayedRating(mean: unknown, deviation: unknown): number | null {
  const m = asNumber(mean);
  const d = asNumber(deviation);
  return m === null || d === null ? null : Math.round(m - 3 * d);
}

function toReplayPlayer(stats: Record<string, unknown>): ReplayPlayer {
  const journal = asObject(Array.isArray(stats.ratingChanges) ? stats.ratingChanges[0] : null);
  const ai = stats.ai === true;
  return {
    login: asString(asObject(stats.player)?.login) ?? (ai ? 'AI' : '?'),
    ai,
    faction: parseFaction(stats.faction),
    ratingBefore: journal
      ? displayedRating(journal.meanBefore, journal.deviationBefore)
      : displayedRating(stats.beforeMean, stats.beforeDeviation),
    ratingAfter: journal
      ? displayedRating(journal.meanAfter, journal.deviationAfter)
      : displayedRating(stats.afterMean, stats.afterDeviation),
    result: RESULTS[asString(stats.result) ?? ''] ?? null,
  };
}

/** The rating before the game: the player's own fields, or those of the rating journal when they are missing. */
function ratedPlayer(stats: Record<string, unknown>, team: number): RatedPlayer {
  const journal = asObject(Array.isArray(stats.ratingChanges) ? stats.ratingChanges[0] : null);
  const mean = asNumber(stats.beforeMean);
  const deviation = asNumber(stats.beforeDeviation);
  return mean !== null && deviation !== null
    ? { team, mean, deviation }
    : { team, mean: asNumber(journal?.meanBefore), deviation: asNumber(journal?.deviationBefore) };
}

/** Maps a `game` resource with the includes of GAME_INCLUDES. */
export function toVaultReplay(resource: Resource): VaultReplay | null {
  const id = Number(resource.id);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  const mapVersion = asObject(resource.mapVersion);
  const featuredMod = asObject(resource.featuredMod);
  const byTeam = new Map<number, ReplayPlayer[]>();
  const rated: RatedPlayer[] = [];
  for (const entry of Array.isArray(resource.playerStats) ? resource.playerStats : []) {
    const stats = asObject(entry);
    if (stats) {
      const team = asNumber(stats.team) ?? 1;
      byTeam.set(team, [...(byTeam.get(team) ?? []), toReplayPlayer(stats)]);
      rated.push(ratedPlayer(stats, team));
    }
  }
  const teams: ReplayTeam[] = [...byTeam.entries()]
    .map(([team, players]) => ({ team, players: players.sort((a, b) => a.login.localeCompare(b.login)) }))
    .sort((a, b) => a.team - b.team);
  const ratings = teams.flatMap((team) => team.players.map((player) => player.ratingBefore)).filter((rating) => rating !== null);
  const ticks = asNumber(resource.replayTicks);
  return {
    id,
    title: asString(resource.name) ?? `#${id}`,
    mapName: asString(asObject(mapVersion?.map)?.displayName),
    mapFolderName: asString(mapVersion?.folderName),
    mapPreviewUrl: asString(mapVersion?.thumbnailUrlSmall),
    mapPreviewLargeUrl: asString(mapVersion?.thumbnailUrlLarge),
    featuredModName: asString(featuredMod?.displayName) ?? asString(featuredMod?.technicalName) ?? 'FAF',
    startedAt: asString(resource.startTime),
    endedAt: asString(resource.endTime),
    durationSeconds: ticks !== null && ticks > 0 ? Math.round(ticks / TICKS_PER_SECOND) : null,
    validity: asString(resource.validity),
    teams,
    averageRating: ratings.length > 0 ? Math.round(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) : null,
    quality: replayQuality(rated),
    reviews: toReviews(resource.reviewsSummary),
    available: resource.replayAvailable === true,
  };
}

function after(field: string, time: number): string {
  return `${field}=gt=${rsqlQuote(new Date(time).toISOString())}`;
}

/**
 * Filter and sort of a vault listing. The best rated games are read from the review summaries, each with its game, as
 * in ReplayService of the official client, so their filters go through `game`.
 */
export function replayListParams(query: ReplayQuery, userId: number | null, now = Date.now()): Record<string, string> {
  if (query.gameId !== undefined) {
    // ReplayService asks the games for it, whatever the sort.
    return { filter: rsqlEquals('id', query.gameId), sort: '-endTime' };
  }
  const game = query.sort === 'highestRated' ? 'game.' : '';
  const filters: string[] = [];
  if (query.player) {
    filters.push(rsqlEquals(`${game}playerStats.player.login`, query.player));
  }
  if (query.onlyOwn) {
    if (userId === null) {
      throw new Error(t('main.auth.signInRequired'));
    }
    filters.push(rsqlEquals(`${game}playerStats.player.id`, userId));
  }
  if (query.map) {
    filters.push(rsqlContains(`${game}mapVersion.map.displayName`, query.map));
  }
  if (query.featuredMod) {
    filters.push(rsqlEquals(`${game}featuredMod.technicalName`, query.featuredMod));
  }
  if (query.onlyRanked) {
    filters.push(rsqlEquals(`${game}validity`, 'VALID'));
  }
  if (query.period !== 'all') {
    // Counted from the start of the hour, so the same list is asked for, and cached, for an hour.
    filters.push(after(`${game}endTime`, Math.floor(now / HOUR_MS) * HOUR_MS - PERIOD_MS[query.period]));
  }
  const sort = query.sort === 'highestRated' ? '-lowerBound' : '-endTime';
  return filters.length > 0 ? { filter: rsqlAnd(filters), sort } : { sort };
}
