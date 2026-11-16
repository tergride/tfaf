// Parsing of FAF lobby server messages (newline-delimited JSON, see FafLobbyClient in faf-java-commons) and their
// mapping to the renderer contract. Everything received from the server is narrowed before use.

import type { LobbyGame, LobbyGamePlayer, LobbyGameTeam, PlayerAvatar } from '../../shared/contract.ts';
import { asNumber, asObject, asString } from '../api/jsonApi.ts';
import { isLobbyServerTitle, lobbyTitle } from '../game/tfafLobby/lobbyAccess.ts';
import type { MessageKey } from '../../shared/i18n/index.ts';
import { t } from '../i18n.ts';
import { isFafHttpsUrl } from '../servers.ts';
import { matchQuality } from '../../shared/trueskill.ts';

export interface LobbyMessage {
  command: string;
  [field: string]: unknown;
}

export interface PlayerRating {
  mean: number;
  deviation: number;
}

export interface LobbyPlayer {
  id: number;
  login: string;
  clan: string | null;
  country: string | null;
  ratings: Map<string, PlayerRating>;
  /** Games played across all leaderboards, passed to the game as `/numgames`. */
  numberOfGames: number;
  avatar: PlayerAvatar | null;
}

export interface RawGame {
  id: number;
  title: string;
  host: string;
  state: string;
  gameType: string;
  visibility: string;
  passwordProtected: boolean;
  featuredMod: string;
  simMods: { uid: string; name: string }[];
  mapFolderName: string;
  numPlayers: number;
  maxPlayers: number;
  ratingType: string | null;
  ratingMin: number | null;
  ratingMax: number | null;
  enforceRatingRange: boolean;
  hostedAt: string | null;
  /** When the game itself started; null while it is still in the lobby. */
  launchedAt: string | null;
  teamIds: { team: number; playerIds: number[] }[];
  teamLogins: { team: number; logins: string[] }[];
}

// The session id is a 64-bit integer that a JS number would round, and the server drops a login with a rounded one.
// It is kept as a bigint taken from the exact source digits and written back as a raw number. JSON.parse source access
// and JSON.rawJSON (ES2026) are in Electron's V8 but not yet in TypeScript's lib.
type SourceReviver = (key: string, value: unknown, context?: { source?: string }) => unknown;
const parseJson = JSON.parse as (text: string, reviver: SourceReviver) => unknown;
const rawJson = (JSON as unknown as { rawJSON: (text: string) => unknown }).rawJSON;

const keepExactSession: SourceReviver = (key, value, context) =>
  key === 'session' && typeof value === 'number' && context?.source && /^\d+$/.test(context.source)
    ? BigInt(context.source)
    : value;

export function parseLobbyMessage(line: string): LobbyMessage | null {
  try {
    const message = asObject(parseJson(line, keepExactSession));
    return message && typeof message.command === 'string' ? (message as LobbyMessage) : null;
  } catch {
    return null;
  }
}

export function serializeLobbyMessage(message: LobbyMessage): string {
  return JSON.stringify(message, (_key, value: unknown) => (typeof value === 'bigint' ? rawJson(value.toString()) : value));
}

export function parseSessionId(message: LobbyMessage): bigint | null {
  return typeof message.session === 'bigint' ? message.session : null;
}

/** Avatars are images on the FAF content server; anything else is not shown. */
export function parseAvatar(value: unknown): PlayerAvatar | null {
  const raw = asObject(value);
  const url = asString(raw?.url);
  return url && isFafHttpsUrl(url) ? { url, tooltip: asString(raw?.tooltip) ?? '' } : null;
}

/** The answer to `list_avatar`: `{"command": "avatar", "avatarlist": [{"url", "tooltip"}]}`. */
export function parseAvatarList(message: LobbyMessage): PlayerAvatar[] {
  const list = Array.isArray(message.avatarlist) ? message.avatarlist : [];
  return list.map(parseAvatar).filter((avatar) => avatar !== null);
}

