import type { MatchmakerFaction } from './matchmaker.ts';

/** An avatar of the FAF content server, shown next to the nick. */
export interface PlayerAvatar {
  url: string;
  tooltip: string;
}

export interface AvatarChoice {
  /** The avatars the server lets the signed-in player wear. */
  available: PlayerAvatar[];
  /** The URL of the one worn now; null for none. */
  current: string | null;
}

export const PROFILE_PERIODS = ['month', 'year', 'all'] as const;
export type ProfilePeriod = (typeof PROFILE_PERIODS)[number];

export interface ProfileRating {
  leaderboardId: string;
  technicalName: string;
  name: string;
  /** Displayed rating (mean - 3 * deviation). */
  rating: number;
  totalGames: number;
  wonGames: number;
}

export interface PlayerProfile {
  id: number;
  login: string;
  registeredAt: string | null;
  clan: { tag: string; name: string } | null;
  /** Earlier logins, newest first. */
  names: { name: string; changedAt: string | null }[];
  ratings: ProfileRating[];
  /** The lobby's view while the player is online; null when offline. */
  online: {
    country: string | null;
    avatar: PlayerAvatar | null;
    game: { id: number; title: string; playing: boolean } | null;
  } | null;
}

export interface RatingHistoryPoint {
  time: string;
  /** Displayed rating after the game. */
  rating: number;
  gameId: number | null;
}

export interface ProfileAchievement {
  id: string;
  name: string;
  description: string;
  iconUrl: string | null;
  /** A hidden achievement is not named until it is unlocked. */
  state: 'hidden' | 'revealed' | 'unlocked';
  /** Progress of an incremental achievement; null for the others. */
  currentSteps: number | null;
  totalSteps: number | null;
  unlockedAt: string | null;
  experiencePoints: number;
}

export interface UnitCounts {
  air: number;
  land: number;
  naval: number;
  tech1: number;
  tech2: number;
  tech3: number;
  experimentals: number;
  engineers: number;
}

/** Counters the game reports for a player over all games, as the official client's statistics tab shows them. */
export interface PlayerStatistics {
  factions: { faction: MatchmakerFaction; games: number; wins: number }[];
  built: UnitCounts;
  lost: UnitCounts & { acus: number };
  secondsPlayed: number;
  customGames: number;
  ladderGames: number;
}

export interface PlayerSearchResult {
  id: number;
  login: string;
}

export const REPORT_STATUSES = ['awaiting', 'processing', 'completed', 'discarded'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_LIMITS = {
  descriptionMaxLength: 2000,
  incidentTimeMaxLength: 20,
  maxPlayers: 10,
} as const;

/** A report of the signed-in player to the FAF moderators. */
export interface ModerationReportItem {
  id: string;
  createdAt: string | null;
  status: ReportStatus;
  description: string;
  reported: string[];
  gameId: number | null;
  incidentTime: string | null;
  moderatorNotice: string | null;
}

export interface ModerationReportInput {
  players: number[];
  /** The game the incident happened in; the reported players must have played in it. */
  gameId: number | null;
  /** When in the game, required with a game, e.g. `12:30`. */
  incidentTime: string;
  description: string;
}

export interface ClanInfo {
  tag: string;
  name: string;
  /** Only an https address. */
  websiteUrl: string | null;
  /** The leader's login. */
  leader: string | null;
}
