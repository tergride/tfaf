import { shell } from 'electron';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LocalCheckState, LocalMod, ModCheck, ModCheckStatus, ModQuery, Page, VaultMod } from '../../shared/contract.ts';
import type { FafApi } from '../api/fafApi.ts';
import { asString, resolveDocument } from '../api/jsonApi.ts';
import { rsqlEquals, rsqlOr } from '../api/rsql.ts';
import { mapLimited } from '../concurrency.ts';
import { CancelledError, describeError } from '../errors.ts';
import { filesDigest, folderDigest } from '../game/fingerprint.ts';
import { isBuiltInMod, selectGameMods } from '../game/gameVault.ts';
import { t } from '../i18n.ts';
import { retrying } from '../net/http.ts';
import { isFafHttpsUrl } from '../servers.ts';
import type { SettingsStore } from '../settings.ts';
import type { TaskReporter } from '../tasks.ts';
import { toVaultMod } from './apiMappers.ts';
import { downloadToTempFile, progressFraction } from './download.ts';
import { listDirectories, pathExists, readTextFile } from './fsUtil.ts';
import { ensureOwnPrefs, readActiveMods, writeActiveMods } from './gamePrefs.ts';
import { installArchive } from './installer.ts';
import { newerVersions } from './latestVersions.ts';
import {
  checkFolder,
  describeProblems,
  fetchRemoteEntries,
  type IntegrityNote,
  type Manifest,
  manifestFromEntries,
  type ManifestStore,
} from './integrity.ts';
import { readModInfo } from './modInfoReader.ts';
import { ParsedFileCache } from './parsedFileCache.ts';
import { modListParams } from './vaultQueries.ts';
import { readZipEntries } from './zip.ts';

const MOD_INCLUDES = 'latestVersion,reviewsSummary,uploader';
const MOD_INFO_FILE = 'mod_info.lua';
const ICON_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const MAX_ICON_BYTES = 512 * 1024;
const SCAN_CONCURRENCY = 16;
// Switching back to a category or page shows the list at once; new uploads appear a minute later at most.
const VAULT_CACHE_MS = 60_000;
const MOD_DOWNLOAD_CONCURRENCY = 3;
// The uids travel in the query string; batches keep the URL short however many mods are installed.
const VAULT_UID_BATCH_SIZE = 50;

const isModInfoFile = (fileName: string): boolean => fileName === MOD_INFO_FILE;

export interface ModVerification {
  uid: string;
  name: string;
  state: LocalCheckState;
  /** Digest of the mod's files; null when they could not be read. */
  digest: string | null;
}

// A failed check stops the game before anyone needs its state.
const VERIFICATION_STATES: Record<ModCheckStatus, LocalCheckState> = {
  ok: 'matches',
  repaired: 'repaired',
  notInVault: 'notInVault',
  unchecked: 'unchecked',
  failed: 'unchecked',
};

interface InstalledMod {
  info: LocalMod;
  path: string;
}

interface VaultVersion {
  versionId: number;
  downloadUrl: string;
}

export class ModService {
  private readonly api: FafApi;
  private readonly settings: SettingsStore;
  private readonly tasks: TaskReporter;
  private readonly userAgent: string;
  private readonly manifests: ManifestStore;
  private readonly installs = new Map<string, Promise<void>>();
  private readonly modInfos = new ParsedFileCache<Omit<LocalMod, 'active'>>();

  constructor(api: FafApi, settings: SettingsStore, tasks: TaskReporter, userAgent: string, manifests: ManifestStore) {
    this.api = api;
    this.manifests = manifests;
    this.settings = settings;
    this.tasks = tasks;
    this.userAgent = userAgent;
  }

  async query(query: ModQuery): Promise<Page<VaultMod>> {
    const params: Record<string, string> = {
      ...modListParams(query),
      include: MOD_INCLUDES,
      'page[size]': String(query.pageSize),
      'page[number]': String(query.page),
      'page[totals]': '',
    };
    const document = resolveDocument(await this.api.getCached('/data/mod', params, VAULT_CACHE_MS));
    return {
      items: document.items.map(toVaultMod).filter((mod): mod is VaultMod => mod !== null),
      page: query.page,
      totalPages: document.totalPages ?? query.page,
      totalItems: document.totalRecords,
    };
  }

