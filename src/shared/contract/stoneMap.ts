// StoneMap, the map generator of TFAF. The main process runs its local API and keeps the API's token; the renderer
// reaches the API only through these calls. Requests and results keep the API's own shapes (src/shared/stoneMap).

import type { Job, MapAdjustments, MapPresentation } from '../stoneMap/contracts.ts';

export type {
  AdjustmentDelete,
  AdjustmentMove,
  AdjustmentPlacementMap,
  AdjustmentPlacementRequest,
  AdjustmentScene,
  GenerationCapabilities,
  GenerationRequest,
  Job as StoneMapJob,
  MapAdjustments,
  MapFile,
  MapPresentation,
  MapResources,
  MapResult,
  NavigationReport,
  PreviewOptions,
  ReclaimPoint,
  ResolvedParameters,
} from '../stoneMap/contracts.ts';

/** `stopped`: not started yet, or stopped after a failure; the next call starts it again. */
export type StoneMapPhase = 'stopped' | 'installing' | 'starting' | 'ready';

export interface StoneMapState {
  phase: StoneMapPhase;
  /** Why the last start failed or the API stopped on its own; null after a clean start. */
  error: string | null;
  /** The pinned StoneMap build of this launcher. */
  buildId: string;
  /** The build is on disk; otherwise the first start downloads it. */
  downloaded: boolean;
}

/** About how much the first start downloads. */
export const STONEMAP_DOWNLOAD_MB = 50;

export interface StoneMapJobList {
  jobs: Job[];
  workerConcurrency: number;
  queueCapacity: number;
}

export interface StoneMapTextureAssets {
  /** The folder the textures preview reads game textures from; null shows the materials in plain colours. */
  directory: string | null;
  textures: number;
  revision: string;
}

export interface StoneMapTextureLayer {
  layer: number;
  path: string;
  scale: number;
  color: string;
}

export interface StoneMapSavedMap {
  /** The map's folder in the maps folder of the vault. */
  folderName: string;
  /** The folder was there already: the same recipe, text and adjustments make the same folder name. */
  existed: boolean;
}

/**
 * What a TFAF room says about a StoneMap map, so that a player without it makes it: the folder name of such a map is
 * a hash of its recipe and cannot be turned back into one.
 */
export interface StoneMapRecipe {
  /** The StoneMap build of the host; another build may make another map from the same recipe. */
  build: string;
  /** `stonemap_map_generator_…`, as `generation.json` of the map holds it. */
  mapName: string;
  presentation: MapPresentation | null;
  adjustments: MapAdjustments | null;
}

const STONEMAP_FOLDER = /^stonemap_\d{3,4}_[0-9a-f]{16}$/i;

/** A map folder StoneMap made: `stonemap_<size>_<hash>`. */
export function isStoneMapFolder(folderName: string): boolean {
  return STONEMAP_FOLDER.test(folderName);
}

/** The most jobs one list asks for; the API keeps no more. */
export const STONEMAP_MAX_JOBS = 256;
/** The largest request the API accepts (adjustment drafts of maps with many markers). */
export const STONEMAP_MAX_REQUEST_BYTES = 1024 * 1024;
export const STONEMAP_PREVIEW_SIZE = { min: 128, max: 2048 } as const;
export const STONEMAP_PRESENTATION_LIMITS = { name: 80, description: 2000 } as const;
