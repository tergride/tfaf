// Types of the StoneMap local API, generated from its C# contracts (sdk/javascript/contracts.generated.d.mts of StoneMap
// commit 073cd39) and copied unchanged below this header. Update them together with the pinned build in
// src/main/stoneMap/stoneMapBuild.ts.

export interface AdjustmentDelete {
  draft: MapAdjustments;
  id: string;
}

export interface AdjustmentGroup {
  id: string;
  members: (AdjustmentMember)[];
  error: string | null;
}

export interface AdjustmentIssue {
  objectId: string;
  message: string;
}

export interface AdjustmentMember {
  id: string;
  operations: (number)[];
}

export interface AdjustmentMove {
  draft: MapAdjustments;
  id: string;
  x: number;
  z: number;
}

export interface AdjustmentObject {
  id: string;
  kind: string;
  name: string;
  x: number;
  z: number;
  teamId: number | null;
  ownerSpawnId: string | null;
  isDeleted: boolean;
}

export interface AdjustmentPlacementMap {
  version: number;
  mapSize: number;
  width: number;
  height: number;
  cellSize: number;
  blocked: string;
  scope: string;
}

export interface AdjustmentPlacementRequest {
  draft: MapAdjustments;
  id: string;
}

export interface AdjustmentPosition {
  id: string;
  x: number;
  z: number;
}

export interface AdjustmentScene {
  version: number;
  mapSize: number;
  baseFingerprint: string;
  spawnSymmetry: string;
  teamSymmetry: string;
  objects: (AdjustmentObject)[];
  groups: (AdjustmentGroup)[];
  transforms: (AdjustmentTransform)[];
}

export interface AdjustmentTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  x: number;
  z: number;
}

export interface ApiError {
  code: string;
  message: string;
  issues?: (AdjustmentIssue)[] | null;
}

export interface ApiProgress {
  stage: string;
  percent: number;
  detail: string | null;
  completedOperations: number;
  totalOperations: number;
  isEstimated: boolean;
}

export interface BalancedMexReport {
  nearbyMexes: number;
  globalMexes: number;
  singleMexes: number;
  groupedMexes: number;
  singleFraction: number;
  approximateLargestEmptyRadius: number;
  spawns: (NearbyMexReport)[];
  islands: (MexIslandReport)[];
  territories: (MexTerritoryReport)[];
  sites: (MexSiteReport)[];
  scope: string;
  styledMexes: number;
  uniformMexes: number;
  hydros?: (HydroAccessReport)[] | null;
}

export interface BattleWreckObject {
  name: string;
  type: string;
  faction: string;
  tier: number;
  x: number;
  z: number;
  rotation: number;
  radius: number;
  mass: number;
}

export interface BattleWreckReport {
  version: number;
  maximumSites: number;
  massLimit: number;
  sites: (BattleWreckSite)[];
  skippedReasons: (string)[];
  scope: string;
  count: number;
  totalMass: number;
}

export interface BattleWreckSite {
  id: string;
  copy: number;
  domain: string;
  x: number;
  z: number;
  radius: number;
  firstTeam: number;
  secondTeam: number;
  firstPathDistance: number;
  secondPathDistance: number;
  central: boolean;
  factions: (string)[];
  objects: (BattleWreckObject)[];
  mass: number;
}

export interface BiomeCoverage {
  biome: string;
  fraction: number;
}

export type BiomeLayout = "GRADIENT" | "SECTORS" | "PATCHES";

export type BiomeName = "BRIMSTONE" | "DESERT" | "EARLYAUTUMN" | "FRITHEN" | "MARS" | "MOONLIGHT" | "PRAYER" | "STONES" | "SUNSET" | "SYRTIS" | "WINDINGRIVER" | "WONDER" | "CRYSTALLINE";

