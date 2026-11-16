import type {
  League,
  LeagueDivision,
  LeagueEntry,
  LeaguePlayerLocation,
  LeagueSeason,
  LeagueStanding,
  Page,
} from '../../shared/contract.ts';
import type { FafApi } from '../api/fafApi.ts';
import { asBoolean, asNumber, asObject, asString, type Resource, resolveDocument } from '../api/jsonApi.ts';
import { rsqlAnd, rsqlEquals } from '../api/rsql.ts';
import type { AuthService } from '../auth/authService.ts';
import { mapLimited } from '../concurrency.ts';
import { httpsUrlOrNull } from './html.ts';

export const LEAGUE_PAGE_SIZE = 50;

const LIST_CACHE_MS = 30 * 60 * 1000;
const SEASON_CACHE_MS = 5 * 60 * 1000;
const MAX_CACHED_SEASONS = 4;
const SCORES_PAGE_SIZE = 10_000;
const MAX_SCORE_PAGES = 200;
const SCORE_PAGE_CONCURRENCY = 6;
const PLAYER_BATCH_SIZE = 100;

// League names of the official client (leaderboard.<technicalName>).
const LEAGUE_NAMES: Record<string, string> = {
  '1v1_league': '1v1',
  '2v2_league': '2v2',
  '3v3_league': '3v3',
  '4v4_full_share_league': '4v4 Full Share',
  '4v4_share_until_death_league': '4v4 No Share',
};

interface SubdivisionRow {
  id: string;
  index: number;
  name: string;
  minRating: number | null;
  maxRating: number | null;
  highestScore: number | null;
  imageUrl: string | null;
  divisionIndex: number;
  divisionNameKey: string;
}

export interface ScoreRow {
  playerId: number;
  subdivisionId: string | null;
  score: number | null;
  gameCount: number;
  returningPlayer: boolean;
}

interface RankedScore extends ScoreRow {
  rank: number;
  /** 0-based position inside the subdivision. */
  position: number;
}

export interface RankedSeason {
  divisions: LeagueDivision[];
  players: number;
  bySubdivision: Map<string, RankedScore[]>;
  byPlayer: Map<number, RankedScore>;
}

interface SeasonData extends RankedSeason {
  placementGames: number;
  placementGamesReturningPlayer: number;
}

function relationshipId(value: unknown): string | null {
  return asString(asObject(value)?.id);
}

