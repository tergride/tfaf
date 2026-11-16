export type MatchmakerFaction = 'uef' | 'aeon' | 'cybran' | 'seraphim';

export const MATCHMAKER_FACTIONS: readonly MatchmakerFaction[] = ['uef', 'aeon', 'cybran', 'seraphim'];

/** Veto tokens put on one map of a map pool bracket. */
export interface MatchmakerVeto {
  bracketId: number;
  assignmentId: number;
  tokens: number;
}

export interface MatchmakerPrefs {
  /** Factions the matchmaker may give the player; at least one. */
  factions: MatchmakerFaction[];
  /** Queues the player switched off; queues are on until then. */
  unselectedQueues: string[];
  vetoes: MatchmakerVeto[];
}

export type MatchmakerQueueStatus = 'idle' | 'searching' | 'matchFound' | 'launching' | 'cancelled';

export interface MatchmakerQueue {
  /** Technical name, e.g. `ladder1v1`. */
  name: string;
  title: string;
  teamSize: number;
  /** Rating type of the queue's games, e.g. `ladder_1v1`. */
  leaderboard: string | null;
  selected: boolean;
  /** False while the party has more players than a team of this queue. */
  fits: boolean;
  playersInQueue: number;
  /** Matchmaker games of this queue running now. */
  activeGames: number;
  /** When the queue next matches the players in it. */
  popAt: string | null;
  status: MatchmakerQueueStatus;
  /** The player's rating on the queue's leaderboard, as the lobby shows it. */
  rating: number | null;
}

export interface PartyMember {
  playerId: number;
  login: string;
  clan: string | null;
  country: string | null;
  factions: MatchmakerFaction[];
  owner: boolean;
  self: boolean;
  /** In an open or running game: the party cannot search until they leave it. */
  inGame: boolean;
}

export interface PartyInvite {
  playerId: number;
  login: string;
  receivedAt: string;
}

export interface MatchmakerState {
  connected: boolean;
  queues: MatchmakerQueue[];
  factions: MatchmakerFaction[];
  /** Ourselves first, then the others; a party of one is just us. */
  party: PartyMember[];
  isOwner: boolean;
  searching: boolean;
  /** Maps of the queues are downloaded before the search starts. */
  preparing: string | null;
  /** Why the search cannot start now; null when it can. */
  blocker: string | null;
  invites: PartyInvite[];
  /** Chat channel of the party while it has other members. */
  partyChannel: string | null;
}

/** A player to invite: online in the lobby. */
export interface MatchmakerPlayer {
  id: number;
  login: string;
  clan: string | null;
  country: string | null;
  friend: boolean;
}

export interface MapPoolMap {
  assignmentId: number;
  /** Null for a map the generator makes for each game. */
  folderName: string | null;
  displayName: string;
  widthPx: number | null;
  heightPx: number | null;
  maxPlayers: number | null;
  previewUrl: string | null;
  previewLargeUrl: string | null;
  /** Neroxis generator parameters of a generated map; `size` is in game units (512 = 10 km). */
  generated: { size: number | null; spawns: number | null; version: string | null } | null;
  vetoTokens: number;
}

/** Maps of a queue for players in one rating range. */
export interface MapPoolBracket {
  id: number;
  minRating: number | null;
  maxRating: number | null;
  vetoTokensPerPlayer: number;
  /** 0: as many tokens per map as the player has. */
  maxTokensPerMap: number;
  maps: MapPoolMap[];
}

export interface MatchmakerMapPool {
  queue: string;
  brackets: MapPoolBracket[];
  /** The bracket of the player's rating; null when the lobby does not know it. */
  playerBracketId: number | null;
}