export interface CapabilityFeatures {
  battleWrecks: boolean;
  battleWreckMaximumSites: Record<string, number>;
  battleWreckMassLimit: ParameterRange;
  coastalDetails: boolean;
  waterSlopeDetails: boolean;
  coastalCliffRocks: boolean;
  coastalCliffTrees: boolean;
  coastalCliffMaterials: boolean;
  increasedDecals: boolean;
  coastalCliffRockDensity: ParameterRange;
  compactCoastalWreckGroups: boolean;
  mountainStructures: (string)[];
  erosionStrength: ParameterRange;
  naturalLandBridges: boolean;
  decoration: CapabilityFeaturesDecoration;
  adaptiveVegetation: boolean;
  seabedRelief: boolean;
  seabedChannels: boolean;
  seabedBanks: boolean;
  seabedGeology: boolean;
  seabedMaterials: boolean;
  seabedDetails: boolean;
  complexRelief: boolean;
  reliefProfiles: (string)[];
  forestEcology: boolean;
  environmentZones: boolean;
  enhancedPreview: boolean;
  naturalEnvironment: boolean;
  reefs: boolean;
  settlements: boolean;
  settlementWalls: boolean;
  baseMexGrid: boolean;
  boostReclaim: boolean;
  fillMountainHollows: boolean;
  sunAzimuth: boolean;
  plainForests: boolean;
  coastalWrecks: boolean;
  coastalWreckGroups: boolean;
  navalNavigation: CapabilityFeaturesNavalNavigation;
  teamSpawnSeparation: ParameterRange;
  minimumTeamSpawnDistance: ParameterRange;
  maximumTeamSpawnDistance: ParameterRange;
  navigationUnitsPerRow: ParameterRange;
  asymmetricResourceBalance: string;
}

export interface CapabilityFeaturesDecoration {
  independentSymmetry: boolean;
  minimumBiomes: number;
  maximumBiomes: number;
  layouts: (string)[];
  transitionWidth: ParameterRange;
  sharedWaterAndLighting: boolean;
}

export interface CapabilityFeaturesNavalNavigation {
  radius: number;
  draft: number;
  withinEachWaterBody: boolean;
}

export interface CapabilityPreviewQualities {
  low: number;
  medium: number;
  high: number;
  ultra: number;
}

export interface CapabilityResourcePlacement {
  minimumMexesPerSpawn: ParameterRange;
  mexesOutsideSpawns: ParameterRange;
  nearbyMexesPerSpawn: ParameterRange;
  balancedDefault: boolean;
  fairAccessDefault: boolean;
  fairAccessScope: string;
  globalSingleFraction: number;
  globalGroupSize: ParameterRange;
  styledFraction: number;
  uniformFraction: number;
  mixedDistributions: (string)[];
  minimumHydrosPerSpawn: ParameterRange;
  hydrosOutsideSpawns: ParameterRange;
  spawnRadius: number;
  balancedSpawnRadius: number;
  roundedToSymmetry: boolean;
  overridesResourceDensity: boolean;
  allowWaterMexes: boolean;
}

export interface CapabilityRivers {
  enabled: boolean;
  automaticOrigin: boolean;
  origins: (string)[];
  preservesLandComponents: boolean;
}

export interface CapabilitySpawnBuildArea {
  radius: ParameterRange;
  minimumFraction: ParameterRange;
  buildingSize: number;
  terrainOnly: boolean;
  individuallyOwned: boolean;
}

export interface CapabilitySymmetryPatternRulesItem {
  pattern: string;
  terrainSymmetry: string;
  spawnSymmetry: string;
  spawnMultiple: number;
  requiresRealism: boolean;
}

export interface CapabilityTopology {
  waterRatio: ParameterRange;
  landWaterRatio: number;
  landBridges: boolean;
  lakeKinds: (string)[];
  lakeWaterRatio: ParameterRange;
  calderaNeutralIsland: boolean;
  spawnFreeIslands: ParameterRange;
  relief: CapabilityTopologyRelief;
  omitted: string;
  connectivityWithoutBridges: string;
}

export interface CapabilityTopologyRelief {
  mode: string;
  mountainRatio: number;
  depressionRatio: number;
  maximumCombinedRatio: number;
  baseClearingsHavePriority: boolean;
  includesCoastalRidges: boolean;
}

export interface CoastalCliffRocksReport {
  large: number;
  medium: number;
  small: number;
  trees: number;
}

export interface CoastalDetailReport {
  changedSamples: number;
  beachSamples: number;
  rockySamples: number;
  sandbankSamples: number;
  ridgeSamples: number;
}

export interface ComplexReliefReport {
  version: number;
  profiles: (string)[];
  regions: (GeologicalRegion)[];
  forms: (GeologicalForm)[];
  changedCoastSamples: number;
  protectedSamples: number;
  intentionalBasinSamples: number;
  actualWaterRatio: number;
  scope: string;
}

export interface CustomStyleSettings {
  terrainStyle?: string;
  biome?: string;
  resourceStyle?: string;
  propStyle?: string;
  reclaimDensity?: number;
  resourceDensity?: number;
}

export interface DecorationMaterial {
  biome: string;
  role: string;
  path: string;
  scale: number;
  normalPath: string;
  normalScale: number;
  previewColor: string;
  terrainType: number;
}