  async installed(): Promise<LocalMod[]> {
    return (await this.scan()).map((mod) => mod.info);
  }

  install(versionId: number): Promise<void> {
    const key = String(versionId);
    const running = this.installs.get(key);
    if (running) {
      return running;
    }
    const install = this.runInstall(versionId)
      .then(() => undefined)
      .finally(() => this.installs.delete(key));
    this.installs.set(key, install);
    return install;
  }

  async uninstall(uid: string): Promise<void> {
    const installed = await this.scan();
    const mod = installed.find((candidate) => candidate.info.uid === uid);
    if (!mod) {
      throw new Error(t('main.vault.mods.notFound'));
    }
    await rm(mod.path, { recursive: true, force: true });
    if (mod.info.active) {
      const remaining = installed.filter((candidate) => candidate.info.active && candidate.info.uid !== uid);
      await writeActiveMods(await this.prefsPath(), remaining.map((candidate) => candidate.info.uid));
    }
  }

  async reveal(uid: string): Promise<void> {
    const mod = (await this.scan()).find((candidate) => candidate.info.uid === uid);
    if (!mod) {
      throw new Error(t('main.vault.mods.notFound'));
    }
    const error = await shell.openPath(mod.path);
    if (error) {
      throw new Error(error);
    }
  }

  /** Replaces the set of active mods in Game.prefs; only installed mods can be activated. */
  async setActive(uids: string[]): Promise<void> {
    const installedUids = new Set((await this.scan()).map((mod) => mod.info.uid));
    const unknown = uids.find((uid) => !installedUids.has(uid));
    if (unknown !== undefined) {
      throw new Error(t('main.vault.mods.notInstalled', { uid: unknown }));
    }
    await writeActiveMods(await this.prefsPath(), uids);
  }

  /**
   * Downloads the mods of a game that are missing and activates them (ModService.downloadAndEnableMods of the official
   * client). Joining adds them to the mods that are already active; hosting with `replace` makes them the only ones.
   * Every mod_info.lua is read afresh here: which uids go into the game never depends on the scan cache.
   */
  async ensureInstalledAndActive(uids: string[], { replace = false }: { replace?: boolean } = {}): Promise<void> {
    if (uids.length === 0 && !replace) {
      return;
    }
    await this.ensureInstalled(uids);
    const installed = await this.scan(true);
    const known = new Set(installed.map((mod) => mod.info.uid));
    if (replace) {
      const unknown = uids.find((uid) => !known.has(uid));
      if (unknown !== undefined) {
        throw new Error(t('main.vault.mods.notInstalled', { uid: unknown }));
      }
      await writeActiveMods(await this.prefsPath(), uids);
      return;
    }
    const active = new Set(installed.filter((mod) => mod.info.active).map((mod) => mod.info.uid));
    for (const uid of uids) {
      if (known.has(uid)) {
        active.add(uid);
      }
    }
    await writeActiveMods(await this.prefsPath(), active);
  }

  /** Downloads the mods that are not installed, without activating them; rejects for a mod the vault does not have. */
  async ensureInstalled(uids: string[]): Promise<void> {
    const installedUids = new Set((await this.scan(true)).map((mod) => mod.info.uid));
    const missing = uids.filter((candidate) => !installedUids.has(candidate));
    await mapLimited(missing, MOD_DOWNLOAD_CONCURRENCY, async (uid) => {
      const vault = await this.findVaultVersion(uid);
      if (!vault) {
        throw new Error(t('main.vault.mods.notInVault', { uid }));
      }
      await this.install(vault.versionId);
    });
  }

  /** Folders of the mods a game mounts (`selectGameMods`), from freshly read mod_info.lua files. */
  async gameModFolders(simModUids: string[]): Promise<string[]> {
    const installed = await this.scan(true);
    return selectGameMods(
      installed.map((mod) => ({ uid: mod.info.uid, type: mod.info.type, active: mod.info.active, path: mod.path })),
      simModUids,
    );
  }

