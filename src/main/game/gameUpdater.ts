import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, link, mkdir, open, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { GameFilesCheck } from '../../shared/contract.ts';
import { INTL_LOCALES, type Locale } from '../../shared/i18n/index.ts';
import type { AuthService } from '../auth/authService.ts';
import type { FafApi } from '../api/fafApi.ts';
import { mapLimited } from '../concurrency.ts';
import { isValidGamePath } from '../gameLocator.ts';
import { currentLocale, t } from '../i18n.ts';
import { fetchWithTimeout } from '../net/http.ts';
import { isFafHttpsUrl } from '../servers.ts';
import { isAsciiPath, type SettingsStore } from '../settings.ts';
import type { TaskHandle, TaskReporter } from '../tasks.ts';
import { downloadToTempFile } from '../vault/download.ts';
import { isSafeFolderName, pathExists } from '../vault/fsUtil.ts';
import type { ZipEntry } from '../vault/zip.ts';
import { patchExeVersion, readExeVersion } from './exePatcher.ts';
import { type FeaturedModCatalog, type FeaturedModFile, fetchFeaturedModFiles } from './featuredMods.ts';
import { FileHashCache } from './fileHashCache.ts';
import { digestLines } from './fingerprint.ts';
import { readMediaEntries, staleMediaEntries, unpackMedia } from './gameMedia.ts';
import { INIT_FILE_NAME } from './launchCommand.ts';
import { findOfficialClientData, type OfficialClientData, officialFileCandidates } from './officialClient.ts';

// Mods other than these run on top of FAF, so FAF itself is updated first (GameUpdaterImpl of the official client).
const BASE_FEATURED_MODS = new Set(['faf', 'fafbeta', 'fafdevelop']);

// Files of the original installation that the FAF executable needs next to it (GameBinariesUpdateTaskImpl).
const BINARIES_TO_COPY = [
  'BsSndRpt.exe',
  'BugSplat.dll',
  'BugSplatRc.dll',
  'DbgHelp.dll',
  'GDFBinary.dll',
  'Microsoft.VC80.CRT.manifest',
  'SHSMP.DLL',
  'msvcm80.dll',
  'msvcp80.dll',
  'msvcr80.dll',
  'sx32w.dll',
  'wxmsw24u-vs80.dll',
  'zlibwapi.dll',
];

export const FORGED_ALLIANCE_EXE = 'ForgedAlliance.exe';

const HASH_CACHE_FILE = '.tfaf-file-hashes.json';
const REPLAY_DATA_FOLDER = 'replaydata';
const FREE_SPACE_MARGIN_BYTES = 256 * 1024 * 1024;
const SIZE_PROBE_CONCURRENCY = 4;
const SIZE_PROBE_TIMEOUT_MS = 10_000;
const PLAN_CONCURRENCY = 8;
const VERIFY_CONCURRENCY = 2;

type FileAction =
  | { kind: 'current'; file: FeaturedModFile; target: string }
  /** `link`: the source is a file of the main game folder, shared with a hard link instead of a copy. */
  | { kind: 'copy'; file: FeaturedModFile; target: string; source: string; size: number; link: boolean }
  | { kind: 'download'; file: FeaturedModFile; target: string; size: number | null };

interface PatchResult {
  version: number;
  initFile: string;
  checked: number;
  /** `group/name` of the files that had to be downloaded or copied again. */
  updated: string[];
  /** Lower-case names of the files FAF itself puts into bin; those are never replaced with the game's originals. */
  binaries: Set<string>;
  /** `group/name:md5` of every file, the input of the game files fingerprint. */
  fileLines: string[];
}

export interface UpdateReport extends GameFilesCheck {
  /** Version of the featured mod files, the game version for FAF itself. */
  version: number;
  /** Fingerprint of the files, the same on every computer with the same files. */
  digest: string;
}

const megabyteFormats = new Map<Locale, Intl.NumberFormat>();

