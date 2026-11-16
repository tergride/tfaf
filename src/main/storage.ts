import { app } from 'electron';
import path from 'node:path';
import { t } from './i18n.ts';
import { findPortableStorage, preparePortableStorage, type PortableStorage } from './storagePaths.ts';

export type { PortableStorage } from './storagePaths.ts';

let storage: PortableStorage | null = null;

export function portableStorage(): PortableStorage | null {
  return storage;
}

/** Must run synchronously before ready, session access and requestSingleInstanceLock. */
export function configureStorage(): void {
  try {
    storage = findPortableStorage(process.execPath, app.isPackaged);
    if (!storage) {
      return;
    }
    preparePortableStorage(storage);
    app.setPath('userData', storage.profileDirectory);
    app.setPath('sessionData', storage.sessionDirectory);
    app.setPath('temp', storage.tempDirectory);
    app.setPath('crashDumps', storage.crashDirectory);
    app.setAppLogsPath(storage.logsDirectory);
    // os.tmpdir() and child processes must use this copy's temporary downloads, too.
    process.env.TMP = storage.tempDirectory;
    process.env.TEMP = storage.tempDirectory;
    process.env.TMPDIR = storage.tempDirectory;
  } catch (error) {
    throw new Error(t('settings.portable.storageUnavailable', {
      path: path.join(path.dirname(process.execPath), 'portable-data'),
      error: error instanceof Error ? error.message : String(error),
    }), { cause: error });
  }
}
