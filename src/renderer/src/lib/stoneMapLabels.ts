// Names of StoneMap's settings and job states for the interface. The API's own identifiers stay as they are; a value
// this launcher does not know yet is shown as the identifier itself.

import type { MessageKey } from '../../../shared/i18n/index.ts';
import type {
  BiomeLayout,
  BiomeName,
  JobStatus,
  MountainStructure,
  NavigationProfile,
  PreviewKind,
  ReliefProfile,
  ResourceDistribution,
  ShorelineStyle,
  SpawnIslandMode,
  SymmetryPattern,
  TerrainDetailMode,
  TopologyKind,
} from '../../../shared/stoneMap/contracts.ts';
import { t } from './i18n.ts';

const BIOMES: Record<BiomeName, MessageKey> = {
  BRIMSTONE: 'stoneMap.biomes.BRIMSTONE',
  DESERT: 'stoneMap.biomes.DESERT',
  EARLYAUTUMN: 'stoneMap.biomes.EARLYAUTUMN',
  FRITHEN: 'stoneMap.biomes.FRITHEN',
  MARS: 'stoneMap.biomes.MARS',
  MOONLIGHT: 'stoneMap.biomes.MOONLIGHT',
  PRAYER: 'stoneMap.biomes.PRAYER',
  STONES: 'stoneMap.biomes.STONES',
  SUNSET: 'stoneMap.biomes.SUNSET',
  SYRTIS: 'stoneMap.biomes.SYRTIS',
  WINDINGRIVER: 'stoneMap.biomes.WINDINGRIVER',
  WONDER: 'stoneMap.biomes.WONDER',
  CRYSTALLINE: 'stoneMap.biomes.CRYSTALLINE',
};

const TOPOLOGIES: Record<TopologyKind, MessageKey> = {
  LAND: 'stoneMap.topologies.LAND',
  ISLAND: 'stoneMap.topologies.ISLAND',
  ARCHIPELAGO: 'stoneMap.topologies.ARCHIPELAGO',
  MIXED: 'stoneMap.topologies.MIXED',
  LAKE: 'stoneMap.topologies.LAKE',
  LAKES: 'stoneMap.topologies.LAKES',
  CALDERA: 'stoneMap.topologies.CALDERA',
};

const PATTERNS: Record<SymmetryPattern, MessageKey> = {
  CLASSIC: 'stoneMap.patterns.CLASSIC',
  S_CURVE: 'stoneMap.patterns.S_CURVE',
  SPIRAL: 'stoneMap.patterns.SPIRAL',
  PAIRED_ISLANDS: 'stoneMap.patterns.PAIRED_ISLANDS',
  QUADRANTS: 'stoneMap.patterns.QUADRANTS',
  LAYERED: 'stoneMap.patterns.LAYERED',
  ASYMMETRIC: 'stoneMap.patterns.ASYMMETRIC',
};

const PATTERN_HINTS: Partial<Record<SymmetryPattern, MessageKey>> = {
  S_CURVE: 'stoneMap.patternHints.S_CURVE',
  SPIRAL: 'stoneMap.patternHints.SPIRAL',
  PAIRED_ISLANDS: 'stoneMap.patternHints.PAIRED_ISLANDS',
  QUADRANTS: 'stoneMap.patternHints.QUADRANTS',
  LAYERED: 'stoneMap.patternHints.LAYERED',
  ASYMMETRIC: 'stoneMap.patternHints.ASYMMETRIC',
};

const SHORES: Record<ShorelineStyle, MessageKey> = {
  DEFAULT: 'stoneMap.shores.DEFAULT',
  GENTLE: 'stoneMap.shores.GENTLE',
  STEEP: 'stoneMap.shores.STEEP',
  CLIFF: 'stoneMap.shores.CLIFF',
  MIXED: 'stoneMap.shores.MIXED',
};

const MOUNTAINS: Record<MountainStructure, MessageKey> = {
  ALL: 'stoneMap.mountains.ALL',
  CLASSIC: 'stoneMap.mountains.CLASSIC',
  BRANCHED: 'stoneMap.mountains.BRANCHED',
  PLATEAU: 'stoneMap.mountains.PLATEAU',
  MIXED: 'stoneMap.mountains.MIXED',
};

const DISTRIBUTIONS: Record<ResourceDistribution, MessageKey> = {
  BALANCED: 'stoneMap.distributions.BALANCED',
  GROUPED: 'stoneMap.distributions.GROUPED',
  SCATTERED: 'stoneMap.distributions.SCATTERED',
  LINEAR: 'stoneMap.distributions.LINEAR',
  CENTER_BIASED: 'stoneMap.distributions.CENTER_BIASED',
  EDGE_BIASED: 'stoneMap.distributions.EDGE_BIASED',
};

