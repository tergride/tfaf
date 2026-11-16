// Player profiles from the FAF API, as the official client's player window shows them, with what the lobby knows of
// a player who is online.

import type {
  MatchmakerFaction,
  PlayerProfile,
  PlayerSearchResult,
  PlayerStatistics,
  ProfileAchievement,
  ProfilePeriod,
  ProfileRating,
  RatingHistoryPoint,
  UnitCounts,
} from '../../shared/contract.ts';
import type { FafApi } from '../api/fafApi.ts';
import { asNumber, asObject, asString, type Resource, resolveDocument } from '../api/jsonApi.ts';
import { rsqlAnd, rsqlEquals, rsqlQuote, rsqlStartsWith } from '../api/rsql.ts';
import { mapLimited } from '../concurrency.ts';
import { describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import type { LobbyPlayer, RawGame } from '../lobby/lobbyProtocol.ts';

const PLAYER_CACHE_MS = 5 * 60 * 1000;
const DEFINITIONS_CACHE_MS = 24 * 60 * 60 * 1000;
const HISTORY_PAGE_SIZE = 100;
const HISTORY_PAGE_CONCURRENCY = 6;
const MAX_HISTORY_PAGES = 500;
const LIST_PAGE_SIZE = '1000';
const SEARCH_LIMIT = 10;
const MIN_SEARCH_LENGTH = 2;

// The order and names of the official client (leaderboard.<technicalName>.name); `global` is translated.
const LEADERBOARD_ORDER = ['global', 'ladder_1v1', 'tmm_2v2', 'tmm_3v3', 'tmm_4v4_full_share', 'tmm_4v4_share_until_death'];
const LEADERBOARD_NAMES: Record<string, string> = {
  ladder_1v1: '1v1',
  tmm_2v2: '2v2',
  tmm_3v3: '3v3',
  tmm_4v4_full_share: '4v4 Full Share',
  tmm_4v4_share_until_death: '4v4 No Share',
};

// Pictures are shown only from the hosts the renderer's content security policy allows.
const IMAGE_HOSTS = new Set(['content.faforever.com', 'content.faforever.xyz', 'direct.faforever.com', 'direct.faforever.xyz']);

/** Event ids of the official client's EventService. */
export const PLAYER_EVENTS = {
  customGames: 'cfa449a6-655b-48d5-9a27-6044804fe35c',
  ladderGames: '4a929def-e347-45b4-b26d-4325a3115859',
  secondsPlayed: 'cc791f00-343c-48d4-b5b3-8900b83209c0',
  lostAcus: 'd6a699b7-99bc-4a7f-b128-15e1e289a7b3',
  built: {
    air: '3ebb0c4d-5e92-4446-bf52-d17ba9c5cd3c',
    land: 'ea123d7f-bb2e-4a71-bd31-88859f0c3c00',
    naval: 'b5265b42-1747-4ba1-936c-292202637ce6',
    tech1: 'a8ee4f40-1e30-447b-bc2c-b03065219795',
    tech2: '89d4f391-ed2d-4beb-a1ca-6b93db623c04',
    tech3: '92617974-8c1f-494d-ab86-65c2a95d1486',
    experimentals: 'ed9fd79d-5ec7-4243-9ccf-f18c4f5baef1',
    engineers: '60bb1fc0-601b-45cd-bd26-83b1a1ac979b',
  },
  lost: {
    air: '225e9b2e-ae09-4ae1-a198-eca8780b0fcd',
    land: 'a1a3fd33-abe2-4e56-800a-b72f4c925825',
    naval: '3a7b3667-0f79-4ac7-be63-ba841fd5ef05',
    tech1: '3dd3ed78-ce78-4006-81fd-10926738fbf3',
    tech2: 'aebd750b-770b-4869-8e37-4d4cfdc480d0',
    tech3: '7f15c2be-80b7-4573-8f41-135f84773e0f',
    experimentals: '701ca426-0943-4931-85af-6a08d36d9aaa',
    engineers: 'e8e99a68-de1b-4676-860d-056ad2207119',
  },
  factions: {
    uef: { plays: '1b900d26-90d2-43d0-a64e-ed90b74c3704', wins: '7be6fdc5-7867-4467-98ce-f7244a66625a' },
    aeon: { plays: '96ccc66a-c5a0-4f48-acaa-888b00778b57', wins: 'a6b51c26-64e6-4e7a-bda7-ea1cfe771ebb' },
    cybran: { plays: 'ad193982-e7ca-465c-80b0-5493f9739559', wins: '56b06197-1890-42d0-8b59-25e1add8dc9a' },
    seraphim: { plays: 'fefcb392-848f-4836-9683-300b283bc308', wins: '15b6c19a-6084-4e82-ada9-6c30e282191f' },
  } satisfies Record<MatchmakerFaction, { plays: string; wins: string }>,
} as const;

export interface ProfileLobby {
  getPlayer(playerId: number): LobbyPlayer | null;
  getPlayerGame(playerId: number): RawGame | null;
}

function displayed(mean: number, deviation: number): number {
  return Math.trunc(mean - 3 * deviation);
}

function relationshipId(value: unknown): string | null {
  return asString(asObject(value)?.id);
}

function imageUrl(value: unknown): string | null {
  const text = asString(value);
  if (!text) {
    return null;
  }
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && IMAGE_HOSTS.has(url.hostname) ? text : null;
  } catch {
    return null;
  }
}

