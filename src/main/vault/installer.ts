import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import { renameWithRetry } from './fsUtil.ts';
import { extractZip } from './zip.ts';

const STAGING_PREFIX = '.tfaf-staging-';
const PARKED_PREFIX = '.tfaf-old-';
const DOWNLOAD_PREFIX = '.tfaf-download-';

/**
 * Extracts a vault archive next to `targetDir` first and only then moves its top-level folders into place, replacing
 * folders with the same name (the official client deletes the old mod folder the same way). A failed download or
 * extraction therefore never leaves a half-written map or mod behind.
 */
export async function installArchive(zipPath: string, targetDir: string, onProgress?: (fraction: number) => void): Promise<string[]> {
  await mkdir(targetDir, { recursive: true });
  const staging = await mkdtemp(path.join(targetDir, STAGING_PREFIX));
  try {
    await extractZip(zipPath, staging, { onProgress });
    const names = await readdir(staging);
    if (names.length === 0) {
      throw new Error(t('main.vault.emptyArchive'));
    }
    for (const name of names) {
      await replaceEntry(path.join(staging, name), path.join(targetDir, name));
    }
    return names;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * The old folder is moved aside before the new one takes its place and is put back if that fails, so a file locked by
 * the game or an antivirus never costs both versions.
 */
async function replaceEntry(source: string, destination: string): Promise<void> {
  const parked = path.join(path.dirname(destination), `${PARKED_PREFIX}${randomUUID()}`);
  let hadOld = true;
  try {
    await renameWithRetry(destination, parked);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    hadOld = false;
  }
  try {
    await renameWithRetry(source, destination);
  } catch (error) {
    if (hadOld) {
      await renameWithRetry(parked, destination).catch((restoreError: unknown) =>
        console.warn(`Could not restore ${destination}: ${describeError(restoreError)}`),
      );
    }
    throw error;
  }
  if (hadOld) {
    // A leftover is harmless: hidden from scans and removed on the next start.
    await rm(parked, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Removes what installs and downloads interrupted by a crash or a closed launcher left in a vault folder. */
export async function removeInstallLeftovers(directory: string): Promise<void> {
  const entries = await readdir(directory).catch(() => []);
  await Promise.all(
    entries
      .filter((name) => name.startsWith(STAGING_PREFIX) || name.startsWith(PARKED_PREFIX) || name.startsWith(DOWNLOAD_PREFIX))
      .map((name) => rm(path.join(directory, name), { recursive: true, force: true }).catch(() => undefined)),
  );
}
