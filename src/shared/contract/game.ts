import type { LobbyGame } from './lobby.ts';
import type { TfafLobbyView } from './tfafLobby.ts';
import type { ModType } from './vault.ts';

/** Result of checking the FAF game files against the hashes the server publishes. */
export interface GameFilesCheck {
  checked: number;
  /** `group/name` of the files that differed and were downloaded or copied again. */
  repaired: string[];
}

/** A download that a newer version replaced, e.g. an earlier map generator; it is downloaded again if needed. */
export interface OldVersion {
  title: string;
  bytes: number;
}

export interface OldVersionsCleanup {
  freedBytes: number;
  /** What could not be removed, usually because a running program holds it. */
  remaining: OldVersion[];
}

/** The `.log` files in `<dataPath>\logs`, subfolders included. */
export interface LogsUsage {
  files: number;
  bytes: number;
}

export interface LogsCleanup {
  removedFiles: number;
  freedBytes: number;
  /** Logs the rules picked that could not be removed, usually because a running program holds them. */
  busyFiles: number;
  /** What is left afterwards. */
  usage: LogsUsage;
}

/**
 * - `ok`: the files match the FAF vault;
 * - `repaired`: they differed and the mod was reinstalled;
 * - `notInVault`: nothing to compare with, e.g. a mod in development;
 * - `unchecked`: the vault could not be reached;
 * - `failed`: the files differ and the mod could not be reinstalled.
 */
export type ModCheckStatus = 'ok' | 'repaired' | 'notInVault' | 'unchecked' | 'failed';

export interface ModCheck {
  uid: string;
  name: string;
  type: ModType;
  status: ModCheckStatus;
  /** What differed, or why the check or the repair failed. */
  details: string | null;
}

/** `lobby`: in a TFAF lobby, where Forged Alliance does not run yet. */
export type GamePhase = 'idle' | 'preparing' | 'waitingForServer' | 'launching' | 'lobby' | 'running';

export type PeerConnectionState = 'connecting' | 'connected' | 'reconnecting';

/** Connection to another player of the running game, as far as the network adapter reports it. */
export interface GamePeer {
  playerId: number;
  login: string;
  state: PeerConnectionState;
  /** Path of the connection; null when the adapter does not report it. */
  route: 'direct' | 'relay' | null;
  rttMs: number | null;
  /** The player runs the TFAF adapter: true after the handshake, false when it did not answer, null while unknown. */
  tfaf: boolean | null;
  /** Game packets to the player are sent twice because of measured packet loss. */
  duplication: boolean;
  /** Share of the last pings lost, in percent, towards the player and from them; TFAF players only. */
  loss: { out: number; in: number } | null;
}

/** A part of the game on two computers: TFAF clients compare fingerprints of their files. */
export type FilesComparison = 'same' | 'different' | 'unknown';

export interface PlayerFiles {
  gameFiles: FilesComparison;
  map: FilesComparison;
  mods: FilesComparison;
}

/** A player's files against the host's. */
export interface PlayerFilesCheck extends PlayerFiles {
  playerId: number;
  login: string;
  /**
   * The sim mods whose files differ from the host's, by name; null for a mod we do not have ourselves. Empty when
   * only the fingerprint of all mods together is known, as with older TFAF.
   */
  differentMods: readonly (string | null)[];
}

/**
 * Every player's files against the host's, which are the reference. Each TFAF client gets the fingerprints from every
 * player directly, so all of them see the same comparison.
 */
export interface GameFilesReport {
  /** The host; `known`: the host runs TFAF and sent its fingerprints. Null while the lobby has not named the host. */
  host: { playerId: number | null; login: string; known: boolean } | null;
  /** The other players, ourselves included unless we host. */
  players: PlayerFilesCheck[];
}

/**
 * How a part of the game compared with the FAF vault before the start. `official`: a map of the game installation,
 * which the vault does not hold.
 */
export type LocalCheckState = 'matches' | 'repaired' | 'notInVault' | 'unchecked' | 'official';