export interface DecorationOptions {
  symmetry: Symmetry;
  primaryBiome: BiomeName;
  secondaryBiome: BiomeName;
  thirdBiome: BiomeName | null;
  layout: BiomeLayout;
  transitionWidth: number;
  rotation: number;
}

export interface DecorationReport {
  settings: DecorationOptions;
  materials: (DecorationMaterial)[];
  coverage: (BiomeCoverage)[];
  scope: string;
}

export interface DecorationSettings {
  symmetry?: string;
  primaryBiome?: string;
  secondaryBiome?: string;
  thirdBiome?: string | null;
  layout?: BiomeLayout;
  transitionWidth?: number;
  rotation?: number;
}

export interface EditorSettingsProfile {
  displayName: string;
  mapDescription: string;
  seed: string;
  randomize: (string)[];
  mapSize: number;
  spawnCount: number;
  numTeams: number;
  symmetry: string;
  kind: TopologyKind;
  water: number;
  bridges: boolean;
  pattern: SymmetryPattern;
  shoreline: ShorelineStyle;
  terrainMode: TerrainDetailMode;
  freeIslands: number;
  mountains: number;
  depressions: number;
  biome: string;
  props: string;
  resourceDensity: number;
  reclaimDensity: number;
  baseMexGrid: boolean;
  boostReclaim: boolean;
  battleWrecks: boolean;
  battleWreckMassLimit: number;
  resourceExplicit: boolean;
  baseMex: number;
  nearbyMex: number;
  outsideMex: number;
  baseHydro: number;
  outsideHydro: number;
  distribution: ResourceDistribution;
  waterMex: boolean;
  navigation: NavigationProfile;
  heightScale: number;
  heightOffset: number;
  plainForests: boolean;
  coastalWrecks: boolean;
  navalNavigation: boolean;
  teamSpread: number;
  minimumTeamSpawnDistance: number | null;
  maximumTeamSpawnDistance: number | null;
  spawnBuildArea: boolean;
  spawnBuildRadius: number;
  spawnBuildPercent: number;
  spawnIslandMode: SpawnIslandMode;
  maxPlayersPerIsland: number;
  rivers: boolean;
  enemyIslandConnections: number;
  navigationUnitsPerRow: number;
  edgeContactChance: number;
  coastalDetails: boolean;
  increasedDecals: boolean;
  waterSlopeDetails: boolean;
  mountainStructure: MountainStructure;
  erosion: number;
  adaptiveVegetation: boolean;
  seabedRelief: boolean;
  seabedChannels: boolean;
  seabedBanks: boolean;
  seabedGeology: boolean;
  seabedMaterials: boolean;
  seabedDetails: boolean;
  complexRelief: boolean;
  reliefProfiles: (ReliefProfile)[];
  forestEcology: boolean;
  environmentZones: boolean;
  enhancedPreview: boolean;
  naturalEnvironment: boolean;
  reefs: boolean;
  settlements: boolean;
  fillMountainHollows: boolean;
  sunAzimuth: number | null;
  naturalBridges: boolean;
  decoration: boolean;
  decorationSymmetry: string;
  decorationPrimary: string;
  decorationSecondary: string;
  decorationThird: string;
  decorationLayout: BiomeLayout;
  decorationTransition: number;
  decorationRotation: number;
}

export interface FeatureSettings {
  increasedDecals?: boolean;
  battleWrecks?: boolean;
  battleWreckMassLimit?: number;
  plainForests?: boolean;
  coastalWrecks?: boolean;
  coastalWreckGroups?: boolean | null;
  compactCoastalWreckGroups?: boolean | null;
  navalNavigation?: boolean;
  teamSpawnSeparation?: number | null;
  minimumTeamSpawnDistance?: number | null;
  maximumTeamSpawnDistance?: number | null;
  navigationUnitsPerRow?: number;
  coastalDetails?: boolean;
  waterSlopeDetails?: boolean;
  coastalCliffRocks?: boolean | null;
  coastalCliffTrees?: boolean | null;
  coastalCliffMaterials?: boolean | null;
  coastalCliffRockDensity?: number | null;
  mountainStructure?: MountainStructure;
  erosionStrength?: number;
  adaptiveVegetation?: boolean;
  seabedRelief?: boolean;
  seabedChannels?: boolean;
  seabedBanks?: boolean;
  seabedGeology?: boolean;
  seabedMaterials?: boolean;
  seabedDetails?: boolean;
  complexRelief?: boolean;
  reliefProfiles?: (ReliefProfile)[];
  forestEcology?: boolean;
  environmentZones?: boolean;
  enhancedPreview?: boolean;
  naturalEnvironment?: boolean;
  reefs?: boolean;
  settlements?: boolean;
  settlementWalls?: boolean | null;
  baseMexGrid?: boolean;
  boostReclaim?: boolean;
  fillMountainHollows?: boolean;
  sunAzimuth?: number | null;
  naturalLandBridges?: boolean;
  decoration?: DecorationSettings | null;
}