  /** The uids of the latest vault versions of the mods that have newer ones, by the current uid in lower case. */
  async newerVersions(uids: string[]): Promise<Map<string, string>> {
    if (uids.length === 0) {
      return new Map();
    }
    const document = resolveDocument(
      await this.api.get('/data/modVersion', {
        filter: rsqlOr(uids.map((uid) => rsqlEquals('uid', uid))),
        include: 'mod.latestVersion',
        'page[size]': String(uids.length),
      }),
    );
    return newerVersions(document.items, 'mod', 'uid');
  }

  /** Those of these mods the FAF vault does not have, so other players cannot download them; mods.scd ones never count. */
  async notInVault(uids: string[]): Promise<string[]> {
    const wanted = uids.filter((uid) => !isBuiltInMod(uid));
    const batches: string[][] = [];
    for (let start = 0; start < wanted.length; start += VAULT_UID_BATCH_SIZE) {
      batches.push(wanted.slice(start, start + VAULT_UID_BATCH_SIZE));
    }
    const found = new Set<string>();
    await mapLimited(batches, MOD_DOWNLOAD_CONCURRENCY, async (batch) => {
      const document = resolveDocument(
        await this.api.get('/data/modVersion', {
          filter: rsqlOr(batch.map((uid) => rsqlEquals('uid', uid))),
          'fields[modVersion]': 'uid',
          'page[size]': String(batch.length),
        }),
      );
      for (const version of document.items) {
        const uid = asString(version.uid);
        if (uid) {
          found.add(uid.toLowerCase());
        }
      }
    });
    return wanted.filter((uid) => !found.has(uid.toLowerCase()));
  }

  /**
   * Makes sure the sim mods of a game hold exactly the files the FAF vault published, reinstalling a mod otherwise.
   * UI mods are skipped: they run outside the simulation and cannot put players out of sync. A mod that is not in the
   * vault, like one still in development, cannot be checked and is only logged. Also returns the digest of each sim
   * mod's files, which TFAF players compare.
   */
  async verify(uids: string[]): Promise<{ notes: IntegrityNote[]; mods: ModVerification[] }> {
    if (uids.length === 0) {
      return { notes: [], mods: [] };
    }
    const installed = new Map((await this.scan(true)).map((mod) => [mod.info.uid, mod]));
    const sim = uids.flatMap((uid) => {
      const mod = installed.get(uid);
      return mod && mod.info.type === 'SIM' ? [mod] : [];
    });
    const results = await mapLimited(sim, MOD_DOWNLOAD_CONCURRENCY, async (mod): Promise<ModVerification & ModCheck> => {
      const { check, manifest } = await this.checkMod(mod);
      const verified = manifest && (check.status === 'ok' || check.status === 'repaired');
      return {
        ...check,
        state: VERIFICATION_STATES[check.status],
        digest: verified ? filesDigest(manifest.files) : check.status === 'failed' ? null : await folderDigest(mod.path),
      };
    });
    const notes: IntegrityNote[] = [];
    for (const check of results) {
      switch (check.status) {
        case 'failed':
          // Playing with files that differ from everyone else's would end in a desync.
          throw new Error(t('main.vault.mods.repairFailed', { name: check.name, details: check.details ?? '' }));
        case 'unchecked':
          notes.push({
            style: 'warning',
            text: t('main.vault.mods.checkFailed', { name: check.name, details: check.details ?? '' }),
          });
          break;
        case 'repaired':
          notes.push({
            style: 'info',
            text: t('main.vault.mods.repaired', { name: check.name, details: check.details ?? '' }),
          });
          break;
        default:
          break;
      }
    }
    return { notes, mods: results.map(({ uid, name, state, digest }) => ({ uid, name, state, digest })) };
  }

  /** Every installed mod, UI mods included, against the FAF vault; reports progress as a task. */
  async checkAll(): Promise<ModCheck[]> {
    const installed = await this.scan(true);
    return this.tasks.run(t('main.vault.mods.checkTask'), async (task) => {
      let done = 0;
      return mapLimited(installed, MOD_DOWNLOAD_CONCURRENCY, async (mod) => {
        const check = await this.checkMod(mod).then(
          (result) => result.check,
          (error: unknown): ModCheck => {
            if (!(error instanceof CancelledError)) {
              throw error;
            }
            const { uid, name, type } = mod.info;
            return { uid, name, type, status: 'failed', details: t('main.vault.mods.reinstallCancelled') };
          },
        );
        done++;
        task.progress(
          done / installed.length,
          t('main.vault.mods.checkProgress', { name: mod.info.name, done, total: installed.length }),
        );
        return check;
      });
    });
  }