function formatMegabytes(bytes: number): string {
  const locale = currentLocale();
  let format = megabyteFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(INTL_LOCALES[locale], { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    megabyteFormats.set(locale, format);
  }
  return format.format(bytes / (1024 * 1024));
}

function luaString(value: string): string {
  return `"${value.replace(/\\/g, '/').replace(/"/g, '\\"')}"`;
}

/** Average speed over the last few seconds of a transfer. */
class SpeedMeter {
  private readonly samples: { time: number; bytes: number }[] = [];

  add(totalBytes: number): number {
    const now = Date.now();
    this.samples.push({ time: now, bytes: totalBytes });
    while (this.samples.length > 2 && now - this.samples[0]!.time > 3000) {
      this.samples.shift();
    }
    const first = this.samples[0]!;
    const seconds = (now - first.time) / 1000;
    return seconds > 0 ? (totalBytes - first.bytes) / seconds : 0;
  }
}

/** A file that is about to be replaced must not be held open, which happens while Forged Alliance runs from it. */
async function assertReplaceable(file: string): Promise<void> {
  try {
    const handle = await open(file, 'r+');
    await handle.close();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      throw new Error(t('main.game.files.busy', { file: path.basename(file) }), { cause: error });
    }
    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Replay files share the data of identical files in the main game folder. That is safe because the updater never edits
 * a game file in place: it writes a new file and renames it over the old one, which leaves the other link untouched.
 */
async function linkFile(source: string, target: string): Promise<boolean> {
  const temp = `${target}.tfaf-tmp`;
  try {
    await rm(temp, { force: true });
    await link(source, temp);
  } catch {
    return false;
  }
  await rm(target, { force: true });
  await rename(temp, target);
  return true;
}

async function copyWithProgress(source: string, target: string, onBytes: (bytes: number) => void): Promise<void> {
  let copied = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      copied += chunk.length;
      onBytes(copied);
      callback(null, chunk);
    },
  });
  const temp = `${target}.tfaf-tmp`;
  await pipeline(createReadStream(source), counter, createWriteStream(temp));
  await rm(target, { force: true });
  await rename(temp, target);
}

/** The version a replay was recorded with: FAF itself and, for mods built on top of it, the mod. */
export interface ReplayVersions {
  game: number;
  mod: number | null;
}

export interface UpdateOptions {
  /** Hashes every file instead of trusting the hash cache. */
  verify?: boolean;
  /** Pins the files to a replay's version; they go to their own folder, so the main one stays current. */
  replay?: ReplayVersions;
}

/**
 * Brings the FAF game files in the data folder to the latest version of a featured mod, or to the version of a replay
 * in `replaydata` (GameUpdaterImpl). Files that the official client already has are copied from its folder instead
 * of being downloaded again.
 */