export interface LocalFilesCheck {
  /** Version of the featured mod files; every file was hashed before the start. */
  gameVersion: number | null;
  map: LocalCheckState | null;
  /** Sim mods only: UI mods run outside the simulation. */
  mods: { uid: string; name: string; state: LocalCheckState }[];
}

/** What the current game tab shows while Forged Alliance runs. */
export interface CurrentGameDetails {
  startedAt: string;
  /** The game has left its lobby and plays; a game without a lobby, such as a replay, plays from the start. */
  launched: boolean;
  featuredMod: string | null;
  map: { folderName: string; previewUrl: string | null; previewLargeUrl: string | null } | null;
  /** The lobby's view of an online game: host, teams, ratings and mods, kept current while it runs. */
  lobbyGame: LobbyGame | null;
  /** What the launcher checked on its side before the start. */
  localFiles: LocalFilesCheck | null;
  /** How many times the game reported a desync. */
  desyncs: number;
  /**
   * The mods of a game we host while it is in its lobby, which `game.changeMods` can change: the game is then created
   * again and the TFAF players follow. Null for other games and once the game has started.
   */
  hostedMods: string[] | null;
  /** Names of the TFAF lobby features our game was started with, such as mod isolation; null for games without a lobby. */
  lobbyFeatures: string[] | null;
}

/** A player of the game we host who lacks a TFAF lobby feature of the game. */
export interface LobbyFeatureIssue {
  playerId: number;
  login: string;
  /** Names of the features the player lacks. */
  features: string[];
  /** Disconnected, because one of them is required. */
  kicked: boolean;
}

/** `online`: a lobby game with other players; `offline`: a tutorial; `replay`: a recorded or live game to watch. */
export type GameSessionKind = 'online' | 'offline' | 'replay';

/**
 * How a join request went: `joining` once the start runs, `passwordRequired` when the game asks for a password the
 * request did not bring. For a TFAF lobby only the host's launcher knows that, so it is asked first.
 */
export type JoinOutcome = 'joining' | 'passwordRequired';

/** An online player to invite into the game we are in while it is in its lobby; the invited join without a password. */
export interface GameInvitee {
  id: number;
  login: string;
  clan: string | null;
  country: string | null;
  friend: boolean;
  /** Runs TFAF, whose launcher alone takes invitations; null while the chat has not seen the player. */
  tfaf: boolean | null;
  /** Already in our game. */
  inGame: boolean;
}

/**
 * Steps of a game start. `files`, `mods`, `map` and `adapter` run side by side; `server` and `start` cannot be
 * cancelled, since the server is already creating the game. `host`: waiting for the host's game created again;
 * `lobby`: asking the host's TFAF launcher which lobby features its game uses.
 */
export type LaunchStageId = 'replay' | 'host' | 'lobby' | 'files' | 'mods' | 'map' | 'adapter' | 'verify' | 'server' | 'start';

export interface LaunchStage {
  id: LaunchStageId;
  title: string;
  state: 'pending' | 'running' | 'done' | 'failed';
  /** 0..1 while a download or a check reports it. */
  progress: number | null;
  /** What happens right now, e.g. the file being downloaded with its size and speed. */
  detail: string | null;
}

export interface GameSessionState {
  phase: GamePhase;
  kind: GameSessionKind;
  gameId: number | null;
  title: string | null;
  message: string | null;
  error: string | null;
  peers: GamePeer[];
  /** Files of an online game compared with the host's; null for other games and before the start. */
  files: GameFilesReport | null;
  /** Players of the game we host who lack one of its TFAF lobby features. */
  featureIssues: LobbyFeatureIssue[];
  /** Steps of the start; kept after a failed start to show where it failed, empty once the game runs. */
  stages: LaunchStage[];
  /** The start can still be cancelled. */
  cancellable: boolean;
  /** Set while Forged Alliance runs, and in a TFAF lobby. */
  current: CurrentGameDetails | null;
  /** The room of a TFAF lobby, until the game of its match ends. */
  tfafLobby: TfafLobbyView | null;
}
