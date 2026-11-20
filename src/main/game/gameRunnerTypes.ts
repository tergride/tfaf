// What GameRunner (gameRunner.ts) is built with, what it reports, what a replay to watch brings, and the session state
// it starts from.

import type { CurrentGameDetails, GameSessionState, HostGameOptions, LobbyNotice } from '../../shared/contract.ts';
import type { FafApi } from '../api/fafApi.ts';
import type { LobbyService } from '../lobby/lobbyService.ts';
import type { SettingsStore } from '../settings.ts';
import type { StoneMapService } from '../stoneMap/stoneMapService.ts';
import type { TaskReporter } from '../tasks.ts';
import type { MapService } from '../vault/mapService.ts';
import type { ModService } from '../vault/modService.ts';
import type { GameUpdater, ReplayVersions } from './gameUpdater.ts';
import type { HostedContent } from './hostedContent.ts';
import type { IceAdapter, LobbyAdapter } from './iceAdapter.ts';
import type { FeatureAnnouncement } from './lobbyFeatures.ts';
import type { LobbyMemory } from './tfafLobby/lobbyMemory.ts';

/** Other players' TFAF launchers as the chat finds them (tfafPresence.ts). */
export interface TfafChat {
  /** The TFAF version of a player's launcher: null for another client, undefined while the chat has not seen them. */
  tfafVersion(login: string): string | null | undefined;
  /** Like tfafVersion, but asks the server about a player the chat has not seen; null for another client or without an answer. */
  lookupTfaf(login: string): Promise<string | null>;
  /** The lobby features of a game from its host's launcher; null without an answer. */
  queryLobby(host: string, gameId: number): Promise<FeatureAnnouncement | null>;
}

export interface GameRunnerDependencies {
  api: FafApi;
  settings: SettingsStore;
  lobby: LobbyService;
  maps: MapService;
  /** Makes a StoneMap map of a TFAF room for a player who does not have it. */
  stoneMap: Pick<StoneMapService, 'buildId' | 'rememberRecipe'>;
  mods: ModService;
  updater: GameUpdater;
  tasks: TaskReporter;
  /** Written into the metadata of the replays the launcher keeps. */
  launcherVersion: string;
  createAdapter(): IceAdapter;
  /** The adapter of a TFAF lobby, whichever is selected for other games: only ours connects players without a game. */
  createLobbyAdapter(): LobbyAdapter;
  /**
   * What the selected adapter needs downloaded (Java), done while the game files are prepared rather than after the
   * server answered; null when it needs nothing.
   */
  adapterPreparation(): (() => Promise<void>) | null;
  /** The player's league on a leaderboard, which a matchmaker game shows; null when unknown. */
  leagueDivision(playerId: number, leaderboard: string): Promise<{ division: string; subdivision: string | null } | null>;
  tfafChat: TfafChat;
  /** What this launcher keeps of TFAF lobbies between games. */
  lobbyMemory: LobbyMemory;
}

export interface GameRunnerEvents {
  onState(state: GameSessionState): void;
  onNotice(notice: LobbyNotice): void;
  /** Every slot of the game's lobby is taken; `pid` is the Forged Alliance process, when known. */
  onGameFull(title: string | null, pid: number | null): void;
  /** The game ended with an error, not closed by the player or the launcher. */
  onGameFailed(error: string, logFile: string): void;
  /** An online game that had started ended normally, so it can be reviewed. */
  onGameEnded(gameId: number, title: string | null): void;
  /** A game is hosted with newer versions of the map or mods than were chosen, so the saved form can follow. */
  onHostContentUpdated(chosen: HostedContent, latest: HostedContent): void;
  /** A player's files turned out to differ from the host's, in a part not reported before. */
  onFilesDiffer(): void;
}

/** What `watchReplay` plays, once the replay is downloaded or the live stream is ready. */
export interface ReplayLaunch {
  /** Replaces the title shown so far, once the replay file tells the game's name. */
  title?: string;
  /** `/replay` argument: a `.scfareplay` file or the `gpgnet://` address of a live game. */
  source: string;
  replayId: number | null;
  featuredMod: string;
  /** The version the game was recorded with; null plays it with the latest files, as for a live game. */
  versions: ReplayVersions | null;
  simModUids: string[];
  mapFolderName: string | null;
  /** Runs when the game exits or does not start. */
  cleanup?: () => void;
}

export const IDLE: GameSessionState = {
  phase: 'idle',
  kind: 'online',
  gameId: null,
  title: null,
  message: null,
  error: null,
  peers: [],
  files: null,
  featureIssues: [],
  stages: [],
  cancellable: false,
  current: null,
  tfafLobby: null,
};

/** The host's new game a joined player waits for after the host's rehost (rehost.ts). */
export interface FollowedHost {
  host: string;
  previousId: number;
  password: string | null;
  title: string;
  mapFolderName: string;
  modUids: string[];
}

/** What starts once Forged Alliance has exited: our game hosted again, or the host's new game to join. */
export type NextGame = { kind: 'host'; options: HostGameOptions } | ({ kind: 'follow' } & FollowedHost);

/** What the current-game tab shows of a start before the game runs. */
export type GameDetails = Omit<CurrentGameDetails, 'startedAt' | 'launched' | 'lobbyGame' | 'desyncs' | 'hostedMods' | 'lobbyFeatures'>;
