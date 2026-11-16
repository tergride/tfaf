// The vault a game mounts. Forged Alliance mounts every folder of its vault's mods folder, active or not, and a mod can
// name files of another folder by their /mods/ path, so a stray folder on one computer changes what a mod loads there
// and puts that player out of sync. Before a game with mod isolation the launcher builds a vault of its own in the data
// folder, with a link to the maps folder and links to the mods of that game only, and starts the game with an init file
// that mounts it instead. The folder is removed when the game exits and before the next one is built.

import { lstat, mkdir, readdir, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LocalMod } from '../../shared/contract.ts';
import { pathExists } from '../vault/fsUtil.ts';

export const GAME_VAULT_FOLDER = 'game-session';
const VAULT_FOLDER = 'vault';
const OVERRIDES_FOLDER = 'overrides';
const INIT_FILE = 'init.lua';

// The mods of the original game's mods.scd, which the game always loads from there. The FAF vault even holds a
// different mod under Resource Rich's uid, so a vault folder with one of these uids is never mounted.
const BUILT_IN_MOD_UIDS = new Set(
  [
    '6AAFE20A-E851-11DB-B8BE-ECC755D89593', // Supreme Commander Campaign Branch
    '6EAA2403-27A8-47ee-B4DF-5017E056E501', // Chess
    'EA040F8E-857A-4566-9879-0D37420A5B9D', // Nothing but time
    '74A9EAB2-E851-11DB-A1F1-F2C755D89593', // Resource Rich
    'BC7D1006-509B-44fe-ADAF-D31A7F28DC48', // Retirement
  ].map((uid) => uid.toLowerCase()),
);

export function isBuiltInMod(uid: string): boolean {
  return BUILT_IN_MOD_UIDS.has(uid.toLowerCase());
}

export interface InstalledModFolder extends Pick<LocalMod, 'uid' | 'type' | 'active'> {
  path: string;
}

/**
 * The folders of the mods a game mounts: its sim mods and the active UI mods. Other active sim mods stay out: mounted,
 * a mod can change the files of another one even when it is off.
 */
export function selectGameMods(installed: InstalledModFolder[], simModUids: string[]): string[] {
  const simMods = new Set(simModUids);
  return installed
    .filter((mod) => !isBuiltInMod(mod.uid))
    .filter((mod) => simMods.has(mod.uid) || (mod.type === 'UI' && mod.active))
    .map((mod) => mod.path);
}

export interface GameVaultLayout {
  /** Where the vault is built, `<data folder>\game-session`. */
  directory: string;
  /** The bin folder of the game files the game runs on; the generated init file runs the init.lua there. */
  binDirectory: string;
  mapsDirectory: string;
  /** The mods the game mounts. */
  modFolders: string[];
  /** Files that replace those of the game for this game alone, by their path in the game. */
  overrides?: GameFileOverride[];
}

export interface GameFileOverride {
  path: string;
  /** Text is written as UTF-8. */
  content: string | Buffer;
}

/** Builds the vault of one game and removes it afterwards; builds and removals run one after another. */
export class GameVault {
  private queue: Promise<unknown> = Promise.resolve();
  private built: string | null = null;

  /** Replaces whatever an earlier game left behind; returns the init file that starts the game on the new vault. */
  prepare(layout: GameVaultLayout): Promise<string> {
    return this.enqueue(async () => {
      if (this.built !== null && this.built !== layout.directory) {
        await removeGameVault(this.built);
      }
      this.built = layout.directory;
      await removeGameVault(layout.directory);
      return buildGameVault(layout);
    });
  }

