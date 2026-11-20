import { isStoneMapFolder } from '../../shared/contract.ts';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { describeError } from '../errors.ts';
import type { GameLaunch, LobbyPlayer } from '../lobby/lobbyProtocol.ts';
import { ReplayRecorder } from '../replays/replayRecorder.ts';
import type { GameFingerprint } from './fingerprint.ts';
import type { GameRunnerDependencies } from './gameRunnerTypes.ts';
import { relayLobbyCommand } from './gpgRelay.ts';
import type { IceAdapter, IceAdapterEvents, LobbyAdapter } from './iceAdapter.ts';
import { parseIceSession } from './iceSession.ts';
import { buildLaunchArguments } from './launchCommand.ts';
import type { FeatureAnnouncement } from './lobbyFeatures.ts';
import { fetchReplayAccessUrl, ReplayRelay } from './replayRelay.ts';

export type OnlineGameDependencies = Pick<
  GameRunnerDependencies,
  'api' | 'lobby' | 'settings' | 'maps' | 'createAdapter' | 'createLobbyAdapter' | 'leagueDivision' | 'launcherVersion'
>;

export interface OnlineGameHooks {
  /** The init file of the game's vault, made once the adapter runs. */
  initFile(): Promise<string>;
  adapterEvents(adapter: IceAdapter): IceAdapterEvents;
  /** Each lobby command for the game, before the adapter gets it. */
  onLobbyCommand(command: string, args: unknown[]): void;
}

/**
 * What an online game runs on besides Forged Alliance: the replay relay, which also keeps the stream, and the ICE
 * adapter, which gets the lobby's commands for the game. `stop` ends them once the game has exited or did not start.
 */
export class OnlineGame {
  private readonly deps: OnlineGameDependencies;
  private readonly launch: GameLaunch;
  private readonly self: LobbyPlayer;
  private readonly recorder = new ReplayRecorder();
  private adapter: IceAdapter | null = null;
  private replay: ReplayRelay | null = null;
  private gpgPort = 0;
  private unsubscribe = (): void => {};

  constructor(deps: OnlineGameDependencies, launch: GameLaunch, self: LobbyPlayer) {
    this.deps = deps;
    this.launch = launch;
    this.self = self;
  }

  /**
   * Starts the relay and the adapter; returns the arguments and the log file Forged Alliance starts with. `launcher`:
   * what the adapter tells the TFAF players about our game.
   */
  async start(
    fingerprint: GameFingerprint,
    launcher: FeatureAnnouncement | null,
    hooks: OnlineGameHooks,
  ): Promise<{ args: string[]; logFile: string }> {
    await this.connect(this.deps.createAdapter(), false, fingerprint, launcher, hooks);
    return this.launchCommand(await hooks.initFile());
  }

  /**
   * Starts the relay and our adapter for a lobby inside the launcher: players connect now, and Forged Alliance starts
   * later from `launchCommand`.
   */
  async startForLobby(fingerprint: GameFingerprint, launcher: FeatureAnnouncement | null, hooks: OnlineGameHooks): Promise<LobbyAdapter> {
    const adapter = this.deps.createLobbyAdapter();
    await this.connect(adapter, true, fingerprint, launcher, hooks);
    return adapter;
  }

  /** What Forged Alliance starts with, once the adapter runs. */
  async launchCommand(initFile: string): Promise<{ args: string[]; logFile: string }> {
    const { launch, self } = this;
    const logsDirectory = this.deps.settings.logsDirectory;
    const rating = self.ratings.get(launch.leaderboard);
    const logFile = path.join(logsDirectory, `game_${launch.uid}.log`);
    const league = await this.league();
    const args = buildLaunchArguments({
      uid: launch.uid,
      username: self.login,
      gpgPort: this.gpgPort,
      replayPort: this.replay?.port ?? 0,
      logFile,
      mean: rating?.mean ?? 0,
      deviation: rating?.deviation ?? 0,
      division: league?.division ?? null,
      subdivision: league?.subdivision ?? null,
      country: self.country,
      clan: self.clan,
      numberOfGames: self.numberOfGames,
      faction: launch.faction,
      team: launch.team,
      expectedPlayers: launch.expectedPlayers,
      mapPosition: launch.mapPosition,
      gameOptions: launch.gameOptions,
      additionalArgs: launch.args,
      initFile,
    });
    return { args, logFile };
  }

