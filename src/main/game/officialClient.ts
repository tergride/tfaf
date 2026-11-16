import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { asObject, asString } from '../api/jsonApi.ts';
import { pathExists } from '../vault/fsUtil.ts';

export interface OfficialClientData {
  /** Game files as the official client last prepared them: `<base>\bin`, `<base>\gamedata`. */
  baseDirectory: string;
  /** Older versions of featured mod files, stored as `<cache>\<group>\<md5>`. */
  featuredModCacheDirectory: string;
}

function defaultBaseDirectory(): string {
  return path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'FAForever');
}

/**
 * Locates the data folder of an installed official FAF client (client.prefs keeps it under `data`), so its already
 * downloaded game files can be reused instead of downloading ~700 MB again.
 */
export async function findOfficialClientData(): Promise<OfficialClientData | null> {
  let baseDirectory = defaultBaseDirectory();
  let featuredModCacheDirectory: string | null = null;
  const appData = process.env.APPDATA;
  if (appData) {
    try {
      const prefs = asObject(JSON.parse(await readFile(path.join(appData, 'Forged Alliance Forever', 'client.prefs'), 'utf8')));
      const data = asObject(prefs?.data);
      baseDirectory = asString(data?.baseDataDirectory) ?? baseDirectory;
      featuredModCacheDirectory = asString(data?.featuredModCacheDirectory);
    } catch {
      // No official client settings, fall back to its default location.
    }
  }
  if (!(await pathExists(baseDirectory))) {
    return null;
  }
  return {
    baseDirectory,
    featuredModCacheDirectory: featuredModCacheDirectory ?? path.join(baseDirectory, 'cache', 'featured_mod'),
  };
}

/** Candidate copies of a featured mod file in the official client's folders; the caller verifies the MD5. */
export function officialFileCandidates(data: OfficialClientData, group: string, name: string, md5: string): string[] {
  return [path.join(data.baseDirectory, group, name), path.join(data.featuredModCacheDirectory, group, md5)];
}
