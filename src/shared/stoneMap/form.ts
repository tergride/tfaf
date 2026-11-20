// The generation form of StoneMap, as its own editor keeps it: values in the units the controls show (percentages,
// map units) and a set of settings left to the seed. formToRequest turns them into the API's request; the rules
// between fields (topology, symmetry pattern, islands) follow the editor so the same choices make the same maps.

import { isGeneratorSeed } from '../mapGenerator.ts';
import { editorDefaults, parameterCatalog, parameterRanges } from './catalog.ts';
import type {
  BiomeLayout,
  EditorSettingsProfile,
  GenerationRequest,
  ParameterRange,
  ResolvedParameters,
  SpawnIslandMode,
  SymmetryPattern,
  TopologyKind,
} from './contracts.ts';

export type StoneMapForm = Omit<EditorSettingsProfile, 'randomize'>;

export interface StoneMapFormState {
  form: StoneMapForm;
  /** Catalog paths of the settings the generator picks from the seed. */
  random: string[];
}

export const MAP_SIZES = [256, 512, 1024, 2048] as const;
export const TOPOLOGY_KINDS: readonly TopologyKind[] = ['LAND', 'ISLAND', 'ARCHIPELAGO', 'MIXED', 'LAKE', 'LAKES', 'CALDERA'];
export const SYMMETRY_PATTERNS: readonly SymmetryPattern[] = ['CLASSIC', 'S_CURVE', 'SPIRAL', 'PAIRED_ISLANDS', 'QUADRANTS', 'LAYERED', 'ASYMMETRIC'];
export const SPAWN_ISLAND_MODES: readonly SpawnIslandMode[] = ['AUTO', 'PER_SPAWN', 'PER_TEAM', 'SHARED', 'TEAM_GROUPS'];
export const DECORATION_SYMMETRIES = ['NONE', 'POINT2', 'POINT4', 'X', 'Z', 'QUAD', 'DIAG'] as const;
export const DECORATION_LAYOUTS: readonly BiomeLayout[] = ['GRADIENT', 'SECTORS', 'PATCHES'];
export const RELIEF_PROFILES = ['GLACIAL', 'VOLCANIC', 'ARID'] as const;
/** The free-islands choice that leaves the minimum to the seed. */
export const RANDOM_FREE_ISLANDS = -1;
const DEFAULT_SUN_AZIMUTH = 315;

const byPath = new Map(parameterCatalog.map((parameter) => [parameter.path, parameter]));

export function parameterRange(path: string): ParameterRange | null {
  return byPath.get(path)?.range ?? parameterRanges[path] ?? null;
}

/** The values the catalog offers for a setting. */
export function parameterValues(path: string): string[] {
  return byPath.get(path)?.values ?? [];
}

export function createFormState(): StoneMapFormState {
  const { randomize, ...form } = editorDefaults;
  return { form: structuredClone(form), random: [...randomize] };
}

export function lakeKind(kind: TopologyKind): boolean {
  return kind === 'LAKE' || kind === 'LAKES' || kind === 'CALDERA';
}

export function splitIslands(mode: SpawnIslandMode): boolean {
  return mode === 'PER_SPAWN' || mode === 'PER_TEAM' || mode === 'TEAM_GROUPS';
}

export function teamIslands(mode: SpawnIslandMode): boolean {
  return mode === 'PER_TEAM' || mode === 'TEAM_GROUPS';
}

export function canUseBridges(kind: TopologyKind, mode: SpawnIslandMode, teams: number): boolean {
  return mode === 'TEAM_GROUPS'
    ? teams >= 2 && (kind === 'ISLAND' || kind === 'ARCHIPELAGO' || kind === 'MIXED')
    : !splitIslands(mode) && (kind === 'ARCHIPELAGO' || kind === 'MIXED');
}

/** The map has a shore: water, or rivers on land. */
export function hasCoast(form: StoneMapForm): boolean {
  return form.kind !== 'LAND' || form.rivers;
}

/** Allied spawns exist, so distances between them mean something. */
export function hasAllies(form: StoneMapForm): boolean {
  return form.numTeams > 0 && form.spawnCount / form.numTeams > 1;
}

/** The largest water share in percent: lakes take less water than seas. */
export function waterMaximum(kind: TopologyKind): number {
  const range = parameterRanges[lakeKind(kind) ? 'topology.lakeWaterRatio' : 'topology.waterRatio'];
  return Math.round((range?.maximum ?? 0.85) * 100);
}