  /** The check of a mod, with the vault's list of its files when there is one. */
  private async checkMod(mod: InstalledMod): Promise<{ check: ModCheck; manifest: Manifest | null }> {
    const { uid, name, type } = mod.info;
    let manifest: Manifest | null = null;
    const result = (status: ModCheckStatus, details: string | null = null) => ({
      check: { uid, name, type, status, details },
      manifest,
    });
    let vault: VaultVersion | null = null;
    try {
      manifest = await this.manifests.get('mod', uid);
      if (!manifest) {
        vault = await this.findVaultVersion(uid);
        const downloadUrl = vault?.downloadUrl;
        const entries = downloadUrl ? await retrying(() => fetchRemoteEntries(downloadUrl, this.userAgent)) : null;
        manifest = entries ? manifestFromEntries(entries, isModInfoFile) : null;
        if (manifest) {
          await this.manifests.put('mod', uid, manifest);
        }
      }
    } catch (error) {
      console.warn(`Mod ${name} (${uid}) could not be checked: ${describeError(error)}`);
      return result('unchecked', describeError(error));
    }
    if (!manifest) {
      console.warn(`Mod ${name} (${uid}) is not in the FAF vault, its files were not checked`);
      return result('notInVault');
    }

    const startedAt = Date.now();
    const problems = await checkFolder(mod.path, manifest, { allowExtra: false });
    if (problems.length === 0) {
      console.info(`Mod ${name} matches the vault (${manifest.files.length} files, ${Date.now() - startedAt} ms)`);
      return result('ok');
    }
    const details = describeProblems(problems);
    console.warn(`Mod ${name} (${uid}) differs from the vault: ${details}; reinstalling`);
    try {
      vault ??= await this.findVaultVersion(uid);
      if (!vault) {
        return result('failed', t('main.vault.mods.noArchive', { details }));
      }
      const reinstalled = await this.runInstall(vault.versionId, true);
      if (reinstalled && path.resolve(reinstalled).toLowerCase() !== path.resolve(mod.path).toLowerCase()) {
        // The damaged copy sits in another folder under the same uid, and the game could load either one.
        await rm(mod.path, { recursive: true, force: true });
      }
    } catch (error) {
      // Cancelling the reinstall before a game cancels the game; the caller decides.
      if (error instanceof CancelledError) {
        throw error;
      }
      console.warn(`Mod ${name} (${uid}) could not be reinstalled: ${describeError(error)}`);
      return result('failed', `${details}; ${describeError(error)}`);
    }
    return result('repaired', details);
  }

  /** The vault version of a mod by its uid; null when the vault does not have it. */
  private async findVaultVersion(uid: string): Promise<VaultVersion | null> {
    const document = resolveDocument(
      await this.api.get('/data/modVersion', { filter: rsqlEquals('uid', uid), 'page[size]': '1' }),
    );
    const version = document.items[0];
    const versionId = Number(version?.id);
    if (!Number.isInteger(versionId)) {
      return null;
    }
    const downloadUrl = asString(version?.downloadUrl);
    if (!downloadUrl || !isFafHttpsUrl(downloadUrl)) {
      throw new Error(t('main.api.invalidModData'));
    }
    return { versionId, downloadUrl };
  }

