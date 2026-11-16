import { app } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { t } from './i18n.ts';

/** Native helpers (faf-uid, later the ICE adapter) are fetched by `npm run fetch:native` into resources/native. */
export function nativeBinaryPath(fileName: string): string {
  const base = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources');
  return path.join(base, 'native', fileName);
}

export function requireNativeBinary(fileName: string): string {
  const binary = nativeBinaryPath(fileName);
  if (!existsSync(binary)) {
    throw new Error(t('main.nativeBinaryMissing', { file: fileName }));
  }
  return binary;
}