export interface GenerationCapabilities {
  apiVersion: string;
  workerConcurrency: number;
  queueCapacity: number;
  maxRetainedJobs: number;
  mapSizes: (number)[];
  spawnCount: ParameterRange;
  terrainStyles: (string)[];
  biomes: (string)[];
  resourceStyles: (string)[];
  propStyles: (string)[];
  predefinedStyles: (string)[];
  terrainSymmetries: (Symmetry)[];
  navigationProfiles: (NavigationProfile)[];
  topologyKinds: (TopologyKind)[];
  symmetryPatterns: (SymmetryPattern)[];
  shorelineStyles: (ShorelineStyle)[];
  spawnIslandModes: (SpawnIslandMode)[];
  maxPlayersPerIsland: ParameterRange;
  enemyIslandConnections: ParameterRange;
  edgeContactChance: ParameterRange;
  randomSpawnFreeIslands: ParameterRange;
  rivers: CapabilityRivers;
  resourceDistributions: (ResourceDistribution)[];
  features: CapabilityFeatures;
  spawnBuildArea: CapabilitySpawnBuildArea;
  randomizationFields: (string)[];
  resourcePlacement: CapabilityResourcePlacement;
  symmetryPatternRules: (CapabilitySymmetryPatternRulesItem)[];
  terrainDetailModes: (TerrainDetailMode)[];
  topology: CapabilityTopology;
  previewKinds: (PreviewKind)[];
  previewQualities: CapabilityPreviewQualities;
  previewSize: ParameterRange;
  defaults: GenerationRequest;
  notes: (string)[];
  parameterCatalog: (GenerationParameter)[];
  profiles: GenerationProfiles;
}

export interface GenerationParameter {
  path: string;
  kind: string;
  randomizable: boolean;
  controlId: string | null;
  apiDefault: unknown | null;
  range: ParameterRange | null;
  values: (string)[] | null;
}

export interface GenerationProfiles {
  api: GenerationRequest;
  legacyCli: LegacyCliProfile;
  editor: EditorSettingsProfile;
}

export interface GenerationRequest {
  mapName?: string | null;
  adjustments?: MapAdjustments | null;
  settings?: GenerationSettings | null;
  preview?: PreviewRequest;
  presentation?: MapPresentation | null;
}

export interface GenerationSettings {
  randomize?: (string)[] | null;
  seed?: string | null;
  mapSize?: number;
  spawnCount?: number;
  numTeams?: number;
  terrainSymmetry?: string;
  style?: string | null;
  customStyle?: CustomStyleSettings | null;
  heightScale?: number;
  heightOffset?: number;
  navigationProfile?: NavigationProfile;
  topology?: TopologySettings | null;
  resourcePlacement?: ResourcePlacementSettings | null;
  features?: FeatureSettings | null;
  spawnBuildArea?: SpawnBuildAreaSettings | null;
}

export interface GeologicalForm {
  profile: string;
  x: number;
  z: number;
  radius: number;
  direction: number;
  wet: boolean;
}

export interface GeologicalRegion {
  profile: string;
  landSamples: number;
  fraction: number;
}

export interface HeightmapInfo {
  width: number;
  height: number;
  scale: number;
  sampleType: string;
  sha256: string;
  minimum: number;
  maximum: number;
}

export interface HydroAccessReport {
  spawn: string;
  hydros: number;
  minimumPathDistance: number | null;
  maximumPathDistance: number | null;
}

export interface Job {
  id: string;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  parameters: ResolvedParameters;
  progress: ApiProgress;
  sequence: number;
  error: ApiError | null;
  hasAdjustments: boolean;
  terminal: boolean;
}

export type JobStatus = "queued" | "running" | "cancelling" | "completed" | "cancelled" | "failed";

export interface LegacyCliProfile {
  mapSize: number;
  spawnCount: number;
  numTeams: number;
  heightScale: number;
  heightOffset: number;
  navigationProfile: NavigationProfile;
  terrainSymmetry: string | null;
  style: string | null;
  topology: TopologySettings | null;
  resourcePlacement: ResourcePlacementSettings | null;
  features: FeatureSettings | null;
}

