// Common interface of the network adapters that sit between Forged Alliance and the other players. The game talks
// GPGNet to the adapter on a local TCP port; the adapter relays lobby commands and establishes peer connections.
// Implementations: the official Java adapter (javaIceAdapter.ts) and our own (../ice/tfafIceAdapter.ts).

import type { GamePeer } from '../../shared/contract.ts';
import type { GameFingerprint } from './fingerprint.ts';
import type { PeerLauncher } from './lobbyFeatureChecks.ts';
import type { FeatureAnnouncement } from './lobbyFeatures.ts';

export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface IceAdapterStartOptions {
  gameId: number;
  playerId: number;
  login: string;
  forceRelay: boolean;
  /** "auto" for matchmaker games, "normal" otherwise. */
  lobbyInitMode: 'normal' | 'auto';
  iceServers: IceServerConfig[];
  logsDirectory: string;
  /** Our game files, which TFAF adapters compare with each other; null when they were not checked. */
  fingerprint: GameFingerprint | null;
  /** Our TFAF version and the lobby features our game was started with, for the TFAF players; null tells nothing. */
  launcher: FeatureAnnouncement | null;
  /**
   * Players connect before Forged Alliance runs, for a lobby inside the launcher. The game may start and exit any number
   * of times; it gets its commands from `LobbyAdapter.releaseGame` on, and the connections stay. TFAF adapter only.
   */
  gameless?: boolean;
}

export interface IceAdapterEvents {
  /** A GPGNet message from the game that has to be forwarded to the lobby server. */
  onGpgNetMessage(header: string, args: unknown[]): void;
  /** Connection data for a remote player that has to be relayed through the lobby server. */
  onIceMessage(remotePlayerId: number, message: unknown): void;
  onConnectionStateChanged(state: string): void;
  onPeerStatus(status: GamePeer): void;
  /** The game files of a player whose TFAF adapter sent them; other adapters never report this. */
  onPeerFiles(remotePlayerId: number, login: string, fingerprint: GameFingerprint): void;
  /** A player's TFAF adapter announced that it creates its game again with these mods; other adapters never report this. */
  onPeerRehost(remotePlayerId: number, login: string, modUids: string[]): void;
  /** What a player's launcher is, once the TFAF handshake tells it; the Java adapter never reports this. */
  onPeerLauncher(remotePlayerId: number, login: string, launcher: PeerLauncher): void;
  /** A player, our host, disconnects us because our game lacks these required lobby features; TFAF adapter only. */
  onPeerKick(remotePlayerId: number, login: string, features: string[]): void;
  /** A message of the lobby inside the launcher, complete and once; TFAF adapter only. */
  onLobbyMessage(remotePlayerId: number, login: string, text: string): void;
  onPeerRemoved(remotePlayerId: number): void;
  /**
   * Every connected player went silent at once: our own network is the likely cause, and the lobby connection that
   * carries the reconnects is worth checking. TFAF adapter only.
   */
  onNetworkSuspect(): void;
  /** The adapter stopped on its own (crash or game exit). */
  onExit(reason: string): void;
}

export interface IceAdapter {
  /** Starts the adapter and resolves with the local GPGNet port the game has to connect to. */
  start(options: IceAdapterStartOptions, events: IceAdapterEvents): Promise<number>;
  hostGame(mapName: string): void;
  joinGame(remotePlayerLogin: string, remotePlayerId: number): void;
  connectToPeer(remotePlayerLogin: string, remotePlayerId: number, offer: boolean): void;
  disconnectFromPeer(remotePlayerId: number): void;
  iceMessage(remotePlayerId: number, message: unknown): void;
  /**
   * The lobby connection came back and the game session is restored. Connection data sent meanwhile may be lost, so
   * the TFAF adapter repeats what still waits for an answer; the Java adapter retries on its own schedule.
   */
  signalingRestored(): void;
  /**
   * Tells the players that the hosted game is created again with these mods; resolves once those that can follow
   * confirmed, after a few seconds at most. The Java adapter cannot tell anyone and resolves at once.
   */
  announceRehost(modUids: string[]): Promise<void>;
  /**
   * Disconnects a player from our game for lacking these required lobby features: a TFAF adapter tells the player why
   * first, then both drop the player as for DisconnectFromPeer, and the lobby of the game frees the slot.
   */
  kickPeer(remotePlayerId: number, features: string[]): Promise<void>;
  /** Our game files changed in the game's lobby: TFAF adapters send them to the players again, the Java adapter cannot. */
  updateFingerprint(fingerprint: GameFingerprint): void;
  stop(): void;
}

/** What a lobby inside the launcher needs from an adapter, which only ours can do. */
export interface LobbyAdapter extends IceAdapter {
  /** Delivers a lobby message to the player; `key`: a newer message with that key replaces this one on its way. */
  sendLobbyMessage(remotePlayerId: number, text: string, key: string | null): boolean;
  /** The map of the room, which the game hosts when it starts. */
  setHostedMap(mapName: string): void;
  /** The game gets its host and join commands, now or once it reaches its lobby. */
  releaseGame(): void;
}
