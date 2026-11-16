import type { PlayerAvatar } from './profile.ts';

export type LobbyStatus = 'disconnected' | 'connecting' | 'connected';

export interface LobbyState {
  status: LobbyStatus;
  error: string | null;
}

export interface LobbyGamePlayer {
  id: number | null;
  login: string;
  clan: string | null;
  country: string | null;
  /** Displayed rating (mean - 3 * deviation) in the game's leaderboard. */
  rating: number | null;
  /** On the signed-in player's friend list. */
  friend: boolean;
  avatar: PlayerAvatar | null;
}

export interface LobbyGameTeam {
  /** FA team number: 1 means "no team", -1 observers, 2+ actual teams. */
  team: number;
  players: LobbyGamePlayer[];
}

export interface LobbyGame {
  id: number;
  /** The server's game type: `custom` and `coop` games are listed, and live games may also be `matchmaker`. */
  gameType: string;
  title: string;
  host: string;
  mapFolderName: string;
  mapPreviewUrl: string | null;
  mapPreviewLargeUrl: string | null;
  featuredMod: string;
  featuredModName: string;
  simMods: { uid: string; name: string }[];
  numPlayers: number;
  maxPlayers: number;
  passwordProtected: boolean;
  friendsOnly: boolean;
  ratingType: string | null;
  ratingMin: number | null;
  ratingMax: number | null;
  enforceRatingRange: boolean;
  hostedAt: string | null;
  averageRating: number | null;
  /** TrueSkill match quality 0..1 from the players' ratings in the game's leaderboard; null when not all are known. */
  quality: number | null;
  /** The map is made by the Neroxis generator. */
  generatedMap: boolean;
  /** A lobby inside the launcher, open to TFAF players; `title` comes without its mark on the server. */
  tfafLobby: boolean;
  teams: LobbyGameTeam[];
}

export interface LobbyGamesUpdate {
  /** When set, the receiver drops everything it had before applying the update. */
  reset: boolean;
  upserts: LobbyGame[];
  removals: number[];
}

export interface LobbyNotice {
  id: string;
  style: 'info' | 'warning' | 'error';
  text: string;
  /** Matters only in the moment: a toast, not an entry of the bell. */
  transient?: boolean;
}

export interface FeaturedModInfo {
  technicalName: string;
  displayName: string;
  description: string;
}