export interface MapAdjustments {
  version: number;
  baseFingerprint: string;
  positions: (AdjustmentPosition)[];
  deletedIds?: (string)[] | null;
}

export interface MapCounts {
  spawns: number;
  mexes: number;
  hydros: number;
  props: number;
  units: number;
  decals: number;
}

export interface MapFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface MapPresentation {
  name?: string | null;
  description?: string | null;
}

export interface MapResources {
  spawns: (ResourcePoint)[];
  mexes: (ResourcePoint)[];
  hydros: (ResourcePoint)[];
  expansions: (ResourcePoint)[];
}

export interface MapResult {
  parameters: ResolvedParameters;
  generationSeconds: number;
  exportSeconds: number;
  totalSeconds: number;
  counts: MapCounts;
  heightmap: HeightmapInfo;
  resources: MapResources;
  files: (MapFile)[];
  defaultPreview: PreviewRequest;
  navigation: NavigationReport | null;
  topology: TopologyReport | null;
  resourcePlacement: ResourcePlacementReport | null;
  scenery: SceneryReport | null;
  navalNavigation: NavalNavigationReport | null;
  teamSpawnDistances: (TeamSpawnDistance)[] | null;
  reclaim: ReclaimSummary | null;
  decoration: DecorationReport | null;
  exportName: string | null;
  environment?: TerrainEnvironmentReport | null;
  reefs?: ReefReport | null;
  settlements?: SettlementReport | null;
  seabed?: SeabedReport | null;
  spawnBuildAreas?: (SpawnBuildAreaReport)[] | null;
  adjustments?: MapAdjustments | null;
}

export interface MexIslandReport {
  island: number;
  usableSamples: number;
  mexes: number;
  spawnCount: number;
}

export interface MexSiteReport {
  x: number;
  z: number;
  mexes: number;
  island: number;
  followsDistribution: boolean;
}

export interface MexTerritoryReport {
  spawn: string;
  nearbyMexes: number;
  globalMexes: number;
}

export interface MountainFootRocksReport {
  eligibleLength: number;
  coveredLength: number;
  large: number;
  small: number;
  targetCoverage: number;
  coverage: number;
}

export type MountainStructure = "CLASSIC" | "BRANCHED" | "PLATEAU" | "MIXED" | "ALL";

export interface MountainStructureReport {
  style: MountainStructure;
  mainChains: number;
  branches: number;
  saddles: number;
  plateauSamples: number;
  classicSamples: number;
  branchedSamples: number;
  roundedCrestSamples: number;
  sharpCrestSamples: number;
}

export interface NaturalBridgeReport {
  changedSamples: number;
  beachWidth: number;
  waterEntrySlope: number;
  shoreSamples: number;
  scope: string;
  shorelineStyle: ShorelineStyle;
  shoreline: ShorelineReport | null;
}

export interface NavalBodyReport {
  body: number;
  waterCells: number;
  navigableCells: number;
  majorRegions: number;
}

export interface NavalNavigationReport {
  radius: number;
  draft: number;
  changedSamples: number;
  bodies: (NavalBodyReport)[];
  allMajorAreasConnected: boolean;
  scope: string;
  generationAttempts: number;
  removedProps: number;
  removedWreckage: number;
  unitsPerRow: number;
  unitRadius: number;
  minimumPassageWidth: number;
  minimumWaterBodyArea: number;
}

export type NavigationProfile = "OFF" | "SMALL" | "LARGE" | "EXPERIMENTAL";

export interface NavigationProfileReport {
  profile: string;
  radius: number;
  walkableCells: number;
  components: number;
  largestComponentCells: number;
  reachableSpawns: number;
  spawnCount: number;
  reachableLandResources: number;
  landResources: number;
  excludedWaterResources: number;
  unreachableTargets: (string)[] | null;
  unitRadius: number;
  minimumPassageWidth: number;
  allRequiredReachable: boolean;
}

export interface NavigationReport {
  scope: string;
  selectedProfile: string;
  profiles: (NavigationProfileReport)[];
  rampChangedSamples: number;
  repairedRoutes: number;
  removedProps: number;
  removedWreckage: number;
  generationAttempts: number;
  obstacleModel: string;
  connectivity: string;
  unitsPerRow: number;
  unitGap: number;
}

export interface NearbyMexReport {
  spawn: string;
  mexes: number;
  minimumPathDistance: number;
  maximumPathDistance: number;
  markers: (string)[];
}

