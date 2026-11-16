import { shell } from 'electron';
import { mkdir, open, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  LIVE_REPLAY_DELAY_SECONDS,
  type LiveGame,
  type LocalReplay,
  type Page,
  type ReplayDetails,
  type ReplayQuery,
  type VaultReplay,
} from '../../shared/contract.ts';
import type { AuthService } from '../auth/authService.ts';
import type { FafApi } from '../api/fafApi.ts';
import { asObject, type Resource, resolveDocument } from '../api/jsonApi.ts';
import { mapLimited } from '../concurrency.ts';
import { describeError } from '../errors.ts';
import type { FeaturedModCatalog } from '../game/featuredMods.ts';
import type { GameRunner } from '../game/gameRunner.ts';
import type { ReplayLaunch } from '../game/gameRunnerTypes.ts';
import { findOfficialClientData } from '../game/officialClient.ts';
import { fetchReplayAccessUrl } from '../game/replayRelay.ts';
import { t } from '../i18n.ts';
import { isLiveGame } from '../lobby/lobbyProtocol.ts';
import type { LobbyService } from '../lobby/lobbyService.ts';
import { HttpStatusError } from '../net/http.ts';
import type { SettingsStore } from '../settings.ts';
import type { TaskReporter } from '../tasks.ts';
import { downloadToTempFile, progressFraction } from '../vault/download.ts';
import { isSafeFolderName, pathExists } from '../vault/fsUtil.ts';
import { existingLocalPreviewUrl } from '../vault/mapPreviews.ts';
import { ParsedFileCache } from '../vault/parsedFileCache.ts';
import { LiveReplaySource } from './liveReplay.ts';
import { readReplayDetails } from './replayBody.ts';
import { parseMetadataLine, parseReplayFile, parseScfaHeader, type ReplayMetadata } from './replayFile.ts';
import { GAME_INCLUDES, replayListParams, toVaultReplay } from './vaultReplays.ts';

const VAULT_CACHE_MS = 60_000;
const SCAN_CONCURRENCY = 16;
// The metadata line of a replay is a few kilobytes; a much longer one means the file is not a replay.
const METADATA_READ_BYTES = 64 * 1024;
const MAX_SIM_MODS = 64;
const MAX_UID_LENGTH = 256;
const REPLAY_FILE = /\.fafreplay$/i;
const STREAM_FILE_NAME = 'replay.scfareplay';

