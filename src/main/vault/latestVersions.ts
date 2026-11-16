import { asBoolean, asObject, asString, type Resource } from '../api/jsonApi.ts';

/**
 * For each map or mod version in an API answer that includes its map's or mod's `latestVersion`: the name of that
 * latest version when it is a newer, visible one. Names are `folderName` for maps and `uid` for mods; the keys are the
 * current names in lower case.
 */
export function newerVersions(items: readonly Resource[], parent: 'map' | 'mod', name: 'folderName' | 'uid'): Map<string, string> {
  const newer = new Map<string, string>();
  for (const item of items) {
    const current = asString(item[name]);
    const latest = asObject(asObject(item[parent])?.latestVersion);
    const latestName = asString(latest?.[name]);
    if (
      current &&
      latestName &&
      latestName.toLowerCase() !== current.toLowerCase() &&
      !asBoolean(latest?.hidden) &&
      Number(latest?.id) > Number(item.id)
    ) {
      newer.set(current.toLowerCase(), latestName);
    }
  }
  return newer;
}
