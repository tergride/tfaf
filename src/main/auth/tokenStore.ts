import { app, safeStorage } from 'electron';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServerId } from '../../shared/contract.ts';

/** Persists refresh tokens per server, encrypted with the OS keychain (DPAPI on Windows). */
export class TokenStore {
  private readonly directory = path.join(app.getPath('userData'), 'credentials');

  async load(server: ServerId): Promise<string | null> {
    if (!safeStorage.isEncryptionAvailable()) {
      return null;
    }
    try {
      return safeStorage.decryptString(await readFile(this.fileFor(server)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`Stored credentials for ${server} are unreadable`);
      }
      return null;
    }
  }

  async save(server: ServerId, refreshToken: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('OS encryption is unavailable, the session will not be remembered');
      return;
    }
    await mkdir(this.directory, { recursive: true });
    // The token is rewritten on every refresh; a write cut short by a crash must not leave an undecryptable file.
    const file = this.fileFor(server);
    await writeFile(`${file}.tmp`, safeStorage.encryptString(refreshToken));
    await rename(`${file}.tmp`, file);
  }

  async clear(server: ServerId): Promise<void> {
    await rm(this.fileFor(server), { force: true });
  }

  private fileFor(server: ServerId): string {
    return path.join(this.directory, `${server}.bin`);
  }
}