  private async connect(
    adapter: IceAdapter,
    gameless: boolean,
    fingerprint: GameFingerprint,
    launcher: FeatureAnnouncement | null,
    hooks: OnlineGameHooks,
  ): Promise<void> {
    const { api, lobby, settings, maps } = this.deps;
    const { launch, self } = this;
    // In a TFAF room a StoneMap map is made from the room's recipe, which arrives only once the players connect.
    const roomBringsMap = gameless && launch.mapName !== null && isStoneMapFolder(launch.mapName);
    const [, iceSession] = await Promise.all([
      launch.mapName && !roomBringsMap ? maps.ensureInstalled(launch.mapName) : Promise.resolve(),
      api.getJson(`/ice/session/game/${launch.uid}`),
    ]);
    const session = parseIceSession(iceSession, settings.get().preferredTurnIds);
    const replay = await ReplayRelay.start(() => fetchReplayAccessUrl(api), {
      onGameData: (chunk) => {
        this.recorder.add(chunk);
        this.recorder.noteGame(lobby.getRawGame(launch.uid));
      },
    });
    this.replay = replay;

    this.adapter = adapter;
    this.unsubscribe = lobby.onGameMessage((command, args) => {
      hooks.onLobbyCommand(command, args);
      if (!relayLobbyCommand(adapter, command, args)) {
        console.warn(`Unhandled game command from the lobby: ${command}`);
      }
    });
    const logsDirectory = settings.logsDirectory;
    await mkdir(logsDirectory, { recursive: true });
    this.gpgPort = await adapter.start(
      {
        gameId: launch.uid,
        playerId: self.id,
        login: self.login,
        forceRelay: session.forceRelay,
        lobbyInitMode: launch.gameType === 'matchmaker' ? 'auto' : 'normal',
        iceServers: session.servers,
        logsDirectory,
        fingerprint,
        launcher,
        gameless,
      },
      hooks.adapterEvents(adapter),
    );
  }

  /** Tells the players of our game that it is created again with these mods (IceAdapter.announceRehost). */
  async announceRehost(modUids: string[]): Promise<void> {
    await this.adapter?.announceRehost(modUids);
  }

  /** Sends the players our files as the game's lobby changed them (IceAdapter.updateFingerprint). */
  updateFingerprint(fingerprint: GameFingerprint): void {
    this.adapter?.updateFingerprint(fingerprint);
  }

  /** The lobby connection is back and the session restored (IceAdapter.signalingRestored). */
  signalingRestored(): void {
    this.adapter?.signalingRestored();
  }

  /** Disconnects a player who lacks these required lobby features (IceAdapter.kickPeer). */
  async kickPeer(playerId: number, features: string[]): Promise<void> {
    await this.adapter?.kickPeer(playerId, features);
  }

  /** Stops what `start` started, tells the server that the game ended and keeps its replay. */
  stop(): void {
    this.unsubscribe();
    this.adapter?.stop();
    this.replay?.stop();
    this.deps.lobby.sendGameMessage('GameState', ['Ended']);
    this.saveReplay();
  }

  /** The official client shows the league in matchmaker games of leaderboards other than global; it is cosmetic. */
  private async league(): Promise<{ division: string; subdivision: string | null } | null> {
    const { launch, self } = this;
    if (launch.gameType !== 'matchmaker' || launch.leaderboard === 'global') {
      return null;
    }
    try {
      return await this.deps.leagueDivision(self.id, launch.leaderboard);
    } catch (error) {
      console.warn(`League on ${launch.leaderboard} could not be loaded`, describeError(error));
      return null;
    }
  }

  private saveReplay(): void {
    const { settings, launcherVersion } = this.deps;
    const gameId = this.launch.uid;
    this.recorder.save(settings.replaysDirectory, gameId, this.self.login, launcherVersion).then(
      (file) => {
        if (file) {
          console.info(`Replay of game ${gameId} saved to ${file} (${this.recorder.recorded} bytes)`);
        }
      },
      (error: unknown) => console.warn(`Replay of game ${gameId} could not be saved`, describeError(error)),
    );
  }
}
