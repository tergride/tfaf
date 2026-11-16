import type { HostGameOptions, LobbyNotice } from '../../shared/contract.ts';
import { describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import type { SettingsStore } from '../settings.ts';
import type { MapService } from '../vault/mapService.ts';
import type { ModService } from '../vault/modService.ts';

export interface HostedContent {
  mapFolderName: string;
  modUids: string[];
}

export interface LatestContentDependencies {
  settings: Pick<SettingsStore, 'get'>;
  maps: Pick<MapService, 'newerVersion'>;
  mods: Pick<ModService, 'newerVersions'>;
  notice(style: LobbyNotice['style'], text: string): void;
  /** Newer versions were found, so the saved form can follow. */
  onUpdated(chosen: HostedContent, latest: HostedContent): void;
}

/**
 * The latest vault versions of the chosen map and sim mods, which the official client hosts with by default. Older
 * versions stay installed: replays need them. Without the API the game goes on with what was chosen.
 */
export async function latestContent(options: HostGameOptions, deps: LatestContentDependencies): Promise<HostedContent> {
  const chosen = { mapFolderName: options.mapFolderName, modUids: options.modUids };
  if (!deps.settings.get().updateContentOnHost) {
    return chosen;
  }
  let newerMap: string | null;
  let newerMods: Map<string, string>;
  try {
    [newerMap, newerMods] = await Promise.all([deps.maps.newerVersion(options.mapFolderName), deps.mods.newerVersions(options.modUids)]);
  } catch (error) {
    console.warn('Newer map and mod versions could not be looked up', describeError(error));
    deps.notice('warning', t('main.game.latestContentUnknown', { error: describeError(error) }));
    return chosen;
  }
  const latest = {
    mapFolderName: newerMap ?? options.mapFolderName,
    modUids: options.modUids.map((uid) => newerMods.get(uid.toLowerCase()) ?? uid),
  };
  if (newerMap) {
    console.info(`Hosting with the newer map version ${newerMap} instead of ${options.mapFolderName}`);
    deps.notice('info', t('main.game.newerMap', { map: newerMap }));
  }
  if (newerMods.size > 0) {
    console.info(`Hosting with newer versions of ${newerMods.size} mods`);
    deps.notice('info', t('main.game.newerMods', { count: newerMods.size }));
  }
  if (newerMap || newerMods.size > 0) {
    deps.onUpdated(chosen, latest);
  }
  return latest;
}