export function parsePlayer(value: unknown): LobbyPlayer | null {
  const raw = asObject(value);
  const id = asNumber(raw?.id);
  const login = asString(raw?.login);
  if (!raw || id === null || !login) {
    return null;
  }
  const ratings = new Map<string, PlayerRating>();
  let numberOfGames = 0;
  for (const [leaderboard, stats] of Object.entries(asObject(raw.ratings) ?? {})) {
    numberOfGames += asNumber(asObject(stats)?.number_of_games) ?? 0;
    const rating = asObject(stats)?.rating;
    if (Array.isArray(rating)) {
      const mean = asNumber(rating[0]);
      const deviation = asNumber(rating[1]);
      if (mean !== null && deviation !== null) {
        ratings.set(leaderboard, { mean, deviation });
      }
    }
  }
  return {
    id,
    login,
    clan: asString(raw.clan) || null,
    country: asString(raw.country) || null,
    ratings,
    numberOfGames,
    avatar: parseAvatar(raw.avatar),
  };
}

/** A `player_info` message: players who are online, with their current data, and those who have just left. */
export interface PlayerInfoUpdate {
  online: LobbyPlayer[];
  offlineIds: number[];
}

/** The server marks a player who disconnected with `state: "offline"`; it sends no other state so far. */
export function parsePlayerInfo(message: LobbyMessage): PlayerInfoUpdate {
  const update: PlayerInfoUpdate = { online: [], offlineIds: [] };
  for (const entry of Array.isArray(message.players) ? message.players : []) {
    const player = parsePlayer(entry);
    if (!player) {
      continue;
    }
    if (asObject(entry)?.state === 'offline') {
      update.offlineIds.push(player.id);
    } else {
      update.online.push(player);
    }
  }
  return update;
}

/** The `social` message after login (SocialInfo): chat channels to join, friends and foes by player id. */
export interface SocialInfo {
  channels: string[];
  friends: Set<number>;
  foes: Set<number>;
}

