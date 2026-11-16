// The steps each kind of game start shows (launchStages.ts) before Forged Alliance runs, and what the current-game tab
// shows of the game.

import type { LocalFilesCheck } from '../../shared/contract.ts';
import { t } from '../i18n.ts';
import { isGeneratedMap, type RawGame } from '../lobby/lobbyProtocol.ts';
import type { MapService } from '../vault/mapService.ts';
import type { GameDetails } from './gameRunnerTypes.ts';
import { isBuiltInMod } from './gameVault.ts';
import type { StagePlan } from './launchStages.ts';

export const filesStage = (): StagePlan => ({ id: 'files', title: t('main.game.stages.files') });
export const modsStage = (): StagePlan => ({ id: 'mods', title: t('main.game.stages.mods') });
export const mapStage = (): StagePlan => ({ id: 'map', title: t('main.game.stages.map') });
export const generatedMapStage = (): StagePlan => ({ id: 'map', title: t('main.game.stages.generatedMap') });
export const adapterStage = (): StagePlan => ({ id: 'adapter', title: t('main.game.stages.adapter') });
export const verifyStage = (): StagePlan => ({ id: 'verify', title: t('main.game.stages.verify') });
export const startStage = (): StagePlan => ({ id: 'start', title: t('main.game.stages.start') });
export const serverJoinStage = (): StagePlan => ({ id: 'server', title: t('main.game.stages.joinOnServer') });
export const lobbyStage = (): StagePlan => ({ id: 'lobby', title: t('main.game.stages.lobby') });
export const openLobbyStage = (): StagePlan => ({ id: 'start', title: t('main.game.stages.openLobby') });

/**
 * The sim mods of a lobby game to download. The game always has those of its mods.scd, and the FAF vault even holds
 * a different mod under Resource Rich's uid (gameVault.ts).
 */
export function gameSimMods(game: RawGame): string[] {
  return game.simMods.map((mod) => mod.uid).filter((uid) => !isBuiltInMod(uid));
}

/** Steps that bring the files of a lobby game up to date, side by side, then check them against the vault. */
export function preparePlan(mapFolderName: string, simModUids: string[], adapter: unknown): StagePlan[] {
  return [
    filesStage(),
    ...(simModUids.length > 0 ? [modsStage()] : []),
    ...(mapFolderName ? [isGeneratedMap(mapFolderName) ? generatedMapStage() : mapStage()] : []),
    ...(adapter ? [adapterStage()] : []),
    verifyStage(),
  ];
}

export function gameDetails(
  maps: Pick<MapService, 'previewUrls'>,
  featuredMod: string,
  mapFolderName: string | null,
  localFiles: LocalFilesCheck,
): GameDetails {
  return { featuredMod, map: mapDetails(maps, mapFolderName), localFiles };
}

export function mapDetails(maps: Pick<MapService, 'previewUrls'>, mapFolderName: string | null): GameDetails['map'] {
  if (!mapFolderName) {
    return null;
  }
  const previews = maps.previewUrls(mapFolderName);
  return { folderName: mapFolderName, previewUrl: previews?.small ?? null, previewLargeUrl: previews?.large ?? null };
}