function leaderboardRank(technicalName: string): number {
  const index = LEADERBOARD_ORDER.indexOf(technicalName);
  return index < 0 ? LEADERBOARD_ORDER.length : index;
}

export function leaderboardName(technicalName: string): string {
  return technicalName === 'global' ? t('main.profile.globalLeaderboard') : (LEADERBOARD_NAMES[technicalName] ?? technicalName);
}

/** `leaderboardRating` resources with their leaderboard included, in the official client's order. */
export function parseProfileRatings(document: unknown): ProfileRating[] {
  return resolveDocument(document)
    .items.flatMap((resource): ProfileRating[] => {
      const leaderboard = asObject(resource.leaderboard);
      const technicalName = asString(leaderboard?.technicalName);
      const mean = asNumber(resource.mean);
      const deviation = asNumber(resource.deviation);
      if (!leaderboard || !technicalName || mean === null || deviation === null) {
        return [];
      }
      return [
        {
          leaderboardId: String(leaderboard.id),
          technicalName,
          name: leaderboardName(technicalName),
          rating: displayed(mean, deviation),
          totalGames: asNumber(resource.totalGames) ?? 0,
          wonGames: asNumber(resource.wonGames) ?? 0,
        },
      ];
    })
    .sort((a, b) => leaderboardRank(a.technicalName) - leaderboardRank(b.technicalName) || a.name.localeCompare(b.name));
}

/** Earlier logins, newest first. */
export function parseNameRecords(document: unknown): PlayerProfile['names'] {
  return resolveDocument(document)
    .items.flatMap((resource) => {
      const name = asString(resource.name);
      return name ? [{ name, changedAt: asString(resource.changeTime) }] : [];
    })
    .sort((a, b) => (b.changedAt ?? '').localeCompare(a.changedAt ?? ''));
}

export function parseClan(document: unknown): PlayerProfile['clan'] {
  for (const membership of resolveDocument(document).items) {
    const clan = asObject(membership.clan);
    const tag = asString(clan?.tag);
    const name = asString(clan?.name);
    if (tag && name) {
      return { tag, name };
    }
  }
  return null;
}

/**
 * Points of the rating chart from pages of `leaderboardRatingJournal` with `gamePlayerStats` included, oldest first.
 * The rating after each game is shown, so the last point is the current rating; a journal entry without it (a game
 * still being rated) falls back to the rating before.
 */
export function parseRatingHistory(documents: readonly unknown[]): RatingHistoryPoint[] {
  return documents
    .flatMap((document) => resolveDocument(document).items)
    .flatMap((resource): RatingHistoryPoint[] => {
      const stats = asObject(resource.gamePlayerStats);
      const time = asString(stats?.scoreTime);
      const mean = asNumber(resource.meanAfter) ?? asNumber(resource.meanBefore);
      const deviation = asNumber(resource.deviationAfter) ?? asNumber(resource.deviationBefore);
      if (!time || Number.isNaN(Date.parse(time)) || mean === null || deviation === null) {
        return [];
      }
      const gameId = Number(relationshipId(stats?.game));
      return [{ time, rating: displayed(mean, deviation), gameId: Number.isSafeInteger(gameId) && gameId > 0 ? gameId : null }];
    })
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

/**
 * The start of the period, at midnight UTC so that the same day asks the API the same question. A day the earlier
 * month lacks becomes its last day, as LocalDate.minusMonths does in the official client.
 */
export function historySince(period: ProfilePeriod, now: Date): string | null {
  if (period === 'all') {
    return null;
  }
  const year = now.getUTCFullYear() - (period === 'year' ? 1 : 0);
  const month = now.getUTCMonth() - (period === 'month' ? 1 : 0);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(now.getUTCDate(), lastDay))).toISOString();
}

