import { shell } from 'electron';
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { isStoneMapFolder, type LocalCheckState, type LocalMap, type MapQuery, type MapVaultCheck, type Page, type VaultMap } from '../../shared/contract.ts';
import type { AuthService } from '../auth/authService.ts';
import type { FafApi } from '../api/fafApi.ts';
import { asString, resolveDocument } from '../api/jsonApi.ts';
import { rsqlEquals, rsqlOr } from '../api/rsql.ts';
import { mapLimited } from '../concurrency.ts';
import { describeError } from '../errors.ts';
import { filesDigest, folderDigest } from '../game/fingerprint.ts';
import { t } from '../i18n.ts';
import { retrying } from '../net/http.ts';
import { isGeneratedMap } from '../lobby/lobbyProtocol.ts';
import { isFafHttpsUrl } from '../servers.ts';
import { isValidGamePath } from '../gameLocator.ts';
import type { SettingsStore } from '../settings.ts';
import type { StoneMapService } from '../stoneMap/stoneMapService.ts';
import type { TaskReporter } from '../tasks.ts';
import { toVaultMap } from './apiMappers.ts';
import { downloadToTempFile, progressFraction } from './download.ts';
import { findChildCaseInsensitive, isSafeFolderName, listDirectories, readTextFile } from './fsUtil.ts';
import { installArchive } from './installer.ts';
import { newerVersions } from './latestVersions.ts';
import type { MapGenerator } from './mapGenerator.ts';
import { existingLocalPreviewUrl, localPreviewFileName, localPreviewUrl } from './mapPreviews.ts';
import {
  checkFolder,
  describeProblems,
  fetchRemoteEntries,
  type IntegrityNote,
  type Manifest,
  manifestFromEntries,
  type ManifestStore,
} from './integrity.ts';
import { ParsedFileCache } from './parsedFileCache.ts';
import { readScenario, type ScenarioInfo } from './scenarioReader.ts';
import { mapListParams } from './vaultQueries.ts';
import { readZipEntries } from './zip.ts';