function isoFromUnix(seconds: number | null): string | null {
  return seconds !== null && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

/** `x.faf.scfareplay` → `faf`; a bare game recording names its featured mod only this way (FileOpeningHandler). */
function featuredModFromFileName(file: string): string | null {
  const parts = path.basename(file).split('.');
  return parts.length >= 3 ? (parts[parts.length - 2] ?? null) : null;
}

async function readMetadata(file: string): Promise<ReplayMetadata> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(METADATA_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return parseMetadataLine(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

interface ReplayDirectory {
  directory: string;
  official: boolean;
}

/** The replays tab: the FAF replay vault, replay files on this computer and games that can be watched live. */
export class ReplayService {
  private readonly api: FafApi;
  private readonly auth: AuthService;
  private readonly settings: SettingsStore;
  private readonly featuredMods: FeaturedModCatalog;
  private readonly lobby: LobbyService;
  private readonly games: GameRunner;
  private readonly tasks: TaskReporter;
  private readonly userAgent: string;
  private readonly metadata = new ParsedFileCache<ReplayMetadata>();
  private lastDownload: { url: string; data: Buffer } | null = null;

  constructor(
    api: FafApi,
    auth: AuthService,
    settings: SettingsStore,
    featuredMods: FeaturedModCatalog,
    lobby: LobbyService,
    games: GameRunner,
    tasks: TaskReporter,
    userAgent: string,
  ) {
    this.api = api;
    this.auth = auth;
    this.settings = settings;
    this.featuredMods = featuredMods;
    this.lobby = lobby;
    this.games = games;
    this.tasks = tasks;
    this.userAgent = userAgent;
  }

  async query(query: ReplayQuery): Promise<Page<VaultReplay>> {
    const params: Record<string, string> = {
      ...replayListParams(query, this.auth.getUser()?.id ?? null),
      'page[size]': String(query.pageSize),
      'page[number]': String(query.page),
      'page[totals]': '',
    };
    // A game looked up by its number may have no reviews, so it is never searched among the review summaries.
    if (query.sort === 'highestRated' && query.gameId === undefined) {
      // The rated list comes from the review summaries, each with its game (as in the official client).
      params.include = GAME_INCLUDES.map((include) => `game.${include}`).join(',');
      const document = resolveDocument(await this.api.getCached('/data/gameReviewsSummary', params, VAULT_CACHE_MS));
      return {
        items: document.items
          .map((summary) => asObject(summary.game))
          .map((game) => (game ? toVaultReplay(game as Resource) : null))
          .filter((replay) => replay !== null),
        page: query.page,
        totalPages: document.totalPages ?? query.page,
      totalItems: document.totalRecords,
      };
    }
    params.include = GAME_INCLUDES.join(',');
    const document = resolveDocument(await this.api.getCached('/data/game', params, VAULT_CACHE_MS));
    return {
      items: document.items.map(toVaultReplay).filter((replay) => replay !== null),
      page: query.page,
      totalPages: document.totalPages ?? query.page,
      totalItems: document.totalRecords,
    };
  }

  async local(): Promise<LocalReplay[]> {
    const [directories, modNames] = await Promise.all([
      this.directories(),
      this.featuredMods.displayNames().catch(() => new Map<string, string>()),
    ]);
    const files = (
      await Promise.all(
        directories.map(async ({ directory, official }) => {
          const names = await readdir(directory).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              console.warn(`Replay folder ${directory} could not be read: ${describeError(error)}`);
            }
            return [];
          });
          return names.filter((name) => REPLAY_FILE.test(name)).map((name) => ({ file: path.join(directory, name), official }));
        }),
      )
    ).flat();
    this.metadata.retain(new Set(files.map(({ file }) => file)));

    const contentBaseUrl = this.auth.getServer().contentBaseUrl;
    const replays = await mapLimited(files, SCAN_CONCURRENCY, async ({ file, official }): Promise<LocalReplay | null> => {
      let metadata: ReplayMetadata;
      try {
        metadata = await this.metadata.get(file, () => readMetadata(file));
      } catch (error) {
        console.warn(`Replay ${file} could not be read: ${describeError(error)}`);
        return null;
      }
      const mapFolderName = metadata.mapName;
      const generated = mapFolderName?.toLowerCase().startsWith('neroxis_map_generator') ?? false;
      const previewName = mapFolderName && !generated ? `${encodeURIComponent(mapFolderName.toLowerCase())}.png` : null;
      const localPreview = mapFolderName && generated ? existingLocalPreviewUrl(this.settings.mapsDirectory, mapFolderName) : null;
      return {
        file,
        official,
        id: metadata.uid,
        title: metadata.title ?? path.basename(file),
        mapFolderName,
        mapPreviewUrl: localPreview ?? (previewName && `${contentBaseUrl}/maps/previews/small/${previewName}`),
        mapPreviewLargeUrl: localPreview ?? (previewName && `${contentBaseUrl}/maps/previews/large/${previewName}`),
        featuredModName: metadata.featuredMod ? (modNames.get(metadata.featuredMod) ?? metadata.featuredMod) : null,
        startedAt: isoFromUnix(metadata.launchedAt),
        endedAt: isoFromUnix(metadata.gameEnd),
        teams: metadata.teams,
      };
    });
    return replays
      .filter((replay) => replay !== null)
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  }

  live(): LiveGame[] {
    return this.lobby.getLiveGames();
  }

  async watch(replayId: number): Promise<void> {
    await this.games.watchReplay(t('main.replays.replayTitle', { id: replayId }), async () =>
      this.toLaunch(await this.download(replayId), replayId, null),
    );
  }

  async details(replayId: number): Promise<ReplayDetails> {
    return readReplayDetails(parseReplayFile(await this.download(replayId)).stream);
  }

  async fileDetails(file: string): Promise<ReplayDetails> {
    return readReplayDetails(parseReplayFile(await readFile(await this.resolveListed(file, false))).stream);
  }

  link(replayId: number): string {
    return `${this.auth.getServer().replayBaseUrl}/${replayId}`;
  }

  async watchFile(file: string): Promise<void> {
    await this.watchPath(await this.resolveListed(file, false));
  }

  /** Any file the user picked in the open dialog, which may also be a bare `.scfareplay`. */
  async watchPath(file: string): Promise<void> {
    await this.games.watchReplay(
      path.basename(file),
      async () => this.toLaunch(await readFile(file), null, file),
      t('main.replays.stages.readFile'),
    );
  }

  async watchLive(gameId: number): Promise<void> {
    const game = this.lobby.getRawGame(gameId);
    if (!game || !isLiveGame(game)) {
      throw new Error(t('main.replays.live.gameEnded'));
    }
    const login = this.auth.getUser()?.login;
    if (!login) {
      throw new Error(t('main.auth.signInRequired'));
    }
    const launchedAt = game.launchedAt ? Date.parse(game.launchedAt) : Number.NaN;
    const wait = launchedAt + LIVE_REPLAY_DELAY_SECONDS * 1000 - Date.now();
    if (wait > 0) {
      throw new Error(t('main.replays.live.delayed', { minutes: Math.ceil(wait / 60_000) }));
    }
    await this.games.watchReplay(game.title, async (signal) => {
      const stream = await LiveReplaySource.open(() => fetchReplayAccessUrl(this.api), gameId, login, { signal });
      return {
        source: `gpgnet://127.0.0.1:${stream.port}/${gameId}/${login}.scfareplay`,
        replayId: gameId,
        featuredMod: game.featuredMod,
        versions: null,
        simModUids: game.simMods.map((mod) => mod.uid),
        mapFolderName: game.mapFolderName || null,
        cleanup: () => stream.stop(),
      };
    }, t('main.replays.stages.connectLive'));
  }

  async reveal(file: string): Promise<void> {
    shell.showItemInFolder(await this.resolveListed(file, false));
  }

  async delete(file: string): Promise<void> {
    await rm(await this.resolveListed(file, true));
  }

  private async directories(): Promise<ReplayDirectory[]> {
    const own = this.settings.replaysDirectory;
    const official = await findOfficialClientData();
    const officialDirectory = official ? path.join(official.baseDirectory, 'replays') : null;
    return officialDirectory && !samePath(officialDirectory, own)
      ? [
          { directory: own, official: false },
          { directory: officialDirectory, official: true },
        ]
      : [{ directory: own, official: false }];
  }

  /** The renderer may only name files of the replay folders. */
  private async resolveListed(file: string, ownOnly: boolean): Promise<string> {
    const resolved = path.resolve(file);
    const directories = await this.directories();
    const listed =
      REPLAY_FILE.test(resolved) &&
      directories.some(({ directory, official }) => (!ownOnly || !official) && samePath(path.dirname(resolved), directory));
    if (!listed) {
      throw new Error(ownOnly ? t('main.replays.deleteOwnOnly') : t('main.replays.notInReplayFolder'));
    }
    if (!(await pathExists(resolved))) {
      throw new Error(t('main.replays.fileNotFound'));
    }
    return resolved;
  }

  /** The replay last downloaded is kept, so watching it after reading its details does not download it again. */
  private async download(replayId: number): Promise<Buffer> {
    const url = this.link(replayId);
    if (this.lastDownload?.url === url) {
      return this.lastDownload.data;
    }
    const data = await this.downloadFile(url, replayId);
    this.lastDownload = { url, data };
    return data;
  }

  private downloadFile(url: string, replayId: number): Promise<Buffer> {
    return this.tasks.run(
      t('main.replays.replayTitle', { id: replayId }),
      async (task) => {
        let download;
        try {
          download = await downloadToTempFile(
            url,
            this.userAgent,
            (received, total) => task.progress(progressFraction(received, total)),
            { signal: task.signal },
          );
        } catch (error) {
          if (error instanceof HttpStatusError && error.status === 404) {
            throw new Error(t('main.replays.notYetAvailable'), { cause: error });
          }
          throw error;
        }
        try {
          return await readFile(download.path);
        } finally {
          await download.cleanup();
        }
      },
      { cancellable: true },
    );
  }

  /** Unpacks the stream for the game and works out the files, map and mods it needs. */
  private async toLaunch(data: Buffer, replayId: number | null, fileName: string | null): Promise<ReplayLaunch> {
    const { metadata, stream } = parseReplayFile(data);
    const header = parseScfaHeader(stream);
    const featuredMod = metadata?.featuredMod ?? (fileName ? featuredModFromFileName(fileName) : null) ?? 'faf';
    const modVersion = metadata && metadata.featuredModVersions.length > 0 ? Math.max(...metadata.featuredModVersions) : null;
    const simModUids = (header.simModUids.length > 0 ? header.simModUids : (metadata?.simMods.map((mod) => mod.uid) ?? []))
      .filter((uid) => uid.length <= MAX_UID_LENGTH)
      .slice(0, MAX_SIM_MODS);
    const mapFolderName = header.mapFolderName ?? metadata?.mapName ?? null;
    if (mapFolderName !== null && !isSafeFolderName(mapFolderName)) {
      throw new Error(t('main.replays.invalidMapName', { name: mapFolderName }));
    }

    const directory = this.settings.cacheDirectory;
    await mkdir(directory, { recursive: true });
    const source = path.join(directory, STREAM_FILE_NAME);
    await writeFile(source, stream);
    console.info(
      `Replay ${String(metadata?.uid ?? replayId ?? fileName)}: ${featuredMod} ${header.gameVersion ?? 'latest'}, map ${String(mapFolderName)}, ` +
        `${simModUids.length} sim mods`,
    );
    const watchedId = metadata?.uid ?? replayId;
    if (watchedId !== null) {
      this.settings
        .addWatchedReplay(watchedId)
        .catch((error: unknown) => console.warn(`Watched replay ${watchedId} could not be saved: ${describeError(error)}`));
    }
    return {
      title: metadata?.title ?? undefined,
      source,
      replayId: metadata?.uid ?? replayId,
      featuredMod,
      versions: header.gameVersion === null ? null : { game: header.gameVersion, mod: modVersion },
      simModUids,
      mapFolderName,
    };
  }
}