export interface ParameterRange {
  appliesTo?: string | null;
  approximate?: boolean | null;
  default?: number | null;
  deterministicBySeed?: boolean | null;
  editorDefault?: number | null;
  enabled?: boolean | null;
  isolatedFromBridges?: boolean | null;
  maximum: number;
  minimum: number;
  requires?: string | null;
  requiresRealism?: boolean | null;
  scope?: string | null;
  symmetryMayAddMore?: boolean | null;
  unitGap?: number | null;
}

export type PreviewKind = "map" | "terrain" | "resources" | "heightmap" | "textures";

export interface PreviewOptions {
  kind?: PreviewKind;
  quality?: PreviewQuality;
  size?: number | null;
  markers?: boolean;
  contours?: boolean;
  reclaim?: boolean;
  waterContours?: boolean;
  waterSurface?: boolean;
}

export type PreviewQuality = "low" | "medium" | "high" | "ultra";

export interface PreviewRequest {
  quality?: PreviewQuality;
  size?: number | null;
  kinds?: (PreviewKind)[];
  markers?: boolean;
  contours?: boolean;
  reclaim?: boolean;
  waterContours?: boolean;
  waterSurface?: boolean;
}

export interface ReclaimPoint {
  x: number;
  z: number;
  mass: number;
  estimated: boolean;
  kind: string;
}

export interface ReclaimSummary {
  objects: number;
  totalMass: number;
  estimatedObjects: number;
  knownMass: number;
  cellSize: number;
  legendMaximumMass: number;
}

export interface ReefReport {
  version: number;
  count: number;
  changedSamples: number;
  requestedCount: number;
  minimumPassageWidth: number;
  sites: (ReefSite)[];
  skippedReason: string | null;
  scope: string;
}

export interface ReefSite {
  x: number;
  z: number;
  radius: number;
  peakDepth: number;
  shape: string;
  vegetated: boolean;
}

export type ReliefProfile = "GLACIAL" | "VOLCANIC" | "ARID";

export interface ResolvedParameters {
  mapName: string;
  seed: string;
  mapSize: number;
  spawnCount: number;
  numTeams: number;
  terrainSymmetry: string;
  teamSymmetry: string;
  spawnSymmetry: string;
  terrainStyle: string;
  biome: string;
  resourceStyle: string;
  propStyle: string;
  heightScale: number;
  heightOffset: number;
  navigationProfile: NavigationProfile;
  style: string | null;
  customStyle: Required<CustomStyleSettings> | null;
  selectedMapStyle: string | null;
  topology: Required<TopologySettings> | null;
  resourcePlacement: Required<ResourcePlacementSettings> | null;
  features: Required<FeatureSettings> | null;
  presentation: MapPresentation | null;
  spawnBuildArea?: Required<SpawnBuildAreaSettings> | null;
}

export type ResourceDistribution = "GROUPED" | "SCATTERED" | "LINEAR" | "CENTER_BIASED" | "EDGE_BIASED" | "BALANCED";

export interface ResourcePlacementReport {
  distribution: ResourceDistribution;
  spawnRadius: number;
  minimumMexesPerSpawn: number;
  minimumHydrosPerSpawn: number;
  requestedMexesOutsideSpawns: number;
  mexesOutsideSpawns: number;
  requestedHydrosOutsideSpawns: number;
  hydrosOutsideSpawns: number;
  symmetryPoints: number;
  waterMexes: number;
  allowWaterMexes: boolean;
  spawns: (SpawnResourceCount)[];
  territories: (ResourceTerritoryCount)[] | null;
  balance: BalancedMexReport | null;
  mountainPocketMexes: number;
}

export interface ResourcePlacementSettings {
  minimumMexesPerSpawn?: number;
  mexesOutsideSpawns?: number;
  minimumHydrosPerSpawn?: number;
  hydrosOutsideSpawns?: number;
  distribution?: ResourceDistribution;
  nearbyMexesPerSpawn?: number;
  mixedDistribution?: boolean;
  fairAccess?: boolean;
  allowWaterMexes?: boolean;
}

export interface ResourcePoint {
  name: string;
  x: number;
  y: number;
  z: number;
  teamId: number | null;
}

export interface ResourceTerritoryCount {
  team: number;
  mexesOutsideSpawns: number;
  hydrosOutsideSpawns: number;
}

export interface RiverBankReport {
  bankEdges: number;
  gentleBankEdges: number;
  gentleFraction: number;
}

export interface RiverPoint {
  x: number;
  z: number;
}

export interface RiverSection {
  x: number;
  z: number;
  width: number;
  depth: number;
  groundElevation: number;
}