  /** Returns the folder the mod went to, or null when it was already installed and `force` was not set. */
  private async runInstall(versionId: number, force = false): Promise<string | null> {
    const document = resolveDocument(await this.api.get(`/data/modVersion/${versionId}`));
    const version = document.items[0];
    const uid = asString(version?.uid);
    const downloadUrl = asString(version?.downloadUrl);
    if (!uid || !downloadUrl || !isFafHttpsUrl(downloadUrl)) {
      throw new Error(t('main.api.invalidModData'));
    }
    if (!force && (await this.scan()).some((mod) => mod.info.uid === uid)) {
      return null;
    }

    const title = t('main.vault.mods.installTask', { name: asString(version?.filename) ?? uid });
    return this.tasks.run(
      title,
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
          await installArchive(download.path, this.settings.modsDirectory, (fraction) => task.progress(0.8 + fraction * 0.2));
          const manifest = manifestFromEntries(await readZipEntries(download.path), isModInfoFile);
          if (!manifest) {
            return null;
          }
          await this.manifests.put('mod', uid, manifest);
          return path.join(this.settings.modsDirectory, manifest.root);
        } finally {
          await download.cleanup();
        }
      },
      { cancellable: true },
    );
  }

  /** Folders with a mod_info.lua: mods sit directly in the mods folder or one level deeper. */
  private async findModFolders(modsDirectory: string): Promise<string[]> {
    const names = (await listDirectories(modsDirectory)).filter((name) => !name.startsWith('.'));
    const found = await mapLimited(names, SCAN_CONCURRENCY, async (name): Promise<string[]> => {
      const directory = path.join(modsDirectory, name);
      if (await pathExists(path.join(directory, MOD_INFO_FILE))) {
        return [directory];
      }
      const children = await listDirectories(directory);
      const nested = await Promise.all(
        children.map(async (child) => ((await pathExists(path.join(directory, child, MOD_INFO_FILE))) ? [path.join(directory, child)] : [])),
      );
      return nested.flat();
    });
    return found.flat();
  }

  /** The settings file of games TFAF starts, where the game reads the active mods from. */
  private prefsPath(): Promise<string> {
    return ensureOwnPrefs(this.settings.get().gamePrefsPath);
  }

  /** `fresh` re-reads every mod_info.lua instead of trusting its size and time. */
  private async scan(fresh = false): Promise<InstalledMod[]> {
    const [candidates, active] = await Promise.all([
      this.findModFolders(this.settings.modsDirectory),
      this.prefsPath().then(readActiveMods).catch((error: unknown) => {
        console.warn(`TFAF.prefs could not be read: ${describeError(error)}`);
        return new Set<string>();
      }),
    ]);
    const mods = await mapLimited(candidates, SCAN_CONCURRENCY, (directory) => this.readMod(directory, active, fresh));
    this.modInfos.retain(new Set(candidates.map((directory) => path.join(directory, MOD_INFO_FILE))));
    const byUid = new Map<string, InstalledMod>();
    for (const mod of mods) {
      if (mod && !byUid.has(mod.info.uid)) {
        byUid.set(mod.info.uid, mod);
      }
    }
    return [...byUid.values()];
  }

  private async readMod(directory: string, active: Set<string>, fresh: boolean): Promise<InstalledMod | null> {
    try {
      const modInfoFile = path.join(directory, MOD_INFO_FILE);
      const parse = async (): Promise<Omit<LocalMod, 'active'>> => {
        const modInfo = readModInfo(await readTextFile(modInfoFile));
        return {
          uid: modInfo.uid,
          name: modInfo.name,
          version: modInfo.version,
          author: modInfo.author,
          description: modInfo.description,
          type: modInfo.uiOnly ? 'UI' : 'SIM',
          folderName: path.basename(directory),
          iconDataUrl: modInfo.icon ? await this.readIcon(directory, modInfo.icon) : null,
        };
      };
      const info = await this.modInfos.get(modInfoFile, parse, fresh);
      return { path: directory, info: { ...info, active: active.has(info.uid) } };
    } catch (error) {
      console.warn(`Mod could not be read: ${directory}: ${describeError(error)}`);
      return null;
    }
  }

  /** Icons are referenced by their in-game path (`/mods/<folder>/icon.png`); the first two segments are the mount point. */
  private async readIcon(directory: string, iconPath: string): Promise<string | null> {
    const segments = iconPath.replace(/\\/g, '/').split('/').filter((segment) => segment.length > 0);
    if (segments.length <= 2 || segments.some((segment) => segment === '..')) {
      return null;
    }
    const iconFile = path.join(directory, ...segments.slice(2));
    const mimeType = ICON_TYPES[path.extname(iconFile).toLowerCase()];
    if (!mimeType || !iconFile.startsWith(directory + path.sep)) {
      return null;
    }
    try {
      if ((await stat(iconFile)).size > MAX_ICON_BYTES) {
        return null;
      }
      return `data:${mimeType};base64,${(await readFile(iconFile)).toString('base64')}`;
    } catch {
      return null;
    }
  }
}
