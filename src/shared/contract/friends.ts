import type { PlayerAvatar } from './profile.ts';

/** A player on the friend list, which the lobby server keeps for the account. */
export interface Friend {
  id: number;
  /** Null for a friend who is offline while the API has not told the login, or no longer knows the account. */
  login: string | null;
  online: boolean;
  /** The lobby's view of a friend who is online; null for one who is offline. */
  clan: string | null;
  country: string | null;
  rating: number | null;
  avatar: PlayerAvatar | null;
}

export interface FriendsState {
  /** In no particular order: the renderer groups them by what they are doing. */
  friends: Friend[];
}

/** An online player found by login, to add as a friend. */
export interface FoundPlayer {
  id: number;
  login: string;
  clan: string | null;
  country: string | null;
  friend: boolean;
}