  release(): Promise<void> {
    return this.enqueue(async () => {
      const built = this.built;
      this.built = null;
      if (built !== null) {
        await removeGameVault(built);
      }
    });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

async function buildGameVault({ directory, binDirectory, mapsDirectory, modFolders, overrides = [] }: GameVaultLayout): Promise<string> {
  const vault = await buildVaultFolder(directory, mapsDirectory, modFolders);
  const overridesFolder = path.join(directory, OVERRIDES_FOLDER);
  for (const override of overrides) {
    const file = path.join(overridesFolder, ...override.path.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, override.content, typeof override.content === 'string' ? 'utf8' : undefined);
  }
  const initFile = path.join(directory, INIT_FILE);
  await writeFile(initFile, initFileText(binDirectory, vault, overrides.length > 0 ? overridesFolder : null), 'utf8');
  return initFile;
}

async function buildVaultFolder(directory: string, mapsDirectory: string, modFolders: string[]): Promise<string> {
  const vault = path.join(directory, VAULT_FOLDER);
  const mods = path.join(vault, 'mods');
  await mkdir(mods, { recursive: true });
  if (await pathExists(mapsDirectory)) {
    await linkFolder(mapsDirectory, path.join(vault, 'maps'));
  }
  const names = new Set<string>();
  for (const folder of modFolders) {
    const name = path.basename(folder);
    // The game mounts a mod at /mods/<folder name in lower case>, so a second folder of that name would take its place.
    if (names.has(name.toLowerCase())) {
      console.warn(`Mod folder ${folder} is left out of the game: another mod of the game has the folder name ${name}`);
      continue;
    }
    names.add(name.toLowerCase());
    await linkFolder(folder, path.join(mods, name));
  }
  return vault;
}

/** A junction needs no administrator rights and works across local drives. */
function linkFolder(target: string, link: string): Promise<void> {
  return symlink(path.resolve(target), link, 'junction');
}

function luaString(value: string): string {
  return `"${value.replace(/\\/g, '/').replace(/"/g, '\\"')}"`;
}

/**
 * Runs the game's own init.lua, with what this game needs on top. The vault: `custom_vault_path` is set after every
 * file init.lua loads with `dofile`, since it reads the player's vault from fa_path.lua before it mounts maps and mods.
 * Overrides: mounted before everything else, since the first mount that has a path wins.
 */
function initFileText(binDirectory: string, vault: string, overrides: string | null): string {
  return [
    '-- Written by TFAF for one game: the game\'s own init.lua, with the files next to this file.',
    `InitFileDir = ${luaString(binDirectory)}`,
    'local TfafDofile = dofile',
    'dofile = function(file)',
    '    TfafDofile(file)',
    `    custom_vault_path = ${luaString(vault)}`,
    'end',
    'TfafDofile(InitFileDir .. "/init.lua")',
    'dofile = TfafDofile',
    ...(overrides ? [`table.insert(path, 1, { dir = ${luaString(overrides)}, mountpoint = "/" })`] : []),
    '',
  ].join('\n');
}

/**
 * Removes the vault without ever entering a link: links lead to the player's own maps and mods. Where a link is
 * expected, only a link or an empty folder is removed, so a real folder there makes the removal fail instead.
 */
export async function removeGameVault(directory: string): Promise<void> {
  const vault = path.join(directory, VAULT_FOLDER);
  const mods = path.join(vault, 'mods');
  for (const name of await readdir(mods).catch(ignoreMissing([]))) {
    await removeLink(path.join(mods, name));
  }
  await removeLink(path.join(vault, 'maps'));
  await rm(path.join(directory, INIT_FILE), { force: true });
  await rm(path.join(directory, OVERRIDES_FOLDER), { force: true, recursive: true });
  for (const folder of [mods, vault, directory]) {
    await rmdir(folder).catch(ignoreMissing(undefined));
  }
}

async function removeLink(link: string): Promise<void> {
  const stats = await lstat(link).catch(ignoreMissing(null));
  if (!stats) {
    return;
  }
  // rmdir takes a junction away without touching its target and refuses a folder that is not empty.
  await (stats.isDirectory() ? rmdir(link) : unlink(link));
}

function ignoreMissing<T>(fallback: T): (error: unknown) => T {
  return (error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  };
}