/** All achievements in their order, with the player's progress; hidden ones keep their name until unlocked. */
export function parseAchievements(definitions: unknown, progress: unknown): ProfileAchievement[] {
  const byAchievement = new Map<string, Resource>();
  for (const item of resolveDocument(progress).items) {
    const id = relationshipId(item.achievement);
    if (id) {
      byAchievement.set(id, item);
    }
  }
  return resolveDocument(definitions)
    .items.map((definition) => ({ definition, order: asNumber(definition.order) ?? 0 }))
    .sort((a, b) => a.order - b.order)
    .map(({ definition }): ProfileAchievement => {
      const own = byAchievement.get(definition.id);
      const ownState = asString(own?.state);
      const state =
        ownState === 'UNLOCKED' ? 'unlocked' : asString(definition.initialState) === 'HIDDEN' && ownState !== 'REVEALED' ? 'hidden' : 'revealed';
      const incremental = asString(definition.type) === 'INCREMENTAL';
      return {
        id: definition.id,
        name: state === 'hidden' ? '' : (asString(definition.name) ?? ''),
        description: state === 'hidden' ? '' : (asString(definition.description) ?? ''),
        iconUrl: state === 'hidden' ? null : imageUrl(state === 'unlocked' ? definition.unlockedIconUrl : definition.revealedIconUrl),
        state,
        currentSteps: incremental ? (asNumber(own?.currentSteps) ?? 0) : null,
        totalSteps: incremental ? asNumber(definition.totalSteps) : null,
        unlockedAt: state === 'unlocked' ? (asString(own?.updateTime) ?? asString(own?.createTime)) : null,
        experiencePoints: asNumber(definition.experiencePoints) ?? 0,
      };
    });
}

/** `playerEvent` counters by event id, without the events included: the id is in the relationship. */
export function parseStatistics(document: unknown): PlayerStatistics {
  const counts = new Map<string, number>();
  for (const item of resolveDocument(document).items) {
    const event = relationshipId(item.event);
    const count = asNumber(item.currentCount);
    if (event && count !== null) {
      counts.set(event, count);
    }
  }
  const count = (event: string): number => counts.get(event) ?? 0;
  const units = (events: Record<keyof UnitCounts, string>): UnitCounts => ({
    air: count(events.air),
    land: count(events.land),
    naval: count(events.naval),
    tech1: count(events.tech1),
    tech2: count(events.tech2),
    tech3: count(events.tech3),
    experimentals: count(events.experimentals),
    engineers: count(events.engineers),
  });
  return {
    factions: (Object.entries(PLAYER_EVENTS.factions) as [MatchmakerFaction, { plays: string; wins: string }][]).map(
      ([faction, events]) => ({ faction, games: count(events.plays), wins: count(events.wins) }),
    ),
    built: units(PLAYER_EVENTS.built),
    lost: { ...units(PLAYER_EVENTS.lost), acus: count(PLAYER_EVENTS.lostAcus) },
    secondsPlayed: count(PLAYER_EVENTS.secondsPlayed),
    customGames: count(PLAYER_EVENTS.customGames),
    ladderGames: count(PLAYER_EVENTS.ladderGames),
  };
}

export class ProfileService {
  private readonly api: FafApi;
  private readonly lobby: ProfileLobby;

  constructor(api: FafApi, lobby: ProfileLobby) {
    this.api = api;
    this.lobby = lobby;
  }

