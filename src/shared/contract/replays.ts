import type { LobbyGame } from './lobby.ts';
import type { ReviewsSummary } from './vault.ts';

export type Faction = 'uef' | 'aeon' | 'cybran' | 'seraphim' | 'nomad' | 'random';

export type GameResult = 'victory' | 'defeat' | 'draw';

export interface ReplayPlayer {
  login: string;
  ai: boolean;
  faction: Faction | null;
  /** Displayed rating (mean - 3 * deviation) before and after the game; null for unrated games. */
  ratingBefore: number | null;
  ratingAfter: number | null;
  result: GameResult | null;
}

export interface ReplayTeam {
  /** FA team number: 1 means "no team". */
  team: number;
  players: ReplayPlayer[];
}

/** A finished game of the FAF replay vault. */
export interface VaultReplay {
  id: number;
  title: string;
  mapName: string | null;
  mapFolderName: string | null;
  mapPreviewUrl: string | null;
  mapPreviewLargeUrl: string | null;
  featuredModName: string;
  startedAt: string | null;
  endedAt: string | null;
  /** Game time from the replay; pauses and game speed make it differ from the real duration. */
  durationSeconds: number | null;
  /** `VALID` for rated games, otherwise the reason the game was not rated, e.g. `TOO_SHORT`. */
  validity: string | null;
  teams: ReplayTeam[];
  averageRating: number | null;
  /** TrueSkill match quality 0..1 from the ratings before the game; null unless two sides with known ratings played. */
  quality: number | null;
  reviews: ReviewsSummary | null;
  /** The server has the replay file; it appears a few minutes after the game ends. */
  available: boolean;
}

export const REPLAY_SORTS = ['newest', 'highestRated'] as const;
export type ReplaySort = (typeof REPLAY_SORTS)[number];

export const REPLAY_PERIODS = ['day', 'week', 'month', 'year', 'all'] as const;
export type ReplayPeriod = (typeof REPLAY_PERIODS)[number];

/** A page of the replay vault; every filter narrows the list, and none of them is required. */
export interface ReplayQuery {
  page: number;
  pageSize: number;
  /** One game by its number; the other filters and the period do not apply then. */
  gameId?: number;
  /** Exact login. */
  player?: string;
  /** Part of the map name. */
  map?: string;
  featuredMod?: string;
  onlyRanked?: boolean;
  /** Games of the signed-in player. */
  onlyOwn?: boolean;
  /** How far back the games ended. Older games are slow to find, so the official client looks a year back at most. */
  period: ReplayPeriod;
  /** Newest by the end of the game, or best rated by the players' reviews. */
  sort: ReplaySort;
}

/** A replay file on this computer. */
export interface LocalReplay {
  /** Full path; the main process accepts back only paths of listed replays. */
  file: string;
  /** In the folder of the official FAF client rather than TFAF's own. */
  official: boolean;
  id: number | null;
  title: string;
  mapFolderName: string | null;
  mapPreviewUrl: string | null;
  mapPreviewLargeUrl: string | null;
  featuredModName: string | null;
  startedAt: string | null;
  endedAt: string | null;
  teams: { team: number; players: string[] }[];
}

/** A game in progress that can be watched with a delay. */
export interface LiveGame extends LobbyGame {
  launchedAt: string | null;
}

/** The replay server holds a live game back this long after its start, so it cannot be used for scouting. */
export const LIVE_REPLAY_DELAY_SECONDS = 300;

/** What happens once a followed game can be watched: a notification with a watch button, or the stream starts. */
export const LIVE_REPLAY_ACTIONS = ['notify', 'watch'] as const;
export type LiveReplayAction = (typeof LIVE_REPLAY_ACTIONS)[number];

/** The running game the launcher waits for until the replay server gives it out (one at a time). */
export interface LiveReplayTracking {
  gameId: number;
  title: string;
  action: LiveReplayAction;
  watchableAt: string;
}

/** A chat line of a replay; `to` is `all`, `allies` or whatever else the game wrote. */
export interface ReplayChatMessage {
  /** Game time in seconds. */
  time: number;
  sender: string;
  to: string;
  text: string;
}

/** A lobby setting of a replay; tables come as text. */
export interface ReplayGameOption {
  key: string;
  value: string | number | boolean;
}

/** What only the replay file tells. */
export interface ReplayDetails {
  /** The FAF version the game ran. */
  gameVersion: number | null;
  /** Sorted by key. */
  options: ReplayGameOption[];
  chat: ReplayChatMessage[];
  /** TrueSkill match quality 0..1 from the ratings in the file; null unless two sides with known ratings played. */
  quality: number | null;
}
