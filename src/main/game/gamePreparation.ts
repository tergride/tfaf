import path from 'node:path';
import type { LobbyNotice, LocalFilesCheck } from '../../shared/contract.ts';
import { describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import type { SettingsStore } from '../settings.ts';
import type { MapService } from '../vault/mapService.ts';
import type { ModService, ModVerification } from '../vault/modService.ts';
import { type GameFingerprint, mapKey, modFingerprints, modsDigest } from './fingerprint.ts';
import type { GameUpdater } from './gameUpdater.ts';
import { GAME_VAULT_FOLDER, type GameFileOverride, GameVault, isBuiltInMod } from './gameVault.ts';
import { INIT_FILE_NAME } from './launchCommand.ts';
import type { LaunchProgress } from './launchStages.ts';

/** What the files of a lobby game came to before the start: what the tab shows and what TFAF players compare. */
export interface PreparedFiles {
  localFiles: LocalFilesCheck;
  fingerprint: GameFingerprint;
  /** The sim mods of the game, which its vault holds. */
  simModUids: string[];
  /** The installed ones among them as checked. */
  mods: ModVerification[];
}

export interface PreparationDependencies {
  settings: SettingsStore;
  maps: MapService;
  mods: ModService;
  updater: GameUpdater;
}

/** The files a game starts with: brought up to date and checked before a lobby game, and the game's own vault. */
export class GamePreparation {
  private readonly deps: PreparationDependencies;
  private readonly notice: (style: LobbyNotice['style'], text: string) => void;
  private readonly gameVault = new GameVault();

  constructor(deps: PreparationDependencies, notice: (style: LobbyNotice['style'], text: string) => void) {
    this.deps = deps;
    this.notice = notice;
  }

  /**
   * Brings everything the game loads up to date, then checks the map and the sim mods against the FAF vault: a file
   * that differs between players would put them out of sync once the game runs.
   */
  async prepare(
    startup: LaunchProgress,
    featuredMod: string,
    simModUids: string[],
    mapFolderName: string,
    adapter: (() => Promise<void>) | null,
    modsToVerify = simModUids,
  ): Promise<PreparedFiles> {
    const { updater, mods, maps } = this.deps;
    const [files] = await Promise.all([
      startup.run('files', () => updater.update(featuredMod)),
      simModUids.length > 0 ? startup.run('mods', () => mods.ensureInstalledAndActive(simModUids)) : null,
      mapFolderName ? startup.run('map', () => maps.ensureInstalled(mapFolderName)) : null,
      adapter ? startup.run('adapter', adapter) : null,
    ]);
    // The mods of the game's mods.scd load from there, whatever a mod folder with their uid holds.
    const verified = modsToVerify.filter((uid) => !isBuiltInMod(uid));
    return startup.run('verify', async () => {
      const [map, sim] = await Promise.all([mapFolderName ? maps.verify(mapFolderName) : null, mods.verify(verified)]);
      for (const note of [map?.note ?? null, ...sim.notes]) {
        if (note) {
          this.notice(note.style, note.text);
        }
      }
      return {
        localFiles: {
          gameVersion: files.version,
          map: map?.state ?? null,
          mods: sim.mods.map(({ uid, name, state }) => ({ uid, name, state })),
        },
        fingerprint: {
          gameFiles: files.digest,
          map: map?.digest ?? null,
          mapKey: mapFolderName ? mapKey(mapFolderName) : null,
          mods: modsDigest(sim.mods),
          modFiles: modFingerprints(sim.mods),
        },
        simModUids: modsToVerify,
        mods: sim.mods,
      };
    });
  }

  /**
   * The init file of a game with mod isolation: it mounts a vault of the game's own (gameVault.ts) with these sim mods.
   * If that vault cannot be built, the game starts on the player's vault with a warning.
   */
  async initFile(binDirectory: string, simModUids: string[]): Promise<string> {
    const { settings, mods } = this.deps;
    try {
      return await this.gameVault.prepare({
        directory: path.join(settings.get().dataPath, GAME_VAULT_FOLDER),
        binDirectory,
        mapsDirectory: settings.mapsDirectory,
        modFolders: await mods.gameModFolders(simModUids),
      });
    } catch (error) {
      console.warn('The vault of the game could not be built; the game mounts every installed mod', describeError(error));
      this.notice('warning', t('main.game.gameVaultFailed', { error: describeError(error) }));
      return INIT_FILE_NAME;
    }
  }

  /**
   * The init file of a game in a TFAF lobby. Every game of a room mounts a vault of its own, so unlike above a failure
   * stops the start. `overrides`: what the host's game needs to play the room out.
   */
  async lobbyInitFile(binDirectory: string, simModUids: string[], overrides: GameFileOverride[]): Promise<string> {
    const { settings, mods } = this.deps;
    return this.gameVault.prepare({
      directory: path.join(settings.get().dataPath, GAME_VAULT_FOLDER),
      binDirectory,
      mapsDirectory: settings.mapsDirectory,
      modFolders: await mods.gameModFolders(simModUids),
      overrides,
    });
  }

  /** Removes the vault of the game that ended. */
  release(): void {
    this.gameVault.release().catch((error: unknown) => console.warn('The vault of the game could not be removed', describeError(error)));
  }
}
