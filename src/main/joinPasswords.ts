import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HOST_GAME_LIMITS } from '../shared/contract.ts';

const MAX_HOSTS = 1000;
const MAX_HOST_LENGTH = 100;

/** Logins are compared without case, as the server does. */
function hostKey(host: string): string {
  return host.toLowerCase();
}

/** Passwords by host, as stored; anything that is not a login with a password is dropped. */
export function parseJoinPasswords(stored: unknown): Map<string, string> {
  const raw = typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const passwords = new Map<string, string>();
  for (const [host, password] of Object.entries(raw)) {
    if (
      host.length > 0 &&
      host.length <= MAX_HOST_LENGTH &&
      typeof password === 'string' &&
      password.length > 0 &&
      password.length <= HOST_GAME_LIMITS.passwordMaxLength &&
      passwords.size < MAX_HOSTS
    ) {
      passwords.set(hostKey(host), password);
    }
  }
  return passwords;
}

/**
 * The game passwords the user chose to remember, the last one per host, in join-passwords.json next to the settings.
 * Like the create-game presets they are plain text: they only let one into an open game.
 */
export class JoinPasswordStore {
  private readonly filePath: string;
  private passwords: Map<string, string>;
  private writing: Promise<void> = Promise.resolve();

  private constructor(filePath: string, passwords: Map<string, string>) {
    this.filePath = filePath;
    this.passwords = passwords;
  }

  static async load(filePath: string): Promise<JoinPasswordStore> {
    let content: string | null = null;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Join passwords file is unreadable, starting without passwords', error);
      }
    }
    let stored: unknown = null;
    if (content !== null) {
      try {
        stored = JSON.parse(content);
      } catch (error) {
        // The next save would overwrite the file, so the damaged one is kept aside for manual recovery.
        console.warn('Join passwords file is corrupt, keeping it as .corrupt', error);
        await rename(filePath, `${filePath}.corrupt`).catch(() => undefined);
      }
    }
    return new JoinPasswordStore(filePath, parseJoinPasswords(stored));
  }

  get(host: string): string | null {
    return this.passwords.get(hostKey(host)) ?? null;
  }

  /** null forgets the host's password. */
  async set(host: string, password: string | null): Promise<void> {
    const key = hostKey(host);
    if ((this.passwords.get(key) ?? null) === password) {
      return;
    }
    const next = new Map(this.passwords);
    if (password === null) {
      next.delete(key);
    } else {
      // The newest goes last, so the oldest is the one dropped once the list is full.
      next.delete(key);
      next.set(key, password);
      while (next.size > MAX_HOSTS) {
        next.delete(next.keys().next().value!);
      }
    }
    this.passwords = next;
    await this.persist();
  }

  /** Writes strictly one after another, so quick changes never interleave on the temporary file. */
  private persist(): Promise<void> {
    const content = JSON.stringify(Object.fromEntries(this.passwords), null, 2);
    const write = this.writing.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.tmp`;
      await writeFile(tempPath, content, 'utf8');
      await rename(tempPath, this.filePath);
    });
    this.writing = write.catch(() => undefined);
    return write;
  }
}
