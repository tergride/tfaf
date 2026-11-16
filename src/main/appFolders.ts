import { app, shell } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { AppFolder } from '../shared/contract.ts';
import type { SettingsStore } from './settings.ts';

type FolderSettings = Pick<SettingsStore, 'get' | 'logsDirectory' | 'mapsDirectory' | 'modsDirectory' | 'replaysDirectory'>;

function appFolderPath(settings: FolderSettings, folder: AppFolder): string {
  switch (folder) {
    case 'data':
      return settings.get().dataPath;
    case 'gameLogs':
      return settings.logsDirectory;
    case 'launcherLogs':
      return app.getPath('logs');
    case 'maps':
      return settings.mapsDirectory;
    case 'mods':
      return settings.modsDirectory;
    case 'replays':
      return settings.replaysDirectory;
    case 'gamePrefs':
      return path.dirname(settings.get().gamePrefsPath);
  }
}

/** Opens one of the fixed folders in Explorer; the user menu and the tray menu name it, only main knows its path. */
export async function openAppFolder(settings: FolderSettings, folder: AppFolder): Promise<void> {
  const target = appFolderPath(settings, folder);
  await mkdir(target, { recursive: true });
  const error = await shell.openPath(target);
  if (error) {
    throw new Error(error);
  }
}
