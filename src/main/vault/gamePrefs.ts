import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { t } from '../i18n.ts';
import { pathExists } from './fsUtil.ts';

/**
 * TFAF's own game settings, next to the shared Game.prefs. Every game TFAF starts gets `/prefs TFAF.prefs`, so the
 * official client keeps Game.prefs to itself. The game takes the name relative to its own settings folder and saves
 * through `TFAF.prefs.new`.
 */
export const OWN_PREFS_FILE = 'TFAF.prefs';

/** `sharedPrefsPath` is the official client's Game.prefs, which the game keeps in its settings folder. */
export function ownPrefsPath(sharedPrefsPath: string): string {
  return path.join(path.dirname(sharedPrefsPath), OWN_PREFS_FILE);
}

/**
 * The path of TFAF's own settings. The first time they are needed they start as a copy of Game.prefs, so the profile,
 * options and key bindings stay as they were; from then on each client keeps its own.
 */
export async function ensureOwnPrefs(sharedPrefsPath: string): Promise<string> {
  const own = ownPrefsPath(sharedPrefsPath);
  if (!(await pathExists(own)) && (await pathExists(sharedPrefsPath))) {
    try {
      await copyFile(sharedPrefsPath, own, constants.COPYFILE_EXCL);
    } catch (error) {
      // Another caller made the copy first.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }
  return own;
}

// Same patterns as GamePrefsService of the official client: active mods live in Game.prefs as
// `active_mods = { ['uid'] = true, ... }`.
const ACTIVE_MODS_BLOCK = /active_mods\s*=\s*\{[\s\S]*?\}/;
const ACTIVE_MOD_ENTRY = /\['(.*?)'\]\s*=\s*(true|false)/g;

/** UIDs end up inside a single-quoted Lua string, so quotes, backslashes and line breaks are never written. */
export function isWritableModUid(uid: string): boolean {
  return uid.length > 0 && !/['\\\r\n]/.test(uid);
}

export function parseActiveMods(content: string): Set<string> {
  const block = ACTIVE_MODS_BLOCK.exec(content)?.[0];
  const active = new Set<string>();
  if (block) {
    for (const match of block.matchAll(ACTIVE_MOD_ENTRY)) {
      if (match[2] === 'true' && match[1]) {
        active.add(match[1]);
      }
    }
  }
  return active;
}

export function replaceActiveMods(content: string, uids: Iterable<string>): string {
  const entries = [...uids].filter(isWritableModUid).map((uid) => `    ['${uid}'] = true`);
  const block = `active_mods = {\n${entries.join(',\n')}\n}`;
  if (ACTIVE_MODS_BLOCK.test(content)) {
    return content.replace(ACTIVE_MODS_BLOCK, () => block);
  }
  const separator = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  return `${content}${separator}${block}\n`;
}

/**
 * The file as text, empty when there is none. Game.prefs is read and written as latin1, so bytes the launcher does not
 * change (names in other encodings among them) survive unchanged.
 */
export async function readGamePrefs(prefsPath: string): Promise<string> {
  try {
    return await readFile(prefsPath, 'latin1');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

// Each change reads the whole file and writes it back, so changes wait for each other instead of losing one.
let pendingChange: Promise<unknown> = Promise.resolve();
const lockedFiles = new Set<string>();

function fileKey(file: string): string {
  const absolute = path.resolve(file);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

/** Locks after writes already queued finish, so a game receives their latest contents. */
export async function lockGamePrefs(file: string): Promise<void> {
  const run = pendingChange.then(() => { lockedFiles.add(fileKey(file)); });
  pendingChange = run.catch(() => undefined);
  await run;
}

export function unlockGamePrefs(file: string): void {
  lockedFiles.delete(fileKey(file));
}

/**
 * Replaces the content of Game.prefs with what `change` makes of it; a change that throws writes nothing. Before the
 * first write a copy of the file is kept as Game.prefs.tfaf-backup, and the new content goes through a temporary file,
 * so a failed write leaves the old one.
 */
export function updateGamePrefs(prefsPath: string, change: (content: string) => string): Promise<void> {
  const run = pendingChange.then(async () => {
    if (lockedFiles.has(fileKey(prefsPath))) {
      throw new Error(t('main.portablePrefs.inUse'));
    }
    const content = await readGamePrefs(prefsPath);
    const updated = change(content);
    if (updated === content) {
      return;
    }
    await mkdir(path.dirname(prefsPath), { recursive: true });
    const backupPath = `${prefsPath}.tfaf-backup`;
    if (content.length > 0 && !(await pathExists(backupPath))) {
      await copyFile(prefsPath, backupPath);
    }
    const tempPath = `${prefsPath}.tfaf-tmp`;
    await writeFile(tempPath, updated, 'latin1');
    await rename(tempPath, prefsPath);
  });
  pendingChange = run.catch(() => undefined);
  return run;
}

export async function readActiveMods(prefsPath: string): Promise<Set<string>> {
  return parseActiveMods(await readGamePrefs(prefsPath));
}

export async function writeActiveMods(prefsPath: string, uids: Iterable<string>): Promise<void> {
  await updateGamePrefs(prefsPath, (content) => replaceActiveMods(content, uids));
}
