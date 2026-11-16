// The custom map form of the Neroxis generator: its limits as in GenerateMapController of the official client, and
// the request one generation sends. The dialog and the main process share them, so both check the same rules.

import type { CustomMapRequest, GeneratorOptionLists, GeneratorPrefs } from './contract.ts';

/** One kilometre of map is 51.2 game units (MapSize.MAP_SIZE_FACTOR of the official client); 512 is 10 km. */
export const MAP_UNITS_PER_KM = 51.2;
const MIN_MAP_SIZE_KM = 5;
const MAX_MAP_SIZE_KM = 20;
const MAP_SIZE_STEP_KM = 1.25;

/** Map edges in game units: 5 to 20 km in steps of 1.25 km. */
export const GENERATOR_MAP_SIZES: readonly number[] = Array.from(
  { length: (MAX_MAP_SIZE_KM - MIN_MAP_SIZE_KM) / MAP_SIZE_STEP_KM + 1 },
  (_, index) => Math.round((MIN_MAP_SIZE_KM + index * MAP_SIZE_STEP_KM) * MAP_UNITS_PER_KM),
);

/** 0 leaves the spawns without teams; a single team is not offered. */
export const GENERATOR_TEAM_COUNTS: readonly number[] = [0, ...Array.from({ length: 15 }, (_, index) => index + 2)];
export const GENERATOR_SPAWN_COUNTS: readonly number[] = Array.from({ length: 15 }, (_, index) => index + 2);

/** Densities are chosen on 0..127 and passed as a fraction of 127, like the sliders of the official client. */
export const GENERATOR_DENSITY_MAX = 127;
export const MAX_GENERATOR_OPTIONS = 100;

// Styles and symmetries are names of Java enum constants.
const OPTION_NAME = /^[A-Za-z0-9_]{1,64}$/;
const SEED = /^-?\d{1,19}$/;
const SEED_TEXT = /^-?\d{0,19}$/;
const LONG_MIN = -(2n ** 63n);
const LONG_MAX = 2n ** 63n - 1n;

export function isGeneratorOptionName(value: unknown): value is string {
  return typeof value === 'string' && OPTION_NAME.test(value);
}

export function generatorMapSizeKm(mapSize: number): number {
  return mapSize / MAP_UNITS_PER_KM;
}

/** Spawn counts that split evenly into the teams; all of them without teams. */
export function spawnCountsFor(numTeams: number): number[] {
  return GENERATOR_SPAWN_COUNTS.filter((count) => numTeams === 0 || count % numTeams === 0);
}

/** The spawn count kept when the number of teams changes: the same one if it still fits, else the nearest that does. */
export function closestSpawnCount(spawnCount: number, numTeams: number): number {
  const allowed = spawnCountsFor(numTeams);
  return allowed.reduce((best, count) => {
    const distance = Math.abs(count - spawnCount);
    const bestDistance = Math.abs(best - spawnCount);
    return distance < bestDistance || (distance === bestDistance && count > best) ? count : best;
  }, allowed[0] ?? GENERATOR_SPAWN_COUNTS[0]!);
}

/** A seed the generator accepts: a Java long. */
export function isGeneratorSeed(value: string): boolean {
  if (!SEED.test(value)) {
    return false;
  }
  const seed = BigInt(value);
  return seed >= LONG_MIN && seed <= LONG_MAX;
}

/** What the seed field may hold while it is being typed. */
export function isGeneratorSeedText(value: unknown): value is string {
  return typeof value === 'string' && SEED_TEXT.test(value);
}

export function randomGeneratorSeed(): string {
  const [value = 0n] = crypto.getRandomValues(new BigUint64Array(1));
  return String(value >> 1n);
}

function pick(chosen: readonly string[], offered: readonly string[], random: () => number): string | null {
  const usable = chosen.filter((value) => offered.includes(value));
  return usable.length > 0 ? (usable[Math.floor(random() * usable.length)] ?? null) : null;
}

function density([low, high]: readonly [number, number], random: () => number): number {
  return low + Math.floor(random() * (high - low + 1));
}

/**
 * One map of the form, as GenerateMapController builds it: of several chosen values one is taken at random, none
 * leaves the choice to the generator, and a density is drawn from its range. Only `casual` maps take a seed and
 * styles; choices the generator of this version does not offer are dropped.
 */
export function buildCustomMapRequest(
  prefs: GeneratorPrefs,
  lists: GeneratorOptionLists,
  random: () => number = Math.random,
): CustomMapRequest {
  const casual = prefs.generationType === 'casual';
  const custom = casual && prefs.customStyle;
  return {
    version: lists.version,
    generationType: prefs.generationType,
    numTeams: prefs.numTeams,
    spawnCount: prefs.spawnCount,
    mapSize: prefs.mapSize,
    seed: casual && prefs.fixedSeed ? prefs.seed : null,
    symmetry: casual ? pick(prefs.symmetries, lists.symmetries, random) : null,
    style: casual && !custom ? pick(prefs.styles, lists.styles, random) : null,
    terrainStyle: custom ? pick(prefs.terrainStyles, lists.terrainStyles, random) : null,
    textureStyle: custom ? pick(prefs.textureStyles, lists.textureStyles, random) : null,
    resourceStyle: custom ? pick(prefs.resourceStyles, lists.resourceStyles, random) : null,
    propStyle: custom ? pick(prefs.propStyles, lists.propStyles, random) : null,
    resourceDensity: custom ? density(prefs.resourceDensity, random) : null,
    reclaimDensity: custom ? density(prefs.reclaimDensity, random) : null,
  };
}