/** An island mode the form no longer offers (spawnIslandModeAllowed) goes back to the automatic one. */
function fitIslandMode(form: StoneMapForm): StoneMapForm {
  return spawnIslandModeAllowed(form, form.spawnIslandMode) ? form : selectSpawnIslandMode(form, 'AUTO');
}

/** Symmetry patterns other than the classic one fix the symmetry and round the player count to fit. */
export function selectPattern(form: StoneMapForm, pattern: SymmetryPattern): StoneMapForm {
  if (pattern === 'CLASSIC') {
    return fitIslandMode({ ...form, pattern });
  }
  if (pattern === 'ASYMMETRIC') {
    return fitIslandMode({ ...form, pattern, symmetry: 'NONE' });
  }
  const multiple = pattern === 'QUADRANTS' ? 4 : 2;
  const maximum = parameterRange('spawnCount')?.maximum ?? 16;
  const spawnCount = Math.min(maximum, Math.ceil(form.spawnCount / multiple) * multiple);
  const numTeams = form.numTeams && (multiple % form.numTeams || spawnCount % form.numTeams) ? 2 : form.numTeams;
  return fitIslandMode({
    ...form,
    pattern,
    symmetry: multiple === 4 ? 'POINT4' : 'POINT2',
    spawnCount,
    numTeams,
    terrainMode: pattern === 'LAYERED' ? 'REALISM' : form.terrainMode,
  });
}

/** Team counts StoneMap takes for a player count: none, or one that divides the players evenly. */
export function teamCountsFor(spawnCount: number): number[] {
  return [0, ...Array.from({ length: Math.max(0, spawnCount - 1) }, (_, index) => index + 2).filter((teams) => spawnCount % teams === 0)];
}

/** How many copies a terrain symmetry makes (Symmetry.Points of StoneMap). */
export function symmetryPoints(symmetry: string): number {
  const point = /^POINT(\d+)$/.exec(symmetry);
  if (point) {
    return Number(point[1]);
  }
  return symmetry === 'QUAD' || symmetry === 'DIAG' ? 4 : symmetry === 'NONE' ? 1 : 2;
}

/** StoneMap shares the copies of a symmetry out between the teams, so their number must divide by the teams. */
export function symmetryFitsTeams(form: StoneMapForm, symmetry: string, numTeams: number): boolean {
  return numTeams === 0 || form.pattern === 'ASYMMETRIC' || symmetryPoints(symmetry) % numTeams === 0;
}

// The symmetry a classic map takes when the teams no longer fit the chosen one: the simplest that fits.
const SYMMETRY_PREFERENCE = ['POINT2', 'POINT4', 'XZ', 'ZX', 'X', 'Z', 'QUAD', 'DIAG', ...Array.from({ length: 14 }, (_, index) => `POINT${index + 3}`)];

function fitSymmetry(form: StoneMapForm): StoneMapForm {
  if (form.pattern !== 'CLASSIC' || symmetryFitsTeams(form, form.symmetry, form.numTeams)) {
    return form;
  }
  const symmetry = SYMMETRY_PREFERENCE.find((candidate) => symmetryFitsTeams(form, candidate, form.numTeams));
  return symmetry ? { ...form, symmetry } : form;
}

/** A new player count keeps the teams if they still divide it, else takes the nearest count that does. */
export function selectSpawnCount(form: StoneMapForm, spawnCount: number): StoneMapForm {
  const allowed = teamCountsFor(spawnCount).filter((teams) => form.pattern === 'CLASSIC' || symmetryFitsTeams(form, form.symmetry, teams));
  const numTeams = allowed.includes(form.numTeams)
    ? form.numTeams
    : allowed.reduce((best, teams) => (Math.abs(teams - form.numTeams) < Math.abs(best - form.numTeams) ? teams : best), 0);
  return fitIslandMode(fitSymmetry({ ...form, spawnCount, numTeams }));
}

export function selectTeams(form: StoneMapForm, numTeams: number): StoneMapForm {
  return fitIslandMode(fitSymmetry({ ...form, numTeams }));
}

/** Land and lakes keep all spawns on one landmass; lakes start at 30% water. */
export function selectTopology(form: StoneMapForm, kind: TopologyKind): StoneMapForm {
  return {
    ...form,
    kind,
    spawnIslandMode: (kind === 'LAND' || lakeKind(kind)) && splitIslands(form.spawnIslandMode) ? 'SHARED' : form.spawnIslandMode,
    water: lakeKind(kind) ? (lakeKind(form.kind) ? Math.min(waterMaximum(kind), form.water) : 30) : form.water,
  };
}