export interface SceneryReport {
  forestGroups: number;
  ships: number;
  shipyards: number;
  vegetation: VegetationReport | null;
  battleWrecks?: BattleWreckReport | null;
  shipyardGroups?: (ShipyardWreckGroup)[] | null;
  coastalCliffRocks?: CoastalCliffRocksReport | null;
  mountainFootRocks?: MountainFootRocksReport | null;
}

export interface SeabedBathymetryReport {
  relief: boolean;
  channels: boolean;
  banks: boolean;
  gridSize: number;
  basins: number;
  broadHighs: number;
  submergedBanks: number;
  ridges: number;
  mouthChannels: number;
  branches: number;
  changedSamples: number;
  raisedSamples: number;
  loweredSamples: number;
  depositSamples: number;
  maximumChange: number;
  scope: string;
}

export interface SeabedGeologyReport {
  changedSamples: number;
  raisedSamples: number;
  loweredSamples: number;
  maximumChange: number;
  scope: string;
}

export interface SeabedReport {
  version: number;
  geology: boolean;
  materials: boolean;
  details: boolean;
  gridSize: number;
  waterSamples: number;
  meanDepth: number;
  sandFraction: number;
  siltFraction: number;
  gravelFraction: number;
  rockFraction: number;
  decalPatches: number;
  localAssets: number;
  geometry: SeabedGeologyReport | null;
  scope: string;
  bathymetry?: SeabedBathymetryReport | null;
}

export interface SettlementBuilding {
  name: string;
  type: string;
  role: string;
  x: number;
  z: number;
  rotation: number;
  radius: number;
}

export interface SettlementReport {
  version: number;
  requestedCount: number;
  minimumSpawnDistance: number;
  sites: (SettlementSite)[];
  skippedReason: string | null;
  scope: string;
  count: number;
  units: number;
}

export interface SettlementSite {
  id: number;
  group: number;
  faction: string;
  factionIndex: number;
  x: number;
  z: number;
  radius: number;
  buildings: (SettlementBuilding)[];
}

export interface ShipyardWreckGroup {
  id: string;
  copy: number;
  faction: string;
  x: number;
  z: number;
  objects: (ShipyardWreckObject)[];
}

export interface ShipyardWreckObject {
  type: string;
  category: string;
  tier: number;
  x: number;
  z: number;
  rotation: number;
  radius: number;
  primary: boolean;
}

export interface ShorelineReport {
  style: string;
  coastSamples: number;
  gentleSamples: number;
  steepSamples: number;
  cliffSamples: number;
  scope: string;
}

export type ShorelineStyle = "DEFAULT" | "GENTLE" | "STEEP" | "CLIFF" | "MIXED";

export interface SpawnBuildAreaReport {
  spawn: string;
  radius: number;
  minimumFraction: number;
  circleArea: number;
  requiredArea: number;
  actualArea: number;
  actualFraction: number;
  height: number;
  heightDifference: number;
  buildingSize: number;
}

export interface SpawnBuildAreaSettings {
  radius?: number;
  minimumFraction?: number;
}

export type SpawnIslandMode = "AUTO" | "PER_SPAWN" | "PER_TEAM" | "SHARED" | "TEAM_GROUPS";

export interface SpawnResourceCount {
  spawn: string;
  mexes: number;
  hydros: number;
}

export type Symmetry = "POINT2" | "POINT3" | "POINT4" | "POINT5" | "POINT6" | "POINT7" | "POINT8" | "POINT9" | "POINT10" | "POINT11" | "POINT12" | "POINT13" | "POINT14" | "POINT15" | "POINT16" | "XZ" | "ZX" | "X" | "Z" | "QUAD" | "DIAG" | "NONE";

export type SymmetryPattern = "CLASSIC" | "S_CURVE" | "SPIRAL" | "PAIRED_ISLANDS" | "QUADRANTS" | "LAYERED" | "ASYMMETRIC";

export interface TeamIslandBridgePath {
  fromIsland: number;
  toIsland: number;
  fromTeam: number;
  toTeam: number;
  points: (RiverPoint)[];
}

export interface TeamIslandBridgeReport {
  requestedEnemyIslands: number;
  width: number;
  changedSamples: number;
  paths: (TeamIslandBridgePath)[];
  scope: string;
  shores: NaturalBridgeReport | null;
}

export interface TeamSpawnDistance {
  team: number;
  spawns: number;
  meanDistance: number;
  minimumDistance: number;
  maximumDistance: number;
}

