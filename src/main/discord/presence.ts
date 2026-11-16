// What the Discord status shows for the launcher's state: the menu, a game's lobby or the game itself, a replay, a
// matchmaker search. A friend can join an open lobby that has room at once. The join secret carries the password the
// server checks for the lobby, so the friend is not asked for it. Discord's clients no longer show the button to watch
// a game, so the status offers none.

import { type GameSessionState, HOST_GAME_LIMITS } from '../../shared/contract.ts';
import { t } from '../i18n.ts';
import { isGeneratedMap, type RawGame } from '../lobby/lobbyProtocol.ts';
import { leaderboardName } from '../players/profileService.ts';

export type PresenceGame = Pick<
  RawGame,
  | 'id'
  | 'title'
  | 'state'
  | 'gameType'
  | 'ratingType'
  | 'mapFolderName'
  | 'numPlayers'
  | 'maxPlayers'
  | 'launchedAt'
>;

/** The activity object of SET_ACTIVITY (Discord's Rich Presence); times in milliseconds. */
export interface DiscordActivity {
  details?: string;
  state?: string;
  timestamps?: { start?: number };
  assets: { large_image: string; large_text: string };
  /** `privacy`: 1 lets Discord friends join at once ("Join"), 0 or none has them ask first ("Ask to Join"). */
  party?: { id: string; size: [number, number]; privacy?: 0 | 1 };
  secrets?: { join?: string };
  instance: boolean;
}

/** The game the player is in and the password the server checks for it (GameRunner.inviteAccess). */
export interface JoinAccess {
  gameId: number;
  /** Null for a game without a password. */
  password: string | null;
}

export interface PresenceSnapshot {
  game: Pick<GameSessionState, 'phase' | 'kind' | 'title' | 'gameId'>;
  /** The lobby's view of the online game the player is in. */
  lobbyGame: PresenceGame | null;
  /** Titles of the queues searched and since when; null while not searching. */
  search: { queues: string[]; since: number } | null;
  /** Friends may join from the status. */
  allowJoin: boolean;
  /** What a friend joining from the status needs; null while the player's game cannot be joined. */
  access: JoinAccess | null;
}

const ASSETS = { large_image: 'tfaf_large', large_text: 'TFAF' };
// Discord cuts longer texts off and refuses texts shorter than two characters.
const MAX_TEXT = 128;
// Discord refuses longer secrets; counted in bytes in case it counts them so.
const MAX_SECRET_BYTES = 128;
const PUBLIC_PARTY = 1;

function text(value: string): string {
  const trimmed = value.trim().slice(0, MAX_TEXT);
  return trimmed.length >= 2 ? trimmed : `${trimmed}  `.slice(0, 2);
}

/**
 * What a join request from Discord carries: the game and the password the server checks for it. A password too long
 * for a secret is left out, and the friend is asked for it.
 */
export function gameSecret(gameId: number, password: string | null = null): string {
  if (password !== null) {
    const secret = JSON.stringify({ gameId, password });
    if (Buffer.byteLength(secret, 'utf8') <= MAX_SECRET_BYTES) {
      return secret;
    }
  }
  return JSON.stringify({ gameId });
}

/** A secret without a password, from an older launcher among them, gives a null password: the join asks for it. */
export function parseGameSecret(secret: string): JoinAccess | null {
  let value: unknown;
  try {
    value = JSON.parse(secret);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { gameId, password } = value as Record<string, unknown>;
  if (typeof gameId !== 'number' || !Number.isSafeInteger(gameId) || gameId <= 0) {
    return null;
  }
  const valid = typeof password === 'string' && password.length > 0 && password.length <= HOST_GAME_LIMITS.passwordMaxLength;
  return { gameId, password: valid ? password : null };
}

/** `seton's_clutch.v0003` → `seton's clutch`, as the official client names maps; a generated map has no name to show. */
function mapLine(game: PresenceGame): string | undefined {
  if (!game.mapFolderName) {
    return undefined;
  }
  const map = isGeneratedMap(game.mapFolderName)
    ? t('main.discord.generatedMap')
    : game.mapFolderName.replace(/_/g, ' ').replace(/\.v\d+$/i, '');
  return text(t('main.discord.map', { map }));
}

/** What the player does in a game the lobby knows: the kind of game first, then its title in quotes. */
function gameLine(game: PresenceGame, playing: boolean): string {
  const title = game.title || t('main.discord.untitled');
  if (game.gameType === 'matchmaker') {
    return text(t('main.discord.matchmakerGame', { queue: leaderboardName(game.ratingType ?? 'global') }));
  }
  if (game.gameType === 'coop') {
    return text(t(playing ? 'main.discord.coopPlaying' : 'main.discord.coopLobby', { title }));
  }
  return text(t(playing ? 'main.discord.playing' : 'main.discord.inLobby', { title }));
}

function lobbyActivity(snapshot: PresenceSnapshot, game: PresenceGame): DiscordActivity {
  // Discord adds the party size after the second line: `Map: Seton's Clutch (2 of 4)`.
  const party = { id: `tfaf-game-${game.id}`, size: [Math.max(1, game.numPlayers), Math.max(1, game.maxPlayers)] as [number, number] };
  const map = mapLine(game);
  if (game.state === 'playing') {
    const launchedAt = game.launchedAt ? Date.parse(game.launchedAt) : Number.NaN;
    return {
      details: gameLine(game, true),
      ...(map ? { state: map } : {}),
      ...(Number.isFinite(launchedAt) ? { timestamps: { start: launchedAt } } : {}),
      assets: ASSETS,
      party,
      instance: true,
    };
  }
  // A lobby only for the host's friends is offered too: the friend who cannot see the game is told so.
  const joinable = snapshot.allowJoin && game.state === 'open' && game.numPlayers < game.maxPlayers;
  const password = snapshot.access?.gameId === game.id ? snapshot.access.password : null;
  return {
    details: gameLine(game, false),
    ...(map ? { state: map } : {}),
    assets: ASSETS,
    party: joinable ? { ...party, privacy: PUBLIC_PARTY } : party,
    ...(joinable ? { secrets: { join: gameSecret(game.id, password) } } : {}),
    instance: false,
  };
}

export function buildActivity(snapshot: PresenceSnapshot): DiscordActivity {
  const { game } = snapshot;
  const title = game.title ?? t('main.discord.untitled');
  if (game.phase !== 'idle') {
    if (game.kind === 'replay') {
      return { details: text(t('main.discord.watchingReplay')), state: text(t('main.discord.quoted', { title })), assets: ASSETS, instance: false };
    }
    if (game.kind === 'offline') {
      return { details: text(t('main.discord.offline')), state: text(t('main.discord.quoted', { title })), assets: ASSETS, instance: false };
    }
    if (snapshot.lobbyGame && snapshot.lobbyGame.id === game.gameId) {
      return lobbyActivity(snapshot, snapshot.lobbyGame);
    }
    return { details: text(t('main.discord.starting', { title })), assets: ASSETS, instance: false };
  }
  if (snapshot.search) {
    return {
      details: text(t('main.discord.searching')),
      ...(snapshot.search.queues.length ? { state: text(t('main.discord.queues', { queues: snapshot.search.queues.join(', ') })) } : {}),
      timestamps: { start: snapshot.search.since },
      assets: ASSETS,
      instance: false,
    };
  }
  return { details: text(t('main.discord.inMenu')), state: text(t('main.discord.inMenuState')), assets: ASSETS, instance: false };
}
