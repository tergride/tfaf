// The game's files as the game finds them. init_faf.lua mounts the vault's maps first, then FAF's packages
// (`<data>/gamedata/*.nx2`), then the game's own (`<game>/gamedata/*.scd`), then the maps of the game installation;
// the first mount that has a path wins. The map view indexes only the packages that hold map textures, props and
// meshes; the TFAF lobby reads the packages of its featured mod (gamePackages.ts).

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describeError } from '../errors.ts';
import type { GamePackageLayout } from '../gameOptions/gamePackages.ts';
import type { SettingsStore } from '../settings.ts';
import { findChildCaseInsensitive, isSafeFolderName } from '../vault/fsUtil.ts';
import { readZipEntries, readZipEntryFiles, type ZipEntry } from '../vault/zip.ts';
import { gamePathKey } from './gamePaths.ts';

const FAF_PACKAGES = ['env.nx2', 'textures.nx2', 'meshes.nx2', 'units.nx2'];
const GAME_PACKAGES = ['env.scd', 'textures.scd', 'props.scd', 'meshes.scd', 'units.scd'];
const MAX_SCRIPT_BYTES = 16 * 1024 ** 2;

export type GamePackagesOf = (paths: { dataPath: string; gamePath: string | null }) => GamePackageLayout;

function mapViewPackages({ dataPath, gamePath }: { dataPath: string; gamePath: string | null }): GamePackageLayout {
  return {
    archives: [
      ...FAF_PACKAGES.map((name) => path.join(dataPath, 'gamedata', name)),
      ...(gamePath ? GAME_PACKAGES.map((name) => path.join(gamePath, 'gamedata', name)) : []),
    ],
    hooks: [],
  };
}

interface ArchiveIndex {
  file: string;
  size: number;
  modified: number;
  /** By lower-case name without the leading slash. */
  entries: Map<string, ZipEntry>;
}

export class GameFileSystem {
  private readonly settings: Pick<SettingsStore, 'get' | 'mapsDirectory'>;
  private readonly packagesOf: GamePackagesOf;
  private archives: ArchiveIndex[] = [];
  private hooks: string[] = [];
  private readonly cached = new Map<string, ArchiveIndex>();

  constructor(settings: Pick<SettingsStore, 'get' | 'mapsDirectory'>, packagesOf: GamePackagesOf = mapViewPackages) {
    this.settings = settings;
    this.packagesOf = packagesOf;
  }

  private mapRoots(): string[] {
    const gamePath = this.settings.get().gamePath;
    return [this.settings.mapsDirectory, ...(gamePath ? [path.join(gamePath, 'maps')] : [])];
  }

  /** The folder of a map, in the vault first, like the game mounts them. */
  async mapFolder(folderName: string): Promise<string | null> {
    if (!isSafeFolderName(folderName)) {
      return null;
    }
    for (const root of this.mapRoots()) {
      const folder = await findChildCaseInsensitive(root, folderName);
      if (folder) {
        return folder;
      }
    }
    return null;
  }

  /** Reads the packages' directories again if a package changed since, e.g. after a game update. */
  async refresh(): Promise<void> {
    const { dataPath, gamePath } = this.settings.get();
    const layout = this.packagesOf({ dataPath, gamePath: gamePath ?? null });
    const archives: ArchiveIndex[] = [];
    for (const file of layout.archives) {
      const index = await this.index(file);
      if (index) {
        archives.push(index);
      }
    }
    this.archives = archives;
    this.hooks = layout.hooks;
  }

  private async index(file: string): Promise<ArchiveIndex | null> {
    let info;
    try {
      info = await stat(file);
    } catch {
      this.cached.delete(file);
      return null;
    }
    const cached = this.cached.get(file);
    if (cached && cached.size === info.size && cached.modified === info.mtimeMs) {
      return cached;
    }
    try {
      const entries = new Map<string, ZipEntry>();
      for (const entry of await readZipEntries(file)) {
        const key = entry.name.toLowerCase();
        if (!entry.isDirectory && !entries.has(key)) {
          entries.set(key, entry);
        }
      }
      const index = { file, size: info.size, modified: info.mtimeMs, entries };
      this.cached.set(file, index);
      return index;
    } catch (error) {
      console.warn(`Game package ${file} could not be read: ${describeError(error)}`);
      return null;
    }
  }

  /** The game paths of the packages' files under `folder` whose names end with `suffix`, in lower case, each once. */
  async list(folder: string, suffix: string): Promise<string[]> {
    await this.refresh();
    const prefix = `${gamePathKey(folder).slice(1)}/`;
    const found = new Set<string>();
    for (const archive of this.archives) {
      for (const key of archive.entries.keys()) {
        if (key.startsWith(prefix) && key.endsWith(suffix)) {
          found.add(`/${key}`);
        }
      }
    }
    return [...found];
  }

  /** A file by its game path (normalised by gamePaths.ts), or null when no mount has it. */
  async read(gamePath: string, maxBytes: number): Promise<Buffer | null> {
    const parts = gamePath.split('/').filter(Boolean);
    if (parts[0]?.toLowerCase() === 'maps') {
      const folder = parts.length > 2 ? await this.mapFolder(parts[1]!) : null;
      return folder ? readLooseFile(path.join(folder, ...parts.slice(2)), maxBytes) : null;
    }
    if (this.archives.length === 0) {
      await this.refresh();
    }
    const key = gamePathKey(gamePath).slice(1);
    for (const archive of this.archives) {
      const entry = archive.entries.get(key);
      if (entry) {
        const [data] = await readZipEntryFiles(archive.file, [entry], maxBytes);
        return data ?? null;
      }
    }
    return null;
  }

  /** A script of the packages with the hooks the game appends to it, in their order; null when no package has it. */
  async script(gamePath: string): Promise<string | null> {
    await this.refresh();
    const rooted = gamePath.startsWith('/') ? gamePath : `/${gamePath}`;
    const base = await this.read(rooted, MAX_SCRIPT_BYTES);
    if (!base) {
      return null;
    }
    const parts = [base.toString('utf8')];
    for (const hook of this.hooks) {
      const appended = await this.read(`${hook}${rooted}`, MAX_SCRIPT_BYTES);
      if (appended) {
        parts.push(appended.toString('utf8'));
      }
    }
    return parts.join('\n');
  }
}

async function readLooseFile(file: string, maxBytes: number): Promise<Buffer | null> {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > maxBytes) {
      return null;
    }
    return await readFile(file);
  } catch {
    return null;
  }
}