export type TerrainDetailMode = "STANDARD" | "REALISM";

export interface TerrainEdgeContactReport {
  requestedChance: number;
  selected: boolean;
  applied: boolean;
  changedSamples: number;
  contacts: number;
}

export interface TerrainEnvironmentReport {
  version: number;
  gridSize: number;
  landSamples: number;
  meanMoisture: number;
  depositedFraction: number;
  rockFraction: number;
  snowFraction: number;
  materialColors: (string)[];
  scope: string;
}

export interface TerrainErosionReport {
  strength: number;
  iterations: number;
  changedSamples: number;
  maximumCut: number;
  maximumDeposit: number;
  scope: string;
}

export interface TerrainIsland {
  id: number;
  area: number;
  spawnCount: number;
  x: number;
  z: number;
  reservedForExpansion: boolean;
  spawnNames: (string)[] | null;
  teamIds: (number)[] | null;
  touchesMapEdge: boolean;
  isReef: boolean;
}

export interface TerrainLakeReport {
  waterBodies: number;
  landlockedBodies: number;
  edgeConnectedBodies: number;
  bodies: (TerrainWaterBody)[];
}

export interface TerrainReliefReport {
  requestedMountainRatio: number;
  requestedDepressionRatio: number;
  mountainRatio: number;
  depressionRatio: number;
  plainRatio: number;
  mountainSamples: number;
  depressionSamples: number;
  plainSamples: number;
  coastalMountainSamples: number;
  scope: string;
  structure: MountainStructureReport | null;
  erosion: TerrainErosionReport | null;
}

export interface TerrainRiverPath {
  origin: string;
  width: number;
  points: (RiverPoint)[];
  sections?: (RiverSection)[] | null;
}

export interface TerrainRiverReport {
  count: number;
  changedSamples: number;
  paths: (TerrainRiverPath)[];
  scope: string;
  routing: string;
  valleySamples: number;
  mouthSamples: number;
  banks?: RiverBankReport | null;
}

export interface TerrainWaterBody {
  id: number;
  area: number;
  x: number;
  z: number;
  touchesMapEdge: boolean;
}

export type TopologyKind = "LAND" | "ISLAND" | "ARCHIPELAGO" | "MIXED" | "LAKE" | "LAKES" | "CALDERA";

export interface TopologyReport {
  kind: string;
  requestedWaterRatio: number;
  actualWaterRatio: number;
  landBridges: boolean;
  landComponents: number;
  islandAreas: (number)[];
  mode: string;
  requestedSpawnFreeIslands: number;
  spawnFreeIslands: number;
  islands: (TerrainIsland)[] | null;
  relief: TerrainReliefReport | null;
  symmetryPattern: SymmetryPattern;
  lakes: TerrainLakeReport | null;
  shoreline: ShorelineReport | null;
  spawnIslandMode: SpawnIslandMode;
  spawnIslandPlacementValid: boolean | null;
  maxPlayersPerIsland: number;
  rivers: TerrainRiverReport | null;
  spawnIslands: (TerrainIsland)[] | null;
  teamBridges: TeamIslandBridgeReport | null;
  edgeContact: TerrainEdgeContactReport | null;
  randomSpawnFreeIslands: boolean;
  coastalDetails: CoastalDetailReport | null;
  bridgeShores: NaturalBridgeReport | null;
  erosion: TerrainErosionReport | null;
  waterSlopes?: WaterSlopeReport | null;
  complexRelief?: ComplexReliefReport | null;
}

export interface TopologySettings {
  kind?: TopologyKind;
  waterRatio?: number | null;
  landBridges?: boolean;
  mode?: TerrainDetailMode;
  spawnFreeIslands?: number;
  mountainRatio?: number;
  depressionRatio?: number;
  symmetryPattern?: SymmetryPattern;
  shorelineStyle?: ShorelineStyle;
  spawnIslandMode?: SpawnIslandMode;
  maxPlayersPerIsland?: number;
  rivers?: boolean;
  enemyIslandConnections?: number;
  edgeContactChance?: number;
  randomSpawnFreeIslands?: boolean;
}

export interface VegetationReport {
  trees: number;
  meanMoisture: number;
  meanSlope: number;
  clearings: number;
}

export interface WaterSlopeReport {
  changedSamples: number;
  sheerSamples: number;
  talusSamples: number;
  terracedSamples: number;
  erodedSamples: number;
  cliffEdges: number;
  blockedEdges: number;
  passageEdges: number;
  unexpectedGapEdges: number;
  scope: string;
  valid: boolean;
}