// Maps shipped with the game; they live in the installation folder and cannot be uninstalled.
const OFFICIAL_MAPS = [
  ...Array.from({ length: 40 }, (_, i) => `SCMP_${String(i + 1).padStart(3, '0')}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 17].map((n) => `X1MP_${String(n).padStart(3, '0')}`),
];
const OFFICIAL_MAP_NAMES = new Set(OFFICIAL_MAPS.map((name) => name.toLowerCase()));

const MAP_INCLUDES = 'latestVersion,author,reviewsSummary';
const SCAN_CONCURRENCY = 16;
// Folder names are longer than mod uids, so a batch stays well within the URL length servers accept.
const VAULT_NAME_BATCH_SIZE = 40;
const VAULT_CHECK_CONCURRENCY = 3;
// Switching back to a category or page shows the list at once; new uploads appear a minute later at most.
const VAULT_CACHE_MS = 60_000;

const isScenarioFile = (fileName: string): boolean => fileName.endsWith('_scenario.lua');

export interface MapVerification {
  state: LocalCheckState;
  /** Digest of the map's files; null when they could not be read. */
  digest: string | null;
  note: IntegrityNote | null;
}

interface InstalledMap {
  info: LocalMap;
  path: string;
}

export class MapService {
  private readonly api: FafApi;
  private readonly auth: AuthService;
  private readonly settings: SettingsStore;
  private readonly tasks: TaskReporter;
  private readonly userAgent: string;
  private readonly installs = new Map<string, Promise<void>>();
  private readonly folderInstalls = new Map<string, Promise<void>>();
  private readonly scenarios = new ParsedFileCache<ScenarioInfo>();
  private readonly manifests: ManifestStore;
  private readonly generator: MapGenerator;
  private readonly stoneMap: Pick<StoneMapService, 'installMap'>;

  constructor(
    api: FafApi,
    auth: AuthService,
    settings: SettingsStore,
    tasks: TaskReporter,
    userAgent: string,
    manifests: ManifestStore,
    generator: MapGenerator,
    stoneMap: Pick<StoneMapService, 'installMap'>,
  ) {
    this.api = api;
    this.manifests = manifests;
    this.generator = generator;
    this.stoneMap = stoneMap;
    this.auth = auth;
    this.settings = settings;
    this.tasks = tasks;
    this.userAgent = userAgent;
  }

  async query(query: MapQuery): Promise<Page<VaultMap>> {
    const params: Record<string, string> = {
      ...mapListParams(query, this.auth.getUser()?.id ?? null),
      include: MAP_INCLUDES,
      'page[size]': String(query.pageSize),
      'page[number]': String(query.page),
      'page[totals]': '',
    };
    const document = resolveDocument(await this.api.getCached('/data/map', params, VAULT_CACHE_MS));
    return {
      items: document.items.map(toVaultMap).filter((map): map is VaultMap => map !== null),
      page: query.page,
      totalPages: document.totalPages ?? query.page,
      totalItems: document.totalRecords,
    };
  }

  async installed(): Promise<LocalMap[]> {
    return (await this.scan()).map((map) => map.info);
  }

  install(versionId: number): Promise<void> {
    const key = String(versionId);
    const running = this.installs.get(key);
    if (running) {
      return running;
    }
    const install = this.runInstall(versionId).finally(() => this.installs.delete(key));
    this.installs.set(key, install);
    return install;
  }

  /** Makes sure the map of a game is available, downloading it by folder name like MapService.downloadIfNecessary. */
  ensureInstalled(folderName: string): Promise<void> {
    return this.withFolder(folderName, () => this.runEnsureInstalled(folderName));
  }

  /** One install per map folder at a time, whether it was asked for by version (vault) or by name (a game). */
  private withFolder(folderName: string, work: () => Promise<void>): Promise<void> {
    const key = folderName.toLowerCase();
    const running = this.folderInstalls.get(key);
    if (running) {
      return running;
    }
    const install = work().finally(() => this.folderInstalls.delete(key));
    this.folderInstalls.set(key, install);
    return install;
  }

  /** The map is in the maps folder of the vault. */
  async hasCustomMap(folderName: string): Promise<boolean> {
    return (await this.findCustomMap(folderName)) !== null;
  }

  async uninstall(folderName: string): Promise<void> {
    if (OFFICIAL_MAP_NAMES.has(folderName.toLowerCase())) {
      throw new Error(t('main.vault.maps.officialUninstall'));
    }
    const mapPath = await this.findCustomMap(folderName);
    if (!mapPath) {
      throw new Error(t('main.vault.maps.notFound'));
    }
    await rm(mapPath, { recursive: true, force: true });
  }

  async reveal(folderName: string): Promise<void> {
    const installed = (await this.scan()).find((map) => map.info.folderName.toLowerCase() === folderName.toLowerCase());
    if (!installed) {
      throw new Error(t('main.vault.maps.notFound'));
    }
    const error = await shell.openPath(installed.path);
    if (error) {
      throw new Error(error);
    }
  }

  /** Which of these maps the FAF vault has; the others cannot be downloaded by other players. */
  async vaultCheck(folderNames: string[]): Promise<MapVaultCheck> {
    const wanted = folderNames.filter((name) => !OFFICIAL_MAP_NAMES.has(name.toLowerCase()) && !isGeneratedMap(name));
    const batches: string[][] = [];
    for (let start = 0; start < wanted.length; start += VAULT_NAME_BATCH_SIZE) {
      batches.push(wanted.slice(start, start + VAULT_NAME_BATCH_SIZE));
    }
    const found = new Set<string>();
    await mapLimited(batches, VAULT_CHECK_CONCURRENCY, async (batch) => {
      const document = resolveDocument(
        await this.api.get('/data/mapVersion', {
          filter: rsqlOr(batch.map((name) => rsqlEquals('folderName', name))),
          'fields[mapVersion]': 'folderName',
          'page[size]': String(batch.length),
        }),
      );
      for (const version of document.items) {
        const name = asString(version.folderName);
        if (name) {
          found.add(name.toLowerCase());
        }
      }
    });
    return {
      inVault: wanted.filter((name) => found.has(name.toLowerCase())),
      notInVault: wanted.filter((name) => !found.has(name.toLowerCase())),
    };
  }

  private async runInstall(versionId: number): Promise<void> {
    const document = resolveDocument(await this.api.get(`/data/mapVersion/${versionId}`));
    const version = document.items[0];
    const folderName = asString(version?.folderName);
    const downloadUrl = asString(version?.downloadUrl);
    if (!folderName || !isSafeFolderName(folderName) || !downloadUrl || !isFafHttpsUrl(downloadUrl)) {
      throw new Error(t('main.api.invalidMapData'));
    }
    await this.withFolder(folderName, async () => {
      if (!(await this.findCustomMap(folderName))) {
        await this.downloadAndInstall(folderName, downloadUrl);
      }
    });
  }

  private downloadAndInstall(folderName: string, downloadUrl: string): Promise<void> {
    return this.tasks.run(
      t('main.vault.maps.installTask', { name: folderName }),
      async (task) => {
        const download = await downloadToTempFile(
          downloadUrl,
          this.userAgent,
          (received, total) => {
            const fraction = progressFraction(received, total);
            task.progress(fraction === null ? null : fraction * 0.8);
          },
          { signal: task.signal },
        );
        try {
          task.signal.throwIfAborted();
          await installArchive(download.path, this.settings.mapsDirectory, (fraction) => task.progress(0.8 + fraction * 0.2));
          const manifest = manifestFromEntries(await readZipEntries(download.path), isScenarioFile);
          if (manifest) {
            await this.manifests.put('map', folderName, manifest);
          }
        } finally {
          await download.cleanup();
        }
      },
      { cancellable: true },
    );
  }

  /**
   * Makes sure the files of a game's map are exactly the ones the FAF vault published, reinstalling the map otherwise.
   * Maps of the game installation are left alone. Also returns the digest of the map's files, which TFAF players
   * compare, and what the user should know, if anything.
   */
  async verify(folderName: string): Promise<MapVerification> {
    if (OFFICIAL_MAP_NAMES.has(folderName.toLowerCase())) {
      const gamePath = this.settings.get().gamePath;
      const digest = gamePath ? await folderDigest(path.join(gamePath, 'maps', folderName)) : null;
      return { state: 'official', digest, note: null };
    }
    const directory = await this.findCustomMap(folderName);
    if (!directory) {
      const gameDirectory = await this.findGameMap(folderName);
      return gameDirectory
        ? { state: 'official', digest: await folderDigest(gameDirectory), note: null }
        : { state: 'unchecked', digest: null, note: null };
    }
    // The generator makes the same files from the same name on every computer; the vault has no copy.
    if (isGeneratedMap(folderName) || isStoneMapFolder(folderName)) {
      return { state: 'notInVault', digest: await folderDigest(directory), note: null };
    }
    const url = this.vaultArchiveUrl(folderName);
    let manifest: Manifest | null;
    try {
      manifest = await this.vaultManifest(folderName, url);
    } catch (error) {
      console.warn(`Map ${folderName} could not be checked: ${describeError(error)}`);
      return {
        state: 'unchecked',
        digest: await folderDigest(directory),
        note: { style: 'warning', text: t('main.vault.maps.checkFailed', { name: folderName, error: describeError(error) }) },
      };
    }
    if (!manifest) {
      console.warn(`Map ${folderName} is not in the FAF vault, its files were not checked`);
      return { state: 'notInVault', digest: await folderDigest(directory), note: null };
    }
    const startedAt = Date.now();
    const problems = await checkFolder(directory, manifest, { allowExtra: true });
    if (problems.length === 0) {
      console.info(`Map ${folderName} matches the vault (${manifest.files.length} files, ${Date.now() - startedAt} ms)`);
      return { state: 'matches', digest: filesDigest(manifest.files), note: null };
    }
    console.warn(`Map ${folderName} differs from the vault: ${describeProblems(problems)}; reinstalling`);
    await this.withFolder(folderName, () => this.downloadAndInstall(folderName, url));
    return {
      state: 'repaired',
      digest: filesDigest(manifest.files),
      note: {
        style: 'info',
        text: t('main.vault.maps.repaired', { name: folderName, problems: describeProblems(problems) }),
      },
    };
  }

  /** The folder of the map's latest vault version when it is newer; official and generated maps have none. */
  async newerVersion(folderName: string): Promise<string | null> {
    if (OFFICIAL_MAP_NAMES.has(folderName.toLowerCase()) || isGeneratedMap(folderName) || isStoneMapFolder(folderName)) {
      return null;
    }
    const document = resolveDocument(
      await this.api.get('/data/mapVersion', { filter: rsqlEquals('folderName', folderName), include: 'map.latestVersion' }),
    );
    const newer = newerVersions(document.items, 'map', 'folderName').get(folderName.toLowerCase()) ?? null;
    return newer && isSafeFolderName(newer) ? newer : null;
  }

  /**
   * Small and large preview of a map: the generator's picture when the maps folder has one, otherwise the content
   * server's; a generated map without the picture has none.
   */
  previewUrls(folderName: string): { small: string; large: string } | null {
    const local = existingLocalPreviewUrl(this.settings.mapsDirectory, folderName);
    if (local) {
      return { small: local, large: local };
    }
    if (isGeneratedMap(folderName) || isStoneMapFolder(folderName)) {
      return null;
    }
    const previews = `${this.auth.getServer().contentBaseUrl}/maps/previews`;
    const previewName = `${encodeURIComponent(folderName.toLowerCase())}.png`;
    return { small: `${previews}/small/${previewName}`, large: `${previews}/large/${previewName}` };
  }

  /** Recorded when TFAF installed the map, otherwise read once from the archive on the content server. */
  private async vaultManifest(folderName: string, url: string): Promise<Manifest | null> {
    const stored = await this.manifests.get('map', folderName);
    if (stored) {
      return stored;
    }
    const entries = await retrying(() => fetchRemoteEntries(url, this.userAgent));
    const manifest = entries && manifestFromEntries(entries, isScenarioFile);
    if (manifest) {
      await this.manifests.put('map', folderName, manifest);
    }
    return manifest;
  }

  private vaultArchiveUrl(folderName: string): string {
    return `${this.auth.getServer().contentBaseUrl}/maps/${encodeURIComponent(folderName.toLowerCase())}.zip`;
  }

  private async runEnsureInstalled(folderName: string): Promise<void> {
    if (!isSafeFolderName(folderName)) {
      throw new Error(t('main.vault.maps.invalidName', { name: folderName }));
    }
    if (
      OFFICIAL_MAP_NAMES.has(folderName.toLowerCase()) ||
      (await this.findCustomMap(folderName)) ||
      (await this.findGameMap(folderName))
    ) {
      return;
    }
    if (isGeneratedMap(folderName)) {
      await this.generator.generate(folderName);
      return;
    }
    // The vault has no StoneMap maps; a TFAF room sends how to make one.
    if (isStoneMapFolder(folderName)) {
      await this.stoneMap.installMap(folderName);
      return;
    }
    await this.downloadAndInstall(folderName, this.vaultArchiveUrl(folderName));
  }

  private findCustomMap(folderName: string): Promise<string | null> {
    if (!isSafeFolderName(folderName)) {
      return Promise.resolve(null);
    }
    return findChildCaseInsensitive(this.settings.mapsDirectory, folderName);
  }

  /**
   * A map someone put into the game installation besides the official ones: the game loads it like them, and the vault
   * may not have it, so it is used as it is rather than downloaded.
   */
  private findGameMap(folderName: string): Promise<string | null> {
    const gamePath = this.settings.get().gamePath;
    if (!gamePath || !isSafeFolderName(folderName)) {
      return Promise.resolve(null);
    }
    return findChildCaseInsensitive(path.join(gamePath, 'maps'), folderName);
  }

  private async scan(): Promise<InstalledMap[]> {
    const mapsDirectory = this.settings.mapsDirectory;
    const candidates = (await listDirectories(mapsDirectory))
      .filter((name) => !name.startsWith('.') && name.toLowerCase() !== 'debug')
      .map((name) => ({ directory: path.join(mapsDirectory, name), official: false }));

    const gamePath = this.settings.get().gamePath;
    if (gamePath && isValidGamePath(gamePath)) {
      candidates.push(...OFFICIAL_MAPS.map((name) => ({ directory: path.join(gamePath, 'maps', name), official: true })));
    }

    const seenScenarios = new Set<string>();
    const maps = await mapLimited(candidates, SCAN_CONCURRENCY, ({ directory, official }) =>
      this.readMap(directory, official, seenScenarios),
    );
    this.scenarios.retain(seenScenarios);
    const byFolder = new Map<string, InstalledMap>();
    for (const map of maps) {
      if (map && !byFolder.has(map.info.folderName.toLowerCase())) {
        byFolder.set(map.info.folderName.toLowerCase(), map);
      }
    }
    return [...byFolder.values()];
  }

  private async readMap(directory: string, official: boolean, seenScenarios: Set<string>): Promise<InstalledMap | null> {
    try {
      const [files, folder] = await Promise.all([readdir(directory), stat(directory)]);
      const scenarioName = files.find((file) => file.toLowerCase().endsWith('_scenario.lua'));
      if (!scenarioName) {
        return null;
      }
      const scenarioFile = path.join(directory, scenarioName);
      seenScenarios.add(scenarioFile);
      const scenario = await this.scenarios.get(scenarioFile, async () => readScenario(await readTextFile(scenarioFile)));
      const folderName = path.basename(directory);
      const previews = `${this.auth.getServer().contentBaseUrl}/maps/previews`;
      const previewName = `${encodeURIComponent(folderName.toLowerCase())}.png`;
      const localPreview = localPreviewFileName(folderName).toLowerCase();
      const local = !official && files.some((file) => file.toLowerCase() === localPreview) ? localPreviewUrl(folderName) : null;
      // Some file systems do not keep the creation time and report 0; the last change of the folder is the next best.
      const addedMs = folder.birthtimeMs > 0 ? folder.birthtimeMs : folder.mtimeMs;
      return {
        path: directory,
        info: {
          folderName,
          displayName: scenario.name,
          description: scenario.description,
          version: scenario.version,
          maxPlayers: scenario.maxPlayers,
          widthPx: scenario.widthPx,
          heightPx: scenario.heightPx,
          official,
          addedAt: addedMs > 0 ? new Date(addedMs).toISOString() : null,
          previewUrl: local ?? `${previews}/small/${previewName}`,
          previewLargeUrl: local ?? `${previews}/large/${previewName}`,
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`Map could not be read: ${directory}: ${describeError(error)}`);
      }
      return null;
    }
  }
}