const ISLAND_MODES: Record<SpawnIslandMode, MessageKey> = {
  AUTO: 'stoneMap.islandModes.AUTO',
  PER_SPAWN: 'stoneMap.islandModes.PER_SPAWN',
  PER_TEAM: 'stoneMap.islandModes.PER_TEAM',
  SHARED: 'stoneMap.islandModes.SHARED',
  TEAM_GROUPS: 'stoneMap.islandModes.TEAM_GROUPS',
};

const LAYOUTS: Record<BiomeLayout, MessageKey> = {
  GRADIENT: 'stoneMap.layouts.GRADIENT',
  SECTORS: 'stoneMap.layouts.SECTORS',
  PATCHES: 'stoneMap.layouts.PATCHES',
};

const RELIEF_PROFILES: Record<ReliefProfile, MessageKey> = {
  GLACIAL: 'stoneMap.reliefProfiles.GLACIAL',
  VOLCANIC: 'stoneMap.reliefProfiles.VOLCANIC',
  ARID: 'stoneMap.reliefProfiles.ARID',
};

const TERRAIN_MODES: Record<TerrainDetailMode, MessageKey> = {
  STANDARD: 'stoneMap.terrainModes.STANDARD',
  REALISM: 'stoneMap.terrainModes.REALISM',
};

const NAVIGATION: Record<NavigationProfile, MessageKey> = {
  OFF: 'stoneMap.navigationProfiles.OFF',
  SMALL: 'stoneMap.navigationProfiles.SMALL',
  LARGE: 'stoneMap.navigationProfiles.LARGE',
  EXPERIMENTAL: 'stoneMap.navigationProfiles.EXPERIMENTAL',
};

const PROP_STYLES: Record<string, MessageKey> = {
  BASIC: 'stoneMap.propStyles.BASIC',
  SMALL_BATTLE: 'stoneMap.propStyles.SMALL_BATTLE',
  LARGE_BATTLE: 'stoneMap.propStyles.LARGE_BATTLE',
};

const STATUSES: Record<JobStatus, MessageKey> = {
  queued: 'stoneMap.statuses.queued',
  running: 'stoneMap.statuses.running',
  cancelling: 'stoneMap.statuses.cancelling',
  completed: 'stoneMap.statuses.completed',
  cancelled: 'stoneMap.statuses.cancelled',
  failed: 'stoneMap.statuses.failed',
};

const STAGES: Record<string, MessageKey> = {
  adjustments: 'stoneMap.stages.adjustments',
  queued: 'stoneMap.stages.queued',
  starting: 'stoneMap.stages.starting',
  terrain: 'stoneMap.stages.terrain',
  resources: 'stoneMap.stages.resources',
  navigation: 'stoneMap.stages.navigation',
  textures: 'stoneMap.stages.textures',
  props: 'stoneMap.stages.props',
  preview: 'stoneMap.stages.preview',
  export: 'stoneMap.stages.export',
  apiPreviews: 'stoneMap.stages.apiPreviews',
  completed: 'stoneMap.stages.completed',
  cancelled: 'stoneMap.stages.cancelled',
  failed: 'stoneMap.stages.failed',
};

const PREVIEW_KINDS: Record<PreviewKind, MessageKey> = {
  map: 'stoneMap.preview.kinds.map',
  textures: 'stoneMap.preview.kinds.textures',
  terrain: 'stoneMap.preview.kinds.terrain',
  resources: 'stoneMap.preview.kinds.resources',
  heightmap: 'stoneMap.preview.kinds.heightmap',
};

function from<K extends string>(labels: Partial<Record<K, MessageKey>>, value: string): string {
  const key = labels[value as K];
  return key ? t(key) : value;
}

export const biomeLabel = (value: string): string => from(BIOMES, value);
export const topologyLabel = (value: string): string => from(TOPOLOGIES, value);
export const patternLabel = (value: string): string => from(PATTERNS, value);
export const patternHint = (value: SymmetryPattern): string | null => (PATTERN_HINTS[value] ? t(PATTERN_HINTS[value]) : null);
export const shoreLabel = (value: string): string => from(SHORES, value);
export const mountainLabel = (value: string): string => from(MOUNTAINS, value);
export const distributionLabel = (value: string): string => from(DISTRIBUTIONS, value);
export const islandModeLabel = (value: string): string => from(ISLAND_MODES, value);
export const layoutLabel = (value: string): string => from(LAYOUTS, value);
export const reliefProfileLabel = (value: string): string => from(RELIEF_PROFILES, value);
export const terrainModeLabel = (value: string): string => from(TERRAIN_MODES, value);
export const navigationLabel = (value: string): string => from(NAVIGATION, value);
export const propStyleLabel = (value: string): string => from(PROP_STYLES, value);
export const statusLabel = (value: string): string => from(STATUSES, value);
export const stageLabel = (value: string): string => from(STAGES, value);
export const previewKindLabel = (value: string): string => from(PREVIEW_KINDS, value);

/** A map edge in game units as kilometres: 512 is 10 × 10 km. */
export function mapSizeLabel(size: number): string {
  const km = Number((size / 51.2).toFixed(2));
  return t('stoneMap.mapSize', { km });
}
