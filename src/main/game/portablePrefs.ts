import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import { lockGamePrefs, unlockGamePrefs } from '../vault/gamePrefs.ts';
import { isForgedAllianceRunning } from './processes.ts';

interface Journal {
  version: 1;
  phase: 'preparing' | 'ready' | 'saved';
  name: string;
  directory: string;
  machine: string;
}

const WORKING_NAME = /^TFAF-portable-[a-f\d-]{36}\.prefs$/;
const active = new Set<string>();

function fileKey(file: string): string {
  const absolute = path.resolve(file);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function systemPrefsDirectory(): string {
  return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
    'Gas Powered Games', 'Supreme Commander Forged Alliance');
}

async function readOptional(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** A short-lived file in the engine's fixed preferences folder; the permanent copy stays portable. */
export interface PortablePrefsSession {
  argument: string;
  workingFile: string;
  finish(): Promise<void>;
  cancel(): Promise<void>;
}

/** File-only bridge, with injectable locations/process detection for tests without starting the game. */
export class PortablePrefsBridge {
  private readonly journalFile: string;
  private readonly key: string;
  private readonly canonicalFile: string;
  private readonly directory: string;
  private readonly gameRunning: () => Promise<boolean>;
  private readonly machine: string;

  constructor(canonicalFile: string, directory: string, gameRunning: () => Promise<boolean>, machine = os.hostname()) {
    this.canonicalFile = path.resolve(canonicalFile);
    this.directory = path.resolve(directory);
    this.gameRunning = gameRunning;
    this.machine = machine;
    this.journalFile = `${this.canonicalFile}.session.json`;
    this.key = fileKey(this.canonicalFile);
  }

  /**
   * Called before the UI can change preferences. A journal whose working copy is out of reach (another computer or
   * Windows profile) or unreadable is set aside, so the last saved profile stays in use; the returned warning says so.
   * Recoverable sessions keep their files and throw until they can be completed.
   */
  async recover(): Promise<string | null> {
    if (active.has(this.key)) throw new Error(t('main.portablePrefs.inUse'));
    const journal = await this.readJournal();
    if (!journal) return null;
    if ('unusable' in journal) {
      const stale = await this.setJournalAside();
      return journal.unusable === 'foreign'
        ? t('main.portablePrefs.foreignJournal', { file: journal.workingFile, journal: stale })
        : t('main.portablePrefs.invalidJournal', { file: stale });
    }
    await lockGamePrefs(this.canonicalFile);
    if (await this.gameRunning()) throw new Error(t('main.portablePrefs.gameRunning'));
    await this.complete(journal, journal.phase === 'ready');
    return null;
  }

  async prepare(): Promise<PortablePrefsSession> {
    const warning = await this.recover();
    if (warning) console.warn(warning);
    if (active.has(this.key)) throw new Error(t('main.portablePrefs.inUse'));
    active.add(this.key);
    const journal: Journal = {
      version: 1, phase: 'preparing', name: `TFAF-portable-${randomUUID()}.prefs`,
      directory: this.directory, machine: this.machine,
    };
    const workingFile = path.join(this.directory, journal.name);
    let ownsJournal = false;
    try {
      await lockGamePrefs(this.canonicalFile);
      await mkdir(path.dirname(this.canonicalFile), { recursive: true });
      await mkdir(this.directory, { recursive: true });
      // Record ownership before staging, so a crash cannot orphan an untracked working file.
      await writeFile(this.journalFile, JSON.stringify(journal), { flag: 'wx' });
      ownsJournal = true;
      const content = await readOptional(this.canonicalFile);
      await writeFile(`${workingFile}.tfaf-stage`, content ?? Buffer.alloc(0), { flag: 'wx' });
      await rename(`${workingFile}.tfaf-stage`, workingFile);
      journal.phase = 'ready';
      await writeFile(`${this.journalFile}.tmp`, JSON.stringify(journal));
      await rename(`${this.journalFile}.tmp`, this.journalFile);
    } catch (error) {
      active.delete(this.key);
      if (ownsJournal) {
        // Nothing has been launched, so restoring an incomplete working copy is unnecessary.
        await this.complete(journal, false).catch(() => undefined);
      } else {
        unlockGamePrefs(this.canonicalFile);
      }
      throw new Error(t('main.portablePrefs.prepareFailed', { error: describeError(error) }), { cause: error });
    }
    let ending: Promise<void> | null = null;
    const end = (save: boolean): Promise<void> => {
      ending ??= this.complete(journal, save).finally(() => active.delete(this.key));
      return ending;
    };
    return { argument: journal.name, workingFile, finish: () => end(true), cancel: () => end(false) };
  }

  private async readJournal(): Promise<Journal | { unusable: 'invalid' } | { unusable: 'foreign'; workingFile: string } | null> {
    const content = await readOptional(this.journalFile);
    if (!content) return null;
    let raw: Partial<Journal>;
    try {
      raw = JSON.parse(content.toString('utf8')) as Partial<Journal>;
      if (!raw || raw.version !== 1 || !['preparing', 'ready', 'saved'].includes(raw.phase ?? '') ||
        typeof raw.name !== 'string' || !WORKING_NAME.test(raw.name) ||
        typeof raw.directory !== 'string' || typeof raw.machine !== 'string') throw new Error();
    } catch {
      return { unusable: 'invalid' };
    }
    if (fileKey(raw.directory) !== fileKey(this.directory) || raw.machine !== this.machine) {
      return { unusable: 'foreign', workingFile: path.join(raw.directory, raw.name) };
    }
    return raw as Journal;
  }

  /** Keeps the journal for reference under a name nothing reads again. */
  private async setJournalAside(): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const stale = `${this.journalFile}.${stamp}-${randomUUID().slice(0, 8)}.stale`;
    await rename(this.journalFile, stale);
    return stale;
  }

  private async complete(journal: Journal, save: boolean): Promise<void> {
    const workingFile = path.join(this.directory, journal.name);
    try {
      if (save) {
        const content = await readOptional(workingFile);
        if (content === null) throw new Error(t('main.portablePrefs.workingMissing'));
        // A failed first start can leave an empty file: it must not erase an existing profile.
        if (content.length > 0) {
          await mkdir(path.dirname(this.canonicalFile), { recursive: true });
          const temporary = `${this.canonicalFile}.portable-tmp`;
          await copyFile(workingFile, temporary);
          await rename(temporary, this.canonicalFile);
        }
        journal.phase = 'saved';
        await writeFile(`${this.journalFile}.tmp`, JSON.stringify(journal));
        await rename(`${this.journalFile}.tmp`, this.journalFile);
      }
      // Keep the journal until both the save and cleanup succeeded, allowing recovery to retry.
      await this.keepRejectedCopy(`${workingFile}.bad`);
      await rm(`${workingFile}.new`, { force: true });
      await rm(`${workingFile}.tfaf-stage`, { force: true });
      await rm(`${this.journalFile}.tmp`, { force: true });
      await rm(workingFile, { force: true });
      await rm(this.journalFile);
      unlockGamePrefs(this.canonicalFile);
    } catch (error) {
      throw new Error(t('main.portablePrefs.recoveryFailed', { file: workingFile, error: describeError(error) }), { cause: error });
    }
  }

  /**
   * The game renames a preferences file it cannot read to `<name>.bad` and starts from its defaults; it does so with the
   * empty copy of a first start, too. A rejected profile with content is kept beside the portable one, as the game
   * keeps Game.prefs.bad; the empty placeholder is only removed.
   */
  private async keepRejectedCopy(file: string): Promise<void> {
    const content = await readOptional(file);
    if (content === null) return;
    if (content.length > 0) {
      await copyFile(file, `${this.canonicalFile}.bad`);
    }
    await rm(file, { force: true });
  }
}

export function recoverPortablePrefs(prefsFile: string): Promise<string | null> {
  return new PortablePrefsBridge(prefsFile, systemPrefsDirectory(), () => isForgedAllianceRunning(true)).recover();
}

export function preparePortablePrefs(prefsFile: string): Promise<PortablePrefsSession> {
  return new PortablePrefsBridge(prefsFile, systemPrefsDirectory(), () => isForgedAllianceRunning(true)).prepare();
}