/** Leagues by team size: 1v1, 2v2, 3v3, 4v4. */
export function parseLeagues(document: unknown): League[] {
  return resolveDocument(document)
    .items.flatMap((resource): League[] => {
      const technicalName = asString(resource.technicalName);
      return technicalName ? [{ id: resource.id, name: LEAGUE_NAMES[technicalName] ?? technicalName }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
}

export function parseSeasons(document: unknown): LeagueSeason[] {
  return resolveDocument(document).items.flatMap((resource): LeagueSeason[] => {
    const number = asNumber(resource.seasonNumber);
    return number === null
      ? []
      : [{ id: resource.id, number, startDate: asString(resource.startDate), endDate: asString(resource.endDate) }];
  });
}

function toSubdivisionRow(resource: Resource): SubdivisionRow | null {
  const division = asObject(resource.leagueSeasonDivision);
  const index = asNumber(resource.subdivisionIndex);
  const divisionIndex = asNumber(division?.divisionIndex);
  const divisionNameKey = asString(division?.nameKey);
  if (index === null || divisionIndex === null || !divisionNameKey) {
    return null;
  }
  return {
    id: resource.id,
    index,
    name: asString(resource.nameKey) ?? String(index),
    minRating: asNumber(resource.minRating),
    maxRating: asNumber(resource.maxRating),
    highestScore: asNumber(resource.highestScore),
    imageUrl: httpsUrlOrNull(resource.mediumImageUrl) ?? httpsUrlOrNull(resource.imageUrl),
    divisionIndex,
    divisionNameKey,
  };
}

export function parseSubdivisions(document: unknown): SubdivisionRow[] {
  return resolveDocument(document)
    .items.map(toSubdivisionRow)
    .filter((row) => row !== null);
}

export function parseScores(document: unknown): ScoreRow[] {
  return resolveDocument(document).items.flatMap((resource): ScoreRow[] => {
    const playerId = asNumber(resource.loginId);
    if (playerId === null) {
      return [];
    }
    return [
      {
        playerId,
        subdivisionId: relationshipId(resource.leagueSeasonDivisionSubdivision),
        score: asNumber(resource.score),
        gameCount: asNumber(resource.gameCount) ?? 0,
        returningPlayer: asBoolean(resource.returningPlayer),
      },
    ];
  });
}

/**
 * Orders a season like the official client's rankings: higher division, then higher subdivision, then higher score.
 * Players without a subdivision are still in placement and get no rank.
 */
export function rankSeason(subdivisions: SubdivisionRow[], scores: ScoreRow[]): RankedSeason {
  const subdivisionById = new Map(subdivisions.map((row) => [row.id, row]));
  const placed = scores
    .flatMap((score) => {
      const subdivision = score.subdivisionId ? subdivisionById.get(score.subdivisionId) : undefined;
      return subdivision ? [{ score, subdivision }] : [];
    })
    .sort(
      (a, b) =>
        b.subdivision.divisionIndex - a.subdivision.divisionIndex ||
        b.subdivision.index - a.subdivision.index ||
        (b.score.score ?? 0) - (a.score.score ?? 0) ||
        a.score.playerId - b.score.playerId,
    );

  const bySubdivision = new Map<string, RankedScore[]>();
  const byPlayer = new Map<number, RankedScore>();
  placed.forEach(({ score, subdivision }, index) => {
    const list = bySubdivision.get(subdivision.id) ?? [];
    const ranked: RankedScore = { ...score, rank: index + 1, position: list.length };
    list.push(ranked);
    bySubdivision.set(subdivision.id, list);
    byPlayer.set(score.playerId, ranked);
  });

  const divisions = new Map<number, LeagueDivision>();
  for (const row of [...subdivisions].sort((a, b) => b.divisionIndex - a.divisionIndex || b.index - a.index)) {
    const division = divisions.get(row.divisionIndex) ?? { index: row.divisionIndex, nameKey: row.divisionNameKey, subdivisions: [] };
    division.subdivisions.push({
      id: row.id,
      index: row.index,
      name: row.name,
      minRating: row.minRating,
      maxRating: row.maxRating,
      highestScore: row.highestScore,
      imageUrl: row.imageUrl,
      players: bySubdivision.get(row.id)?.length ?? 0,
    });
    divisions.set(row.divisionIndex, division);
  }
  return { divisions: [...divisions.values()], players: placed.length, bySubdivision, byPlayer };
}

/** Leagues of the matchmaker queues: divisions, standings and the player's own place (LeaderboardService). */
export class LeagueService {
  private readonly api: FafApi;
  private readonly auth: AuthService;
  private readonly seasons = new Map<string, { at: number; data: Promise<SeasonData> }>();
  private readonly logins = new Map<string, string>();

  constructor(api: FafApi, auth: AuthService) {
    this.api = api;
    this.auth = auth;
  }

  async list(): Promise<League[]> {
    return parseLeagues(await this.api.getCached('/data/league', { filter: 'enabled==true' }, LIST_CACHE_MS));
  }

  async seasonsOf(leagueId: string): Promise<LeagueSeason[]> {
    const filter = rsqlAnd([rsqlEquals('league.id', leagueId), `startDate=le=${new Date().toISOString()}`]);
    return parseSeasons(await this.api.get('/data/leagueSeason', { filter, sort: '-startDate', 'page[size]': '100' }));
  }

  async standing(seasonId: string): Promise<LeagueStanding> {
    const season = await this.season(seasonId);
    const user = this.auth.getUser();
    if (!user) {
      return { divisions: season.divisions, players: season.players, me: null };
    }
    const ranked = season.byPlayer.get(user.id);
    const own = ranked ?? (await this.ownScore(seasonId, user.id));
    return {
      divisions: season.divisions,
      players: season.players,
      me: own
        ? {
            subdivisionId: ranked?.subdivisionId ?? null,
            score: own.score ?? 0,
            gameCount: own.gameCount,
            placementGames: own.returningPlayer ? season.placementGamesReturningPlayer : season.placementGames,
            rank: ranked?.rank ?? null,
          }
        : null,
    };
  }

  async entries(seasonId: string, subdivisionId: string, page: number): Promise<Page<LeagueEntry>> {
    const season = await this.season(seasonId);
    const scores = season.bySubdivision.get(subdivisionId) ?? [];
    const totalPages = Math.max(1, Math.ceil(scores.length / LEAGUE_PAGE_SIZE));
    const slice = scores.slice((page - 1) * LEAGUE_PAGE_SIZE, page * LEAGUE_PAGE_SIZE);
    const logins = await this.loginsOf(slice.map((score) => score.playerId));
    return {
      items: slice.map((score) => ({
        rank: score.rank,
        playerId: score.playerId,
        login: logins.get(score.playerId) ?? `#${score.playerId}`,
        score: score.score ?? 0,
        gameCount: score.gameCount,
      })),
      page,
      totalPages,
      totalItems: scores.length,
    };
  }

  async find(seasonId: string, login: string): Promise<LeaguePlayerLocation | null> {
    const document = resolveDocument(
      await this.api.get('/data/player', { filter: rsqlEquals('login', login), 'fields[player]': 'login', 'page[size]': '1' }),
    );
    const playerId = Number(document.items[0]?.id);
    if (!Number.isInteger(playerId)) {
      return null;
    }
    const ranked = (await this.season(seasonId)).byPlayer.get(playerId);
    if (!ranked?.subdivisionId) {
      return null;
    }
    return { playerId, subdivisionId: ranked.subdivisionId, page: Math.floor(ranked.position / LEAGUE_PAGE_SIZE) + 1 };
  }

  /**
   * The player's league in the running season of a leaderboard, which a matchmaker game shows; `unlisted` while the
   * player has none, as in the official client (GameRunner.getDivisionInfo).
   */
  async activeDivision(playerId: number, leaderboard: string): Promise<{ division: string; subdivision: string | null }> {
    const now = new Date().toISOString();
    const document = resolveDocument(
      await this.api.get('/data/leagueSeasonScore', {
        filter: rsqlAnd([
          rsqlEquals('loginId', playerId),
          rsqlEquals('leagueSeason.leaderboard.technicalName', leaderboard),
          `leagueSeason.startDate=le=${now}`,
          `leagueSeason.endDate=ge=${now}`,
        ]),
        include: 'leagueSeasonDivisionSubdivision.leagueSeasonDivision',
      }),
    );
    for (const score of document.items) {
      const subdivision = asObject(score.leagueSeasonDivisionSubdivision);
      const division = asString(asObject(subdivision?.leagueSeasonDivision)?.nameKey);
      if (subdivision && division) {
        return { division, subdivision: asString(subdivision.nameKey) };
      }
    }
    return { division: 'unlisted', subdivision: null };
  }

  /** A season's standings are one large request, so they are shared by all pages for a few minutes. */
  private season(seasonId: string): Promise<SeasonData> {
    const key = `${this.auth.getServer().id}:${seasonId}`;
    const cached = this.seasons.get(key);
    if (cached && Date.now() - cached.at < SEASON_CACHE_MS) {
      return cached.data;
    }
    const data = this.loadSeason(seasonId);
    this.seasons.set(key, { at: Date.now(), data });
    data.catch(() => {
      if (this.seasons.get(key)?.data === data) {
        this.seasons.delete(key);
      }
    });
    if (this.seasons.size > MAX_CACHED_SEASONS) {
      this.seasons.delete(this.seasons.keys().next().value as string);
    }
    return data;
  }

  private async loadSeason(seasonId: string): Promise<SeasonData> {
    const [seasonDocument, subdivisions, scores] = await Promise.all([
      this.api.get(`/data/leagueSeason/${seasonId}`),
      this.api.get('/data/leagueSeasonDivisionSubdivision', {
        filter: rsqlEquals('leagueSeasonDivision.leagueSeason.id', seasonId),
        include: 'leagueSeasonDivision',
        'page[size]': '1000',
      }),
      this.allScores(seasonId),
    ]);
    const season = resolveDocument(seasonDocument).items[0];
    return {
      ...rankSeason(parseSubdivisions(subdivisions), scores),
      placementGames: asNumber(season?.placementGames) ?? 0,
      placementGamesReturningPlayer: asNumber(season?.placementGamesReturningPlayer) ?? asNumber(season?.placementGames) ?? 0,
    };
  }

  /** The API answers at most a hundred scores per request, so the rest of the pages are fetched a few at a time. */
  private async allScores(seasonId: string): Promise<ScoreRow[]> {
    const page = (number: number, size: number): Promise<unknown> =>
      this.api.get('/data/leagueSeasonScore', {
        filter: rsqlAnd([rsqlEquals('leagueSeason.id', seasonId), 'score=ge=0']),
        'fields[leagueSeasonScore]': 'loginId,score,gameCount,returningPlayer,leagueSeasonDivisionSubdivision',
        'page[size]': String(size),
        'page[number]': String(number),
        'page[totals]': '',
      });
    const first = await page(1, SCORES_PAGE_SIZE);
    const meta = asObject(asObject(asObject(first)?.meta)?.page);
    const limit = asNumber(meta?.limit) ?? SCORES_PAGE_SIZE;
    const totalPages = Math.min(asNumber(meta?.totalPages) ?? 1, MAX_SCORE_PAGES);
    const pageNumbers = Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => index + 2);
    const rest = await mapLimited(pageNumbers, SCORE_PAGE_CONCURRENCY, (number) => page(number, limit));
    return [first, ...rest].flatMap(parseScores);
  }

  /** Players still in placement have no score yet, so they are missing from the standings. */
  private async ownScore(seasonId: string, playerId: number): Promise<ScoreRow | null> {
    const document = await this.api.get('/data/leagueSeasonScore', {
      filter: rsqlAnd([rsqlEquals('leagueSeason.id', seasonId), rsqlEquals('loginId', playerId)]),
    });
    return parseScores(document)[0] ?? null;
  }

  private async loginsOf(playerIds: number[]): Promise<Map<number, string>> {
    const server = this.auth.getServer().id;
    const missing = [...new Set(playerIds)].filter((id) => !this.logins.has(`${server}:${id}`));
    for (let start = 0; start < missing.length; start += PLAYER_BATCH_SIZE) {
      const batch = missing.slice(start, start + PLAYER_BATCH_SIZE);
      const document = resolveDocument(
        await this.api.get('/data/player', {
          filter: `id=in=(${batch.join(',')})`,
          'fields[player]': 'login',
          'page[size]': String(PLAYER_BATCH_SIZE),
        }),
      );
      for (const player of document.items) {
        const login = asString(player.login);
        if (login) {
          this.logins.set(`${server}:${player.id}`, login);
        }
      }
    }
    return new Map(
      playerIds.flatMap((id) => {
        const login = this.logins.get(`${server}:${id}`);
        return login ? [[id, login] as const] : [];
      }),
    );
  }
}