/** Bridges stay only where the new island mode allows them. */
export function selectSpawnIslandMode(form: StoneMapForm, mode: SpawnIslandMode): StoneMapForm {
  return { ...form, spawnIslandMode: mode, bridges: canUseBridges(form.kind, mode, form.numTeams) && form.bridges };
}

/** Explicit resource counts start with enough mexes outside the spawns for every player's nearby expansion. */
export function selectExplicitResources(form: StoneMapForm, enabled: boolean): StoneMapForm {
  return {
    ...form,
    resourceExplicit: enabled,
    outsideMex: enabled ? Math.max(form.outsideMex, form.spawnCount * form.nearbyMex + 8) : form.outsideMex,
  };
}

/** Island modes the form offers for the current map: split ones need water, team ones need teams. */
export function spawnIslandModeAllowed(form: StoneMapForm, mode: SpawnIslandMode): boolean {
  if (splitIslands(mode) && (form.kind === 'LAND' || lakeKind(form.kind))) {
    return false;
  }
  return !(teamIslands(mode) && (form.numTeams === 0 || ((form.pattern === 'QUADRANTS' || form.pattern === 'LAYERED') && form.numTeams % 4 !== 0)));
}

/** The seed is left to chance, empty (StoneMap picks one) or a signed 64-bit integer, as StoneMap takes it. */
export function seedIsValid({ form, random }: StoneMapFormState): boolean {
  const seed = form.seed.trim();
  return random.includes('seed') || seed === '' || isGeneratorSeed(seed);
}

/** A random signed 64-bit seed. */
export function randomSeed(): string {
  const [high = 0, low = 0] = crypto.getRandomValues(new Uint32Array(2));
  return BigInt.asIntN(64, (BigInt(high) << 32n) | BigInt(low)).toString();
}