export class GameUpdater {
  private readonly api: FafApi;
  private readonly featuredMods: FeaturedModCatalog;
  private readonly auth: AuthService;
  private readonly settings: SettingsStore;
  private readonly tasks: TaskReporter;
  private readonly userAgent: string;
  private readonly clientVersion: string;
  private readonly inFlight = new Map<string, Promise<UpdateReport>>();
  /** Voice-over and video entries of each archive by MD5, so an archive's directory is read once per session. */
  private readonly mediaEntries = new Map<string, ZipEntry[]>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    api: FafApi,
    featuredMods: FeaturedModCatalog,
    auth: AuthService,
    settings: SettingsStore,
    tasks: TaskReporter,
    userAgent: string,
    clientVersion: string,
  ) {
    this.api = api;
    this.featuredMods = featuredMods;
    this.auth = auth;
    this.settings = settings;
    this.tasks = tasks;
    this.userAgent = userAgent;
    this.clientVersion = clientVersion;
  }

  get binDirectory(): string {
    return path.join(this.settings.get().dataPath, 'bin');
  }

  get replayBinDirectory(): string {
    return path.join(this.replayRoot, 'bin');
  }

  private get replayRoot(): string {
    return path.join(this.settings.get().dataPath, REPLAY_DATA_FOLDER);
  }

  /**
   * Updates run one after another; asking for an update that is already running joins it. `verify` hashes every file
   * instead of trusting the hash cache, which also catches a file damaged on disk. The official client does that before
   * each game; here the first background update after the launcher starts does it, and games rely on the cache.
   */
  update(featuredMod: string, { verify = false, replay }: UpdateOptions = {}): Promise<UpdateReport> {
    const key = `${featuredMod}:${verify ? 'verify' : 'quick'}:${replay ? `${replay.game}/${String(replay.mod)}` : 'latest'}`;
    const running = this.inFlight.get(key);
    if (running) {
      return running;
    }
    const update = this.queue
      .then(() => this.runUpdate(featuredMod, verify, replay ?? null))
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, update);
    this.queue = update.then(
      () => undefined,
      () => undefined,
    );
    return update;
  }

  private async runUpdate(featuredMod: string, verify: boolean, replay: ReplayVersions | null): Promise<UpdateReport> {
    const settings = this.settings.get();
    if (!isValidGamePath(settings.gamePath)) {
      throw new Error(t('main.game.gamePathMissing'));
    }
    if (!isAsciiPath(settings.dataPath)) {
      throw new Error(t('main.game.files.nonAsciiDataPath'));
    }
    const startedAt = Date.now();
    const root = replay ? this.replayRoot : settings.dataPath;
    await mkdir(root, { recursive: true });
    await this.removeLeftovers(root);
    const [hashes, official] = await Promise.all([
      FileHashCache.load(path.join(settings.dataPath, HASH_CACHE_FILE)),
      findOfficialClientData(),
    ]);

    try {
      let title: string;
      if (replay) {
        title = t('main.game.files.replayTask', { mod: featuredMod, version: replay.game });
      } else if (verify) {
        title = t('main.game.files.verifyTask', { mod: featuredMod });
      } else {
        title = t('main.game.files.updateTask', { mod: featuredMod });
      }
      // A cancelled update leaves every file either old or new, never half written, and the next update finishes it.
      const report = await this.tasks.run(
        title,
        async (task): Promise<UpdateReport> => {
          const onTopOfFaf = !BASE_FEATURED_MODS.has(featuredMod);
          const baseName = onTopOfFaf ? 'faf' : featuredMod;
          const baseTarget = { root, version: replay?.game ?? null };
          const base = await this.updateFeaturedMod(baseName, baseTarget, task, 0, onTopOfFaf ? 0.5 : 1, hashes, official, verify);
          const binaries = await this.updateBinaries(root, base.version, base.binaries, hashes, verify, task.signal);
          const modTarget = { root, version: replay?.mod ?? null };
          const extra = onTopOfFaf
            ? await this.updateFeaturedMod(featuredMod, modTarget, task, 0.5, 1, hashes, official, verify)
            : null;
          const result = extra ?? base;
          await this.writeFaPath(root, featuredMod, result.version);
          await copyFile(result.initFile, path.join(root, 'bin', INIT_FILE_NAME));
          return {
            checked: base.checked + binaries.checked + (extra?.checked ?? 0),
            repaired: [...base.updated, ...binaries.updated, ...(extra?.updated ?? [])],
            version: result.version,
            digest: digestLines([...base.fileLines, ...(extra?.fileLines ?? [])]),
          };
        },
        { cancellable: true },
      );
      console.info(
        `Game files of ${featuredMod}${replay ? ` ${replay.game} for a replay` : ''} ready in ${Date.now() - startedAt} ms${verify ? ' (full MD5 check)' : ''}: ` +
          `${report.checked} checked, ${report.repaired.length} updated`,
      );
      return report;
    } finally {
      await hashes.save().catch((error: unknown) => console.warn('File hash cache could not be saved', error));
    }
  }

  /** Temporary files of an update that was interrupted, e.g. by closing the launcher mid-download. */
  private async removeLeftovers(dataPath: string): Promise<void> {
    for (const group of ['bin', 'gamedata']) {
      const directory = path.join(dataPath, group);
      const entries = await readdir(directory).catch(() => []);
      for (const entry of entries) {
        if (entry.startsWith('.tfaf-download-') || entry.endsWith('.tfaf-tmp')) {
          await rm(path.join(directory, entry), { recursive: true, force: true });
        }
      }
    }
  }

  /** `target.version` null means the latest files; the folder is the main one or the replay one. */
  private async updateFeaturedMod(
    name: string,
    target: { root: string; version: number | null },
    task: TaskHandle,
    from: number,
    to: number,
    hashes: FileHashCache,
    official: OfficialClientData | null,
    verify: boolean,
  ): Promise<PatchResult> {
    task.progress(null, t('main.game.files.listing', { name }));
    const files = await fetchFeaturedModFiles(this.api, await this.featuredMods.idOf(name), target.version);
    if (files.length === 0) {
      throw new Error(
        target.version === null
          ? t('main.game.files.noFiles', { name })
          : t('main.game.files.noFilesOfVersion', { name, version: target.version }),
      );
    }
    const dataPath = target.root;
    const mainPath = this.settings.get().dataPath;

    for (const file of files) {
      if (!isSafeFolderName(file.group) || !isSafeFolderName(file.name)) {
        throw new Error(t('main.game.files.invalidName', { file: `${file.group}/${file.name}` }));
      }
    }
    task.progress(null, t('main.game.files.checking', { name }));
    // Hashing reads whole files, so fewer at a time keeps a hard disk from seeking back and forth.
    const actions = await mapLimited(files, verify ? VERIFY_CONCURRENCY : PLAN_CONCURRENCY, (file) =>
      this.planFile(
        file,
        path.join(dataPath, file.group, file.name),
        dataPath === mainPath ? null : path.join(mainPath, file.group, file.name),
        hashes,
        official,
        verify,
      ),
    );

    task.signal.throwIfAborted();
    const pending = actions.filter((action) => action.kind !== 'current');
    console.info(`Game files of ${name}: ${files.length} checked, ${pending.length} to update`);
    if (pending.length > 0) {
      task.progress(null, t('main.game.files.preparingDownload'));
      await this.measureDownloads(pending);
      await this.assertFreeSpace(dataPath, pending);
      for (const action of pending) {
        await assertReplaceable(action.target);
      }
      await this.execute(pending, task, from, to, hashes);
    }
    // FAF itself ships no voice-overs, and opening each of its large archives, which an antivirus may scan on open,
    // would slow down every update; only the mods on top of it (coop, tutorials) carry them.
    if (!BASE_FEATURED_MODS.has(name)) {
      await this.unpackMedia(name, files, dataPath, new Set(pending.map((action) => action.target)), task, hashes);
    }

    const initName = `init_${name}.lua`.toLowerCase();
    const initFile = files.find((file) => file.group === 'bin' && file.name.toLowerCase() === initName);
    if (!initFile) {
      throw new Error(t('main.game.files.missingInit', { name, file: initName }));
    }
    return {
      version: Math.max(...files.map((file) => file.version)),
      initFile: path.join(dataPath, initFile.group, initFile.name),
      checked: files.length,
      updated: pending.map((action) => `${action.file.group}/${action.file.name}`),
      binaries: new Set(files.filter((file) => file.group === 'bin').map((file) => file.name.toLowerCase())),
      fileLines: files.map((file) => `${file.group}/${file.name}:${file.md5}`),
    };
  }

  /** `mainCopy`: the same file in the main game folder, when the target is the replay folder. */
  private async planFile(
    file: FeaturedModFile,
    target: string,
    mainCopy: string | null,
    hashes: FileHashCache,
    official: OfficialClientData | null,
    verify: boolean,
  ): Promise<FileAction> {
    if ((await hashes.md5(target, verify)) === file.md5) {
      return { kind: 'current', file, target };
    }
    if (mainCopy && (await hashes.md5(mainCopy, verify)) === file.md5) {
      return { kind: 'copy', file, target, source: mainCopy, size: (await stat(mainCopy)).size, link: true };
    }
    if (official) {
      for (const source of officialFileCandidates(official, file.group, file.name, file.md5)) {
        if ((await hashes.md5(source, verify)) === file.md5) {
          return { kind: 'copy', file, target, source, size: (await stat(source)).size, link: false };
        }
      }
    }
    return { kind: 'download', file, target, size: null };
  }

  /** Sizes of the files to download, for the free space check and byte progress. */
  private async measureDownloads(actions: FileAction[]): Promise<void> {
    const downloads = actions.filter((action) => action.kind === 'download');
    for (let i = 0; i < downloads.length; i += SIZE_PROBE_CONCURRENCY) {
      await Promise.all(
        downloads.slice(i, i + SIZE_PROBE_CONCURRENCY).map(async (action) => {
          try {
            const response = await fetchWithTimeout(
              action.file.url,
              { method: 'HEAD', headers: this.downloadHeaders(action.file) },
              SIZE_PROBE_TIMEOUT_MS,
            );
            const length = Number(response.headers.get('content-length'));
            action.size = response.ok && length > 0 ? length : null;
          } catch {
            action.size = null;
          }
        }),
      );
    }
  }

  private async assertFreeSpace(directory: string, actions: FileAction[]): Promise<void> {
    const needed = actions.reduce(
      (sum, action) => sum + (action.kind === 'current' || (action.kind === 'copy' && action.link) ? 0 : (action.size ?? 0)),
      0,
    );
    await this.assertFreeBytes(directory, needed);
  }

  private async assertFreeBytes(directory: string, needed: number): Promise<void> {
    const { bavail, bsize } = await statfs(directory);
    const available = bavail * bsize;
    if (available < needed + FREE_SPACE_MARGIN_BYTES) {
      throw new Error(
        t('main.game.files.noSpace', {
          directory,
          needed: formatMegabytes(needed + FREE_SPACE_MARGIN_BYTES),
          available: formatMegabytes(available),
        }),
      );
    }
  }

  private async execute(actions: FileAction[], task: TaskHandle, from: number, to: number, hashes: FileHashCache): Promise<void> {
    const totalBytes = actions.reduce((sum, action) => sum + (action.kind === 'current' ? 0 : (action.size ?? 0)), 0);
    const meter = new SpeedMeter();
    let doneBytes = 0;
    const report = (fileBytes: number, fileTotal: number | null, detail: string): void => {
      const fraction = totalBytes > 0 ? Math.min((doneBytes + fileBytes) / totalBytes, 1) : null;
      task.progress(fraction === null ? null : from + (to - from) * fraction, detail);
    };

    for (const action of actions) {
      if (action.kind === 'current') {
        continue;
      }
      task.signal.throwIfAborted();
      const name = action.file.name;
      await mkdir(path.dirname(action.target), { recursive: true });
      if (action.kind === 'copy') {
        if (!(action.link && (await linkFile(action.source, action.target)))) {
          const key = action.link ? 'main.game.files.copyFromMain' : 'main.game.files.copyFromOfficial';
          await copyWithProgress(action.source, action.target, (bytes) =>
            report(bytes, action.size, t(key, { name, done: formatMegabytes(bytes), total: formatMegabytes(action.size) })),
          );
        }
        doneBytes += action.size;
      } else {
        if (!isFafHttpsUrl(action.file.url)) {
          throw new Error(t('main.game.files.untrustedUrl', { url: action.file.url }));
        }
        let received = 0;
        const download = await downloadToTempFile(
          action.file.url,
          this.userAgent,
          (bytes, total) => {
            received = bytes;
            const speed = meter.add(doneBytes + bytes);
            const size = total ?? action.size;
            const progress = { name, done: formatMegabytes(bytes), speed: formatMegabytes(speed) };
            report(
              bytes,
              size,
              size
                ? t('main.game.files.downloadOf', { ...progress, total: formatMegabytes(size) })
                : t('main.game.files.download', progress),
            );
          },
          {
            headers: this.downloadHeaders(action.file),
            checksum: { algorithm: 'md5', digest: action.file.md5 },
            tempDirectory: path.dirname(action.target),
            signal: task.signal,
          },
        );
        try {
          await rm(action.target, { force: true });
          await rename(download.path, action.target);
        } finally {
          await download.cleanup();
        }
        doneBytes += action.size ?? received;
      }
      await hashes.remember(action.target, action.file.md5);
    }
  }

  /**
   * Voice-overs and videos inside the mod's archives (coop missions) go to movies/ and sounds/ next to bin. In the
   * replay folder they are hard links to the main folder's copies when the archive is the same.
   */
  private async unpackMedia(
    name: string,
    files: FeaturedModFile[],
    root: string,
    updated: Set<string>,
    task: TaskHandle,
    hashes: FileHashCache,
  ): Promise<void> {
    const mainRoot = this.settings.get().dataPath;
    let unpacked = 0;
    for (const file of files) {
      if (file.group === 'bin') {
        continue;
      }
      const archive = path.join(root, file.group, file.name);
      let entries = this.mediaEntries.get(file.md5);
      if (!entries) {
        entries = await readMediaEntries(archive);
        this.mediaEntries.set(file.md5, entries);
      }
      const stale = entries.length > 0 ? await staleMediaEntries(entries, root, updated.has(archive)) : [];
      if (stale.length === 0) {
        continue;
      }
      task.signal.throwIfAborted();
      const mainArchive = path.join(mainRoot, file.group, file.name);
      const linkFrom = root !== mainRoot && (await hashes.md5(mainArchive)) === file.md5 ? mainRoot : null;
      if (!linkFrom) {
        await this.assertFreeBytes(root, stale.reduce((sum, entry) => sum + entry.uncompressedSize, 0));
      }
      const detail = t('main.game.files.unpackingMedia', { name: file.name });
      task.progress(null, detail);
      await unpackMedia(archive, root, stale, {
        linkFrom,
        signal: task.signal,
        onProgress: (fraction) => task.progress(null, `${detail} · ${Math.floor(fraction * 100)}%`),
      });
      unpacked += stale.length;
    }
    if (unpacked > 0) {
      console.info(`Game files of ${name}: ${unpacked} voice-over and video files unpacked`);
    }
  }

  // FAF's CDN checks an HMAC sent as a request header (SimpleHttpFeaturedModUpdaterTask).
  private downloadHeaders(file: FeaturedModFile): Record<string, string> | undefined {
    return file.hmacParameter && file.hmacToken ? { [file.hmacParameter]: file.hmacToken } : undefined;
  }

  /**
   * Copies the libraries FAF expects from the game installation. With `verify` the copies are also compared with the
   * originals, except for the files FAF publishes itself (GDFBinary.dll), which take precedence.
   */
  private async updateBinaries(
    root: string,
    version: number,
    providedByFaf: Set<string>,
    hashes: FileHashCache,
    verify: boolean,
    signal: AbortSignal,
  ): Promise<{ checked: number; updated: string[] }> {
    const gamePath = this.settings.get().gamePath;
    if (!gamePath) {
      throw new Error(t('main.game.gamePathMissing'));
    }
    const binDirectory = path.join(root, 'bin');
    await mkdir(binDirectory, { recursive: true });

    const sourceDirectory = path.join(gamePath, 'bin');
    const available = new Set(await readdir(sourceDirectory));
    const own = BINARIES_TO_COPY.filter((name) => available.has(name) && !providedByFaf.has(name.toLowerCase()));
    const updated: string[] = [];
    for (const name of own) {
      const source = path.join(sourceDirectory, name);
      const destination = path.join(binDirectory, name);
      const missing = !(await pathExists(destination));
      if (missing || (verify && (await hashes.md5(source, true)) !== (await hashes.md5(destination, true)))) {
        // Copied under a temporary name first, so an interrupted copy never passes for a complete file next time.
        const temp = `${destination}.tfaf-tmp`;
        await copyFile(source, temp);
        await chmod(temp, 0o666);
        await rename(temp, destination);
        updated.push(`bin/${name}`);
      }
    }

    const exePath = path.join(binDirectory, FORGED_ALLIANCE_EXE);
    const mainExe = path.join(this.binDirectory, FORGED_ALLIANCE_EXE);
    if (exePath !== mainExe && !(await pathExists(exePath)) && (await pathExists(mainExe))) {
      // A copy, never a link: the version is patched into the executable in place.
      const temp = `${exePath}.tfaf-tmp`;
      await copyFile(mainExe, temp);
      await rename(temp, exePath);
    }
    if (!(await pathExists(exePath))) {
      const download = await downloadToTempFile(
        `${this.auth.getServer().contentBaseUrl}/faf/updaterNew/updates_faf_files/${FORGED_ALLIANCE_EXE}`,
        this.userAgent,
        () => {},
        { tempDirectory: binDirectory, signal },
      );
      try {
        await rename(download.path, exePath);
      } finally {
        await download.cleanup();
      }
    }
    if ((await readExeVersion(exePath)) !== version) {
      await assertReplaceable(exePath);
      await patchExeVersion(exePath, version);
    }
    return { checked: verify ? own.length : 0, updated };
  }

  /** `fa_path.lua` next to the bin folder tells init_*.lua where the game and the vault live. */
  private async writeFaPath(root: string, featuredMod: string, version: number): Promise<void> {
    const settings = this.settings.get();
    const content = [
      `fa_path = ${luaString(settings.gamePath ?? '')}`,
      `custom_vault_path = ${luaString(settings.vaultPath)}`,
      `GameType = ${luaString(featuredMod)}`,
      `GameVersion = ${luaString(String(version))}`,
      `ClientVersion = ${luaString(this.clientVersion)}`,
      'ForceAffinity = "true"',
      '',
    ].join('\n');
    await writeFile(path.join(root, 'fa_path.lua'), content, 'utf8');
  }
}