export function parseSocial(message: LobbyMessage): SocialInfo {
  const ids = (value: unknown): Set<number> =>
    new Set((Array.isArray(value) ? value : []).map(asNumber).filter((id): id is number => id !== null));
  const channels = (Array.isArray(message.channels) ? message.channels : [])
    .map(asString)
    .filter((channel): channel is string => channel !== null && /^#[^\s,\x00-\x1f]{1,49}$/.test(channel));
  return { channels, friends: ids(message.friends), foes: ids(message.foes) };
}

/** Parameters of `game_launch`, sent by the server once hosting or joining succeeded (GameLaunchResponse). */
export interface GameLaunch {
  uid: number;
  featuredMod: string;
  name: string | null;
  mapName: string | null;
  leaderboard: string;
  gameType: string;
  args: string[];
  expectedPlayers: number | null;
  mapPosition: number | null;
  team: number | null;
  faction: string | null;
  gameOptions: Record<string, string> | null;
}

const FACTIONS_BY_NUMBER = ['', 'uef', 'aeon', 'cybran', 'seraphim'];

function parseFaction(value: unknown): string | null {
  if (typeof value === 'number') {
    return FACTIONS_BY_NUMBER[value] || null;
  }
  const faction = asString(value)?.toLowerCase();
  return faction && /^[a-z]+$/.test(faction) ? faction : null;
}

export function parseGameLaunch(message: LobbyMessage): GameLaunch {
  const uid = asNumber(message.uid);
  if (uid === null) {
    throw new Error(t('main.lobby.invalidGameLaunch'));
  }
  const options = asObject(message.game_options);
  return {
    uid,
    featuredMod: asString(message.mod) ?? 'faf',
    name: asString(message.name),
    mapName: asString(message.mapname),
    leaderboard: asString(message.rating_type) ?? 'global',
    gameType: asString(message.game_type) ?? 'custom',
    args: (Array.isArray(message.args) ? message.args : [])
      .filter((arg) => typeof arg === 'string' || typeof arg === 'number')
      .map(String),
    expectedPlayers: asNumber(message.expected_players),
    mapPosition: asNumber(message.map_position),
    team: asNumber(message.team),
    faction: parseFaction(message.faction),
    gameOptions: options ? Object.fromEntries(Object.entries(options).map(([key, value]) => [key, String(value)])) : null,
  };
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

export function parseGame(value: unknown): RawGame | null {
  const raw = asObject(value);
  const id = asNumber(raw?.uid);
  if (!raw || id === null) {
    return null;
  }
  const simMods = Object.entries(asObject(raw.sim_mods) ?? {}).map(([uid, name]) => ({ uid, name: asString(name) ?? uid }));
  const teamIds = (Array.isArray(raw.teams_ids) ? raw.teams_ids : [])
    .map((entry) => {
      const team = asObject(entry);
      const teamId = asNumber(team?.team_id);
      const playerIds = Array.isArray(team?.player_ids) ? team.player_ids.map(asNumber).filter((id) => id !== null) : [];
      return teamId === null ? null : { team: teamId, playerIds };
    })
    .filter((team) => team !== null);
  const teamLogins = Object.entries(asObject(raw.teams) ?? {})
    .map(([team, logins]) => ({
      team: Number(team),
      logins: Array.isArray(logins) ? logins.map(asString).filter((login) => login !== null) : [],
    }))
    .filter((team) => Number.isInteger(team.team));

  return {
    id,
    title: asString(raw.title) ?? '',
    host: asString(raw.host) ?? '',
    state: asString(raw.state) ?? 'unknown',
    gameType: asString(raw.game_type) ?? 'unknown',
    visibility: asString(raw.visibility) ?? 'public',
    passwordProtected: raw.password_protected === true,
    featuredMod: asString(raw.featured_mod) ?? 'faf',
    simMods,
    mapFolderName: asString(raw.mapname) ?? '',
    numPlayers: asNumber(raw.num_players) ?? 0,
    maxPlayers: asNumber(raw.max_players) ?? 0,
    ratingType: asString(raw.rating_type),
    ratingMin: asNumber(raw.rating_min),
    ratingMax: asNumber(raw.rating_max),
    enforceRatingRange: raw.enforce_rating_range === true,
    hostedAt: parseTimestamp(raw.hosted_at),
    launchedAt: parseTimestamp(raw.launched_at),
    teamIds,
    teamLogins,
  };
}

/** `game_info` carries either a single game or a batch in `games`. */
export function parseGameInfo(message: LobbyMessage): RawGame[] {
  const entries = Array.isArray(message.games) ? message.games : [message];
  return entries.map(parseGame).filter((game) => game !== null);
}

/**
 * Open lobbies the renderer lists: custom games in the games tab and coop games in the coop tab, like
 * CustomGamesController and CoopController of the official client.
 */
export function isListedGame(game: RawGame): boolean {
  return game.state === 'open' && (game.gameType === 'custom' || game.gameType === 'coop');
}

/** Games that have started, which the replays tab offers to watch (LiveReplayController). */
export function isLiveGame(game: RawGame): boolean {
  return game.state === 'playing';
}

export function displayedRating(rating: PlayerRating | undefined): number | null {
  return rating ? Math.trunc(rating.mean - 3 * rating.deviation) : null;
}

export function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

const JOIN_FAILURE_REASONS = new Map<string, MessageKey>([
  ['bad_password', 'main.lobby.joinReasons.badPassword'],
  ['host_left_game', 'main.lobby.joinReasons.hostLeftGame'],
  ['game_not_ready', 'main.lobby.joinReasons.gameNotReady'],
]);

/** The `reason` of game_join_failed is a code; one the launcher does not know is shown as the server sent it. */
export function joinFailureReason(reason: unknown): string {
  const code = stripHtml(asString(reason) ?? '');
  const key = JOIN_FAILURE_REASONS.get(code);
  return key ? t(key) : code || t('main.lobby.joinRefused');
}

/**
 * Right after game_join_failed the server repeats the refusal for old clients as an English info notice. The refused
 * join already reports it, so the notice is not shown.
 */
export function repeatsJoinFailure(previousCommand: string | null, message: LobbyMessage): boolean {
  return previousCommand === 'game_join_failed' && message.command === 'notice' && message.style === 'info';
}

export function isGeneratedMap(mapFolderName: string): boolean {
  return mapFolderName.toLowerCase().startsWith('neroxis_map_generator');
}

export interface GameMappingContext {
  players: ReadonlyMap<number, LobbyPlayer>;
  /** Ids of the signed-in player's friends. */
  friends: ReadonlySet<number>;
  featuredModNames: ReadonlyMap<string, string>;
  contentBaseUrl: string;
  /** The generator's picture of a map in the maps folder, if there is one; asked only about generated maps. */
  localMapPreview(mapFolderName: string): string | null;
}

function previewUrls(context: GameMappingContext, mapFolderName: string): { small: string | null; large: string | null } {
  if (!mapFolderName) {
    return { small: null, large: null };
  }
  if (isGeneratedMap(mapFolderName)) {
    const local = context.localMapPreview(mapFolderName);
    return { small: local, large: local };
  }
  const previews = `${context.contentBaseUrl}/maps/previews`;
  const previewName = `${encodeURIComponent(mapFolderName.toLowerCase())}.png`;
  return { small: `${previews}/small/${previewName}`, large: `${previews}/large/${previewName}` };
}

// FAF's team 1 is "no team": each of its players plays for themselves.
const NO_TEAM = 1;

/**
 * TrueSkill quality of a game from the lobby ratings of its players in the game's leaderboard; null while a player
 * has no rating there or fewer than two sides play. Observers (teams below 1) do not count.
 */
export function lobbyMatchQuality(game: RawGame, players: ReadonlyMap<number, LobbyPlayer>, leaderboard: string): number | null {
  const sides: PlayerRating[][] = [];
  for (const { team, playerIds } of game.teamIds) {
    if (team < NO_TEAM || playerIds.length === 0) {
      continue;
    }
    const ratings = playerIds.map((id) => players.get(id)?.ratings.get(leaderboard));
    if (ratings.some((rating) => rating === undefined)) {
      return null;
    }
    const known = ratings as PlayerRating[];
    sides.push(...(team === NO_TEAM ? known.map((rating) => [rating]) : [known]));
  }
  return matchQuality(sides);
}

export function toLobbyGame(game: RawGame, context: GameMappingContext): LobbyGame {
  const leaderboard = game.ratingType ?? 'global';
  const playersById = context.players;

  let teams: LobbyGameTeam[];
  if (game.teamIds.length > 0) {
    teams = game.teamIds.map(({ team, playerIds }) => ({
      team,
      players: playerIds.map((id): LobbyGamePlayer => {
        const player = playersById.get(id);
        return {
          id,
          login: player?.login ?? `#${id}`,
          clan: player?.clan ?? null,
          country: player?.country ?? null,
          rating: displayedRating(player?.ratings.get(leaderboard)),
          friend: context.friends.has(id),
          avatar: player?.avatar ?? null,
        };
      }),
    }));
  } else {
    const byLogin = new Map([...playersById.values()].map((player) => [player.login, player]));
    teams = game.teamLogins.map(({ team, logins }) => ({
      team,
      players: logins.map((login): LobbyGamePlayer => {
        const player = byLogin.get(login);
        return {
          id: player?.id ?? null,
          login,
          clan: player?.clan ?? null,
          country: player?.country ?? null,
          rating: displayedRating(player?.ratings.get(leaderboard)),
          friend: player !== undefined && context.friends.has(player.id),
          avatar: player?.avatar ?? null,
        };
      }),
    }));
  }
  teams.sort((a, b) => a.team - b.team);

  const ratings = teams.flatMap((team) => team.players.map((player) => player.rating)).filter((rating) => rating !== null);
  const previews = previewUrls(context, game.mapFolderName);
  return {
    id: game.id,
    gameType: game.gameType,
    title: lobbyTitle(game.title),
    host: game.host,
    mapFolderName: game.mapFolderName,
    mapPreviewUrl: previews.small,
    mapPreviewLargeUrl: previews.large,
    featuredMod: game.featuredMod,
    featuredModName: context.featuredModNames.get(game.featuredMod) ?? game.featuredMod,
    simMods: game.simMods,
    numPlayers: game.numPlayers,
    maxPlayers: game.maxPlayers,
    passwordProtected: game.passwordProtected,
    friendsOnly: game.visibility === 'friends',
    ratingType: game.ratingType,
    ratingMin: game.ratingMin,
    ratingMax: game.ratingMax,
    enforceRatingRange: game.enforceRatingRange,
    hostedAt: game.hostedAt,
    averageRating: ratings.length > 0 ? Math.round(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) : null,
    quality: lobbyMatchQuality(game, playersById, leaderboard),
    generatedMap: isGeneratedMap(game.mapFolderName),
    tfafLobby: isLobbyServerTitle(game.title),
    teams,
  };
}

export function gameHasPlayer(game: RawGame, playerIds: ReadonlySet<number>): boolean {
  return game.teamIds.some((team) => team.playerIds.some((id) => playerIds.has(id)));
}