  async get(player: number | string): Promise<PlayerProfile> {
    const filter = typeof player === 'number' ? rsqlEquals('id', player) : rsqlEquals('login', player);
    const found = resolveDocument(await this.api.getCached('/data/player', { filter, 'page[size]': '1' }, PLAYER_CACHE_MS)).items[0];
    const id = Number(found?.id);
    const login = asString(found?.login);
    if (!found || !login || !Number.isSafeInteger(id)) {
      throw new Error(t('main.profile.notFound'));
    }
    const byPlayer = rsqlEquals('player.id', id);
    // The clan and the earlier logins are extras: the profile still opens without them.
    const extra = <T>(what: string, load: Promise<unknown>, parse: (document: unknown) => T, fallback: T): Promise<T> =>
      load.then(parse).catch((error: unknown) => {
        console.warn(`Player ${what} could not be loaded`, describeError(error));
        return fallback;
      });
    const [ratings, names, clan] = await Promise.all([
      this.api.getCached(
        '/data/leaderboardRating',
        { filter: byPlayer, include: 'leaderboard', 'page[size]': '100' },
        PLAYER_CACHE_MS,
      ),
      extra('names', this.api.getCached('/data/nameRecord', { filter: byPlayer, 'page[size]': '100' }, PLAYER_CACHE_MS), parseNameRecords, []),
      extra(
        'clan',
        this.api.getCached('/data/clanMembership', { filter: byPlayer, include: 'clan', 'page[size]': '1' }, PLAYER_CACHE_MS),
        parseClan,
        null,
      ),
    ]);
    return {
      id,
      login,
      registeredAt: asString(found.createTime),
      clan,
      names,
      ratings: parseProfileRatings(ratings),
      online: this.onlineInfo(id),
    };
  }

  async ratingHistory(playerId: number, leaderboardId: number, period: ProfilePeriod): Promise<RatingHistoryPoint[]> {
    const since = historySince(period, new Date());
    const filter = rsqlAnd([
      rsqlEquals('gamePlayerStats.player.id', playerId),
      rsqlEquals('leaderboard.id', leaderboardId),
      ...(since ? [`gamePlayerStats.scoreTime=ge=${rsqlQuote(since)}`] : []),
    ]);
    const page = (number: number): Promise<unknown> =>
      this.api.getCached(
        '/data/leaderboardRatingJournal',
        {
          filter,
          include: 'gamePlayerStats',
          'fields[leaderboardRatingJournal]': 'meanAfter,deviationAfter,meanBefore,deviationBefore,gamePlayerStats',
          'fields[gamePlayerStats]': 'scoreTime,game',
          'page[size]': String(HISTORY_PAGE_SIZE),
          'page[number]': String(number),
          'page[totals]': '',
        },
        PLAYER_CACHE_MS,
      );
    const first = await page(1);
    const totalPages = Math.min(resolveDocument(first).totalPages ?? 1, MAX_HISTORY_PAGES);
    const rest = await mapLimited(
      Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => index + 2),
      HISTORY_PAGE_CONCURRENCY,
      page,
    );
    return parseRatingHistory([first, ...rest]);
  }

  async achievements(playerId: number): Promise<ProfileAchievement[]> {
    const [definitions, progress] = await Promise.all([
      this.api.getCached('/data/achievement', { 'page[size]': LIST_PAGE_SIZE }, DEFINITIONS_CACHE_MS),
      this.api.getCached(
        '/data/playerAchievement',
        { filter: rsqlEquals('player.id', playerId), 'page[size]': LIST_PAGE_SIZE },
        PLAYER_CACHE_MS,
      ),
    ]);
    return parseAchievements(definitions, progress);
  }

  async statistics(playerId: number): Promise<PlayerStatistics> {
    return parseStatistics(
      await this.api.getCached(
        '/data/playerEvent',
        { filter: rsqlEquals('player.id', playerId), 'fields[playerEvent]': 'currentCount,event', 'page[size]': LIST_PAGE_SIZE },
        PLAYER_CACHE_MS,
      ),
    );
  }

  /** Logins starting with the text; `*` would be a wildcard for the API, so it is dropped. */
  async search(text: string): Promise<PlayerSearchResult[]> {
    const prefix = text.replace(/\*/g, '').trim();
    if (prefix.length < MIN_SEARCH_LENGTH) {
      return [];
    }
    const document = await this.api.get('/data/player', {
      filter: rsqlStartsWith('login', prefix),
      'fields[player]': 'login',
      sort: 'login',
      'page[size]': String(SEARCH_LIMIT),
    });
    return resolveDocument(document).items.flatMap((item) => {
      const id = Number(item.id);
      const login = asString(item.login);
      return login && Number.isSafeInteger(id) ? [{ id, login }] : [];
    });
  }

  private onlineInfo(playerId: number): PlayerProfile['online'] {
    const player = this.lobby.getPlayer(playerId);
    if (!player) {
      return null;
    }
    const game = this.lobby.getPlayerGame(playerId);
    return {
      country: player.country,
      avatar: player.avatar,
      game: game ? { id: game.id, title: game.title, playing: game.state === 'playing' } : null,
    };
  }
}
