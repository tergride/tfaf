// The files of a running lobby game follow its lobby: the host may pick another map and tick other sim mods there.
// Whatever the lobby picks is downloaded if missing and checked against the FAF vault like before the start
// (gamePreparation.ts), and the result replaces what the current-game tab shows and what the TFAF players compare.

import type { LobbyNotice, LocalCheckState, LocalFilesCheck } from '../../shared/contract.ts';
import { describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import type { MapService } from '../vault/mapService.ts';
import type { ModService, ModVerification } from '../vault/modService.ts';
import { type GameFingerprint, mapKey, modFingerprints, modsDigest } from './fingerprint.ts';
import type { PreparedFiles } from './gamePreparation.ts';
import { isBuiltInMod } from './gameVault.ts';

/** What the game's lobby has: the map's folder and the ticked sim mods, null while they are not known. */
export interface LobbyContent {
  mapFolderName: string;
  simMods: { uid: string; name: string }[] | null;
}

export interface LobbyFilesUpdate {
  mapFolderName: string | null;
  localFiles: LocalFilesCheck;
  fingerprint: GameFingerprint;
  /** Every sim mod checked for this game, also those unticked since, to name them in comparisons. */
  checkedMods: { uid: string; name: string }[];
}

export interface LobbyFilesDependencies {
  maps: Pick<MapService, 'ensureInstalled' | 'verify'>;
  mods: Pick<ModService, 'ensureInstalled' | 'verify'>;
  notice(style: LobbyNotice['style'], text: string): void;
  onUpdate(update: LobbyFilesUpdate): void;
  /** Everything the lobby asked for was dealt with; `failed`: its map or one of its mods could not be brought in. */
  onSettled?(failed: boolean): void;
}

interface MapCheck {
  state: LocalCheckState | null;
  digest: string | null;
}

export class LobbyFiles {
  private readonly deps: LobbyFilesDependencies;
  private readonly gameVersion: number | null;
  private readonly gameFiles: string | null;
  private mapFolderName: string | null;
  private map: MapCheck;
  /** Checked maps by lower-case folder name, so picking one again needs no second check. */
  private readonly maps = new Map<string, MapCheck>();
  /** Checked sim mods by lower-case uid. */
  private readonly mods = new Map<string, ModVerification>();
  /** Mods already brought in, successfully or not, by lower-case uid. */
  private readonly tried = new Set<string>();
  /** The maps and mods that could not be brought in, by lower-case folder name or uid. */
  private readonly failed = new Set<string>();
  /** Lower-case uids of the mods the lobby ticked; null until it tells, and then the checked mods count. */
  private ticked: string[] | null = null;
  private wanted: LobbyContent | null = null;
  private draining = false;
  private stopped = false;
  private reported: string;

  constructor(deps: LobbyFilesDependencies, prepared: PreparedFiles, mapFolderName: string | null) {
    this.deps = deps;
    this.gameVersion = prepared.localFiles.gameVersion;
    this.gameFiles = prepared.fingerprint.gameFiles;
    // A map the preparation left out (a StoneMap map that comes with the room's recipe) is brought in on the first follow.
    this.mapFolderName = prepared.localFiles.map === null ? null : mapFolderName || null;
    this.map = { state: prepared.localFiles.map, digest: prepared.fingerprint.map };
    if (this.mapFolderName) {
      this.maps.set(this.mapFolderName.toLowerCase(), this.map);
    }
    for (const mod of prepared.mods) {
      this.mods.set(mod.uid.toLowerCase(), mod);
    }
    for (const uid of prepared.simModUids) {
      this.tried.add(uid.toLowerCase());
    }
    this.reported = JSON.stringify(this.snapshot());
  }

  /** The game's lobby changed. Changes are brought in one after another; only the latest waiting one counts. */
  follow(content: LobbyContent): void {
    if (this.stopped) {
      return;
    }
    this.wanted = content;
    if (!this.draining) {
      void this.drain();
    }
  }

  /** The game left its lobby or ended: nothing changes any more. */
  stop(): void {
    this.stopped = true;
    this.wanted = null;
  }

  private async drain(): Promise<void> {
    this.draining = true;
    let last: LobbyContent | null = null;
    try {
      while (this.wanted && !this.stopped) {
        last = this.wanted;
        this.wanted = null;
        await this.bringIn(last);
      }
    } finally {
      this.draining = false;
    }
    if (last && !this.stopped) {
      this.deps.onSettled?.(this.hasFailed(last));
    }
  }

  private hasFailed(content: LobbyContent): boolean {
    const names = [content.mapFolderName, ...(content.simMods ?? []).filter((mod) => !isBuiltInMod(mod.uid)).map((mod) => mod.uid)];
    return names.some((name) => this.failed.has(name.toLowerCase()));
  }

  private async bringIn(content: LobbyContent): Promise<void> {
    const mapFolderName = content.mapFolderName || null;
    if (mapFolderName && mapFolderName.toLowerCase() !== this.mapFolderName?.toLowerCase()) {
      this.mapFolderName = mapFolderName;
      this.map = await this.checkMap(mapFolderName);
    }
    if (content.simMods) {
      // The mods of the game's mods.scd load from there, whatever a mod folder with their uid holds.
      const ticked = content.simMods.filter((mod) => !isBuiltInMod(mod.uid));
      for (const mod of ticked) {
        const key = mod.uid.toLowerCase();
        if (!this.tried.has(key) && !this.stopped) {
          this.tried.add(key);
          await this.checkMod(mod);
        }
      }
      this.ticked = ticked.map((mod) => mod.uid.toLowerCase());
    }
    this.report();
  }

  private async checkMap(folderName: string): Promise<MapCheck> {
    const key = folderName.toLowerCase();
    const known = this.maps.get(key);
    if (known) {
      return known;
    }
    try {
      await this.deps.maps.ensureInstalled(folderName);
      const { state, digest, note } = await this.deps.maps.verify(folderName);
      if (note) {
        this.deps.notice(note.style, note.text);
      }
      const check = { state, digest };
      this.maps.set(key, check);
      this.failed.delete(key);
      return check;
    } catch (error) {
      console.warn(`The map ${folderName} picked in the lobby could not be prepared`, describeError(error));
      this.deps.notice('warning', t('main.game.lobbyMapFailed', { map: folderName, error: describeError(error) }));
      this.failed.add(key);
      return { state: 'unchecked', digest: null };
    }
  }

  private async checkMod(mod: { uid: string; name: string }): Promise<void> {
    try {
      await this.deps.mods.ensureInstalled([mod.uid]);
      const { notes, mods } = await this.deps.mods.verify([mod.uid]);
      for (const note of notes) {
        this.deps.notice(note.style, note.text);
      }
      // Nothing comes back for a mod that is not installed as a sim mod; it is then neither shown nor compared.
      for (const checked of mods) {
        this.mods.set(checked.uid.toLowerCase(), checked);
      }
    } catch (error) {
      console.warn(`The mod ${mod.name} (${mod.uid}) ticked in the lobby could not be prepared`, describeError(error));
      this.deps.notice('warning', t('main.game.lobbyModFailed', { mod: mod.name, error: describeError(error) }));
      this.mods.set(mod.uid.toLowerCase(), { uid: mod.uid, name: mod.name, state: 'unchecked', digest: null });
      this.failed.add(mod.uid.toLowerCase());
    }
  }

  private snapshot(): Omit<LobbyFilesUpdate, 'checkedMods'> {
    const listed = this.ticked === null ? [...this.mods.values()] : this.ticked.flatMap((key) => this.mods.get(key) ?? []);
    // In a fixed order, so the same mods ticked in another order change nothing.
    const mods = listed.sort((a, b) => a.name.localeCompare(b.name) || a.uid.localeCompare(b.uid));
    return {
      mapFolderName: this.mapFolderName,
      localFiles: {
        gameVersion: this.gameVersion,
        map: this.map.state,
        mods: mods.map(({ uid, name, state }) => ({ uid, name, state })),
      },
      fingerprint: {
        gameFiles: this.gameFiles,
        map: this.map.digest,
        mapKey: this.mapFolderName ? mapKey(this.mapFolderName) : null,
        mods: modsDigest(mods),
        modFiles: modFingerprints(mods),
      },
    };
  }

  private report(): void {
    if (this.stopped) {
      return;
    }
    const snapshot = this.snapshot();
    const serialized = JSON.stringify(snapshot);
    if (serialized === this.reported) {
      return;
    }
    this.reported = serialized;
    this.deps.onUpdate({ ...snapshot, checkedMods: [...this.mods.values()].map(({ uid, name }) => ({ uid, name })) });
  }
}