/** The API request of the form, as the editor builds it; percentages become fractions. */
export function formToRequest({ form, random }: StoneMapFormState): GenerationRequest {
  const randomized = new Set(random);
  const coast = hasCoast(form);
  const allies = hasAllies(form);
  const realism = form.terrainMode === 'REALISM';
  const name = form.displayName.trim();
  const description = form.mapDescription.trim();
  const settings: NonNullable<GenerationRequest['settings']> = {
    seed: randomized.has('seed') ? undefined : form.seed.trim() || undefined,
    randomize: random.filter((path) => path !== 'seed'),
    mapSize: form.mapSize,
    spawnCount: form.spawnCount,
    numTeams: form.numTeams,
    terrainSymmetry: form.symmetry,
    navigationProfile: form.navigation,
    heightScale: form.heightScale,
    heightOffset: form.heightOffset,
    spawnBuildArea: form.spawnBuildArea ? { radius: form.spawnBuildRadius, minimumFraction: form.spawnBuildPercent / 100 } : undefined,
    features: {
      plainForests: form.plainForests,
      coastalWrecks: form.coastalWrecks,
      navalNavigation: coast && form.navalNavigation,
      teamSpawnSeparation: form.numTeams > 0 ? form.teamSpread / 100 : null,
      navigationUnitsPerRow: form.navigationUnitsPerRow,
      minimumTeamSpawnDistance: allies ? form.minimumTeamSpawnDistance : null,
      maximumTeamSpawnDistance: allies ? form.maximumTeamSpawnDistance : null,
      coastalDetails: coast && form.coastalDetails,
      waterSlopeDetails: coast && form.waterSlopeDetails,
      increasedDecals: form.increasedDecals,
      coastalCliffMaterials: randomized.has('features.coastalDetails') ? undefined : coast && form.coastalDetails,
      mountainStructure: realism ? form.mountainStructure : 'CLASSIC',
      erosionStrength: realism ? form.erosion / 100 : 0,
      adaptiveVegetation: form.adaptiveVegetation,
      naturalEnvironment: form.naturalEnvironment,
      seabedRelief: form.seabedRelief,
      seabedChannels: form.seabedChannels,
      seabedBanks: form.seabedBanks,
      seabedGeology: form.seabedGeology,
      seabedMaterials: form.seabedMaterials,
      seabedDetails: form.seabedDetails,
      complexRelief: realism && form.complexRelief,
      reliefProfiles: form.reliefProfiles,
      forestEcology: form.forestEcology,
      environmentZones: form.environmentZones,
      enhancedPreview: form.enhancedPreview,
      boostReclaim: form.boostReclaim,
      battleWrecks: form.battleWrecks,
      battleWreckMassLimit: form.battleWreckMassLimit,
      baseMexGrid: form.baseMexGrid,
      reefs: coast && form.reefs,
      settlements: form.settlements,
      fillMountainHollows: form.fillMountainHollows,
      sunAzimuth: form.sunAzimuth,
      naturalLandBridges: form.naturalBridges,
      decoration: form.decoration
        ? {
            symmetry: form.decorationSymmetry,
            primaryBiome: form.decorationPrimary,
            secondaryBiome: form.decorationSecondary,
            thirdBiome: form.decorationThird || null,
            layout: form.decorationLayout,
            transitionWidth: form.decorationTransition / 100,
            rotation: form.decorationRotation,
          }
        : undefined,
    },
    customStyle: {
      terrainStyle: 'BASIC_LAST',
      biome: form.biome,
      propStyle: form.props,
      resourceStyle: 'BASIC',
      resourceDensity: form.resourceDensity,
      reclaimDensity: form.reclaimDensity,
    },
    resourcePlacement: form.resourceExplicit
      ? {
          minimumMexesPerSpawn: Math.max(4, form.baseMex),
          mexesOutsideSpawns: form.outsideMex,
          nearbyMexesPerSpawn: form.nearbyMex,
          minimumHydrosPerSpawn: form.baseHydro,
          hydrosOutsideSpawns: form.outsideHydro,
          distribution: form.distribution,
          allowWaterMexes: form.waterMex,
        }
      : undefined,
    topology: {
      kind: form.kind,
      waterRatio: form.kind === 'LAND' ? 0 : form.water / 100,
      landBridges: canUseBridges(form.kind, form.spawnIslandMode, form.numTeams) && form.bridges,
      mode: form.terrainMode,
      spawnFreeIslands: form.kind === 'LAND' || form.freeIslands === RANDOM_FREE_ISLANDS ? 0 : form.freeIslands,
      randomSpawnFreeIslands: form.kind !== 'LAND' && form.freeIslands === RANDOM_FREE_ISLANDS,
      edgeContactChance: form.kind === 'LAND' || lakeKind(form.kind) ? 0 : form.edgeContactChance / 100,
      mountainRatio: realism ? form.mountains / 100 : undefined,
      depressionRatio: realism ? form.depressions / 100 : undefined,
      symmetryPattern: form.pattern,
      shorelineStyle: form.kind === 'LAND' && !form.rivers ? 'DEFAULT' : form.shoreline,
      spawnIslandMode: form.spawnIslandMode,
      maxPlayersPerIsland: form.spawnIslandMode === 'TEAM_GROUPS' ? form.maxPlayersPerIsland : 3,
      rivers: form.rivers,
      enemyIslandConnections: form.spawnIslandMode === 'TEAM_GROUPS' && form.bridges && form.numTeams >= 2 ? form.enemyIslandConnections : 1,
    },
  };
  return {
    presentation: name || description ? { name: name || null, description: description || null } : undefined,
    settings,
    preview: { kinds: [], quality: 'medium' },
  };
}

/** The same map again with closed mountain hollows filled, from the parameters it was made with. */
export function mountainHollowsRequest(parameters: ResolvedParameters): GenerationRequest {
  return {
    settings: {
      seed: parameters.seed,
      mapSize: parameters.mapSize,
      spawnCount: parameters.spawnCount,
      numTeams: parameters.numTeams,
      terrainSymmetry: parameters.terrainSymmetry,
      navigationProfile: parameters.navigationProfile,
      heightScale: parameters.heightScale,
      heightOffset: parameters.heightOffset,
      style: parameters.style,
      customStyle: parameters.customStyle,
      topology: parameters.topology,
      resourcePlacement: parameters.resourcePlacement,
      spawnBuildArea: parameters.spawnBuildArea,
      features: { ...parameters.features, fillMountainHollows: true },
    },
    presentation: parameters.presentation,
    preview: { kinds: [], waterContours: true },
  };
}

/** The sun direction a newly ticked custom light starts with. */
export function defaultSunAzimuth(): number {
  return DEFAULT_SUN_AZIMUTH;
}
