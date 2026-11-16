import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CustomMapRequest, GeneratorOptionLists, GeneratorPrefs } from '../src/shared/contract.ts';
import {
  buildCustomMapRequest,
  closestSpawnCount,
  GENERATOR_MAP_SIZES,
  GENERATOR_TEAM_COUNTS,
  generatorMapSizeKm,
  isGeneratorSeed,
  isGeneratorSeedText,
  randomGeneratorSeed,
  spawnCountsFor,
} from '../src/shared/mapGenerator.ts';
import {
  checkCustomGeneratorVersion,
  customGeneratorArguments,
  generatedMapNamesIn,
  parseGeneratorOptionList,
  parseLatestGeneratorRelease,
} from '../src/main/vault/mapGenerator.ts';

const JAR = 'C:\\TFAF\\runtime\\map_generator\\NeroxisGen_1.12.0.jar';

const REQUEST: CustomMapRequest = {
  version: '1.12.0',
  generationType: 'casual',
  numTeams: 2,
  spawnCount: 6,
  mapSize: 512,
  seed: null,
  symmetry: null,
  style: null,
  terrainStyle: null,
  textureStyle: null,
  resourceStyle: null,
  propStyle: null,
  resourceDensity: null,
  reclaimDensity: null,
};

const LISTS: GeneratorOptionLists = {
  version: '1.12.0',
  symmetries: ['POINT2', 'XZ', 'QUAD'],
  styles: ['BASIC', 'BIG_ISLANDS', 'VALLEY'],
  terrainStyles: ['MOUNTAIN_RANGE', 'FLOODED'],
  textureStyles: ['DESERT', 'TUNDRA'],
  resourceStyles: ['BASIC', 'LOW_MEX'],
  propStyles: ['BASIC', 'ENEMY_CIV'],
};

const PREFS: GeneratorPrefs = {
  generationType: 'casual',
  numTeams: 2,
  spawnCount: 6,
  mapSize: 512,
  symmetries: [],
  fixedSeed: false,
  seed: '',
  customStyle: false,
  styles: [],
  terrainStyles: [],
  textureStyles: [],
  resourceStyles: [],
  propStyles: [],
  resourceDensity: [0, 127],
  reclaimDensity: [0, 127],
};

const BASE_ARGS = ['-jar', JAR, '--map-size', '512', '--spawn-count', '6', '--num-teams', '2'];

describe('map generator command for a new map', () => {
  it('passes only the size, spawns and teams when everything else is random', () => {
    assert.deepEqual(customGeneratorArguments(JAR, REQUEST), BASE_ARGS);
  });

  it('passes the seed, the symmetry and a whole map style, which leaves out the parts', () => {
    const args = customGeneratorArguments(JAR, {
      ...REQUEST,
      seed: '-42',
      symmetry: 'XZ',
      style: 'VALLEY',
      terrainStyle: 'FLOODED',
      resourceDensity: 64,
    });
    assert.deepEqual(args, [...BASE_ARGS, '--seed', '-42', '--terrain-symmetry', 'XZ', '--style', 'VALLEY']);
  });

  it('passes the parts of a custom style and the densities as fractions of 127', () => {
    const args = customGeneratorArguments(JAR, {
      ...REQUEST,
      terrainStyle: 'MOUNTAIN_RANGE',
      textureStyle: 'DESERT',
      resourceStyle: 'LOW_MEX',
      propStyle: 'ENEMY_CIV',
      resourceDensity: 127,
      reclaimDensity: 0,
    });
    assert.deepEqual(args, [
      ...BASE_ARGS,
      '--terrain-style', 'MOUNTAIN_RANGE',
      '--texture-style', 'DESERT',
      '--resource-style', 'LOW_MEX',
      '--prop-style', 'ENEMY_CIV',
      '--resource-density', '1',
      '--reclaim-density', '0',
    ]);
    const density = customGeneratorArguments(JAR, { ...REQUEST, reclaimDensity: 10 });
    assert.equal(Math.fround(Number(density.at(-1))), Math.fround(10 / 127));
  });

  it('gives the other kinds of maps their flag and nothing that would reveal the map', () => {
    const everything: CustomMapRequest = { ...REQUEST, seed: '7', symmetry: 'QUAD', style: 'BASIC', resourceDensity: 5 };
    assert.deepEqual(customGeneratorArguments(JAR, { ...everything, generationType: 'tournament' }), [...BASE_ARGS, '--tournament-style']);
    assert.deepEqual(customGeneratorArguments(JAR, { ...everything, generationType: 'blind' }), [...BASE_ARGS, '--blind']);
    assert.deepEqual(customGeneratorArguments(JAR, { ...everything, generationType: 'unexplored' }), [...BASE_ARGS, '--unexplored']);
  });

  it('passes the edges of the form as they are', () => {
    const args = customGeneratorArguments(JAR, { ...REQUEST, numTeams: 0, spawnCount: 16, mapSize: 1024 });
    assert.deepEqual(args, ['-jar', JAR, '--map-size', '1024', '--spawn-count', '16', '--num-teams', '0']);
  });
});

describe('map generator form', () => {
  it('offers 5 to 20 km in steps of 1.25 km', () => {
    assert.deepEqual(GENERATOR_MAP_SIZES, [256, 320, 384, 448, 512, 576, 640, 704, 768, 832, 896, 960, 1024]);
    assert.deepEqual(GENERATOR_MAP_SIZES.map(generatorMapSizeKm), [5, 6.25, 7.5, 8.75, 10, 11.25, 12.5, 13.75, 15, 16.25, 17.5, 18.75, 20]);
  });

  it('offers no teams or 2 to 16 teams, and spawn counts that split evenly into them', () => {
    assert.deepEqual(GENERATOR_TEAM_COUNTS, [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    assert.deepEqual(spawnCountsFor(0), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    assert.deepEqual(spawnCountsFor(2), [2, 4, 6, 8, 10, 12, 14, 16]);
    assert.deepEqual(spawnCountsFor(3), [3, 6, 9, 12, 15]);
    assert.deepEqual(spawnCountsFor(7), [7, 14]);
    assert.deepEqual(spawnCountsFor(16), [16]);
  });

  it('keeps the spawn count when the teams change if it fits, else takes the nearest, the larger on a tie', () => {
    assert.equal(closestSpawnCount(6, 3), 6);
    assert.equal(closestSpawnCount(10, 3), 9);
    assert.equal(closestSpawnCount(5, 2), 6);
    assert.equal(closestSpawnCount(2, 16), 16);
    assert.equal(closestSpawnCount(40, 0), 16);
  });

  it('accepts seeds that fit a Java long', () => {
    assert.ok(isGeneratorSeed('0'));
    assert.ok(isGeneratorSeed('9223372036854775807'));
    assert.ok(isGeneratorSeed('-9223372036854775808'));
    assert.ok(!isGeneratorSeed('9223372036854775808'));
    assert.ok(!isGeneratorSeed(''));
    assert.ok(!isGeneratorSeed('12a'));
    assert.ok(!isGeneratorSeed('1.5'));
    assert.ok(isGeneratorSeedText(''));
    assert.ok(isGeneratorSeedText('-'));
    assert.ok(!isGeneratorSeedText('12 34'));
    for (let attempt = 0; attempt < 20; attempt++) {
      assert.ok(isGeneratorSeed(randomGeneratorSeed()));
    }
  });

  it('takes one of several chosen values at random and leaves unchosen ones to the generator', () => {
    const prefs: GeneratorPrefs = { ...PREFS, symmetries: ['POINT2', 'XZ'], styles: ['VALLEY'] };
    assert.equal(buildCustomMapRequest(prefs, LISTS, () => 0).symmetry, 'POINT2');
    assert.equal(buildCustomMapRequest(prefs, LISTS, () => 0.99).symmetry, 'XZ');
    const request = buildCustomMapRequest(prefs, LISTS, () => 0.5);
    assert.deepEqual(request, { ...REQUEST, symmetry: 'XZ', style: 'VALLEY' });
  });

  it('drops values the generator of this version does not offer', () => {
    const request = buildCustomMapRequest({ ...PREFS, styles: ['GONE'], symmetries: ['GONE', 'QUAD'] }, LISTS, () => 0);
    assert.equal(request.style, null);
    assert.equal(request.symmetry, 'QUAD');
  });

  it('builds a custom style with densities drawn from the whole range', () => {
    const prefs: GeneratorPrefs = {
      ...PREFS,
      customStyle: true,
      fixedSeed: true,
      seed: '123',
      styles: ['VALLEY'],
      terrainStyles: ['FLOODED'],
      resourceDensity: [10, 20],
      reclaimDensity: [64, 64],
    };
    const low = buildCustomMapRequest(prefs, LISTS, () => 0);
    assert.deepEqual(low, {
      ...REQUEST,
      seed: '123',
      terrainStyle: 'FLOODED',
      resourceDensity: 10,
      reclaimDensity: 64,
    });
    const high = buildCustomMapRequest(prefs, LISTS, () => 0.9999);
    assert.equal(high.resourceDensity, 20);
    assert.equal(high.reclaimDensity, 64);
  });

  it('sends no seed or style for the other kinds of maps', () => {
    const prefs: GeneratorPrefs = { ...PREFS, generationType: 'blind', fixedSeed: true, seed: '5', customStyle: true, symmetries: ['XZ'] };
    assert.deepEqual(buildCustomMapRequest(prefs, LISTS, () => 0), { ...REQUEST, generationType: 'blind' });
  });
});

describe('map generator answers', () => {
  it('reads an option list the way the official client does', () => {
    const output = [
      'Picked up JAVA_TOOL_OPTIONS: -Dfile.encoding=UTF-8',
      'BASIC',
      'BIG_ISLANDS',
      '',
      'CENTER_LAKE\r',
      '  VALLEY  ',
      'BASIC',
      'WARNING: A restricted method in java.lang.System has been called',
      'not an option',
      '',
    ].join('\n');
    assert.deepEqual(parseGeneratorOptionList(output), ['BASIC', 'BIG_ISLANDS', 'CENTER_LAKE', 'VALLEY']);
    assert.deepEqual(parseGeneratorOptionList('POINT2\r\nPOINT4\r\nXZ\r\nZX\r\nQUAD\r\nDIAG\r\n'), ['POINT2', 'POINT4', 'XZ', 'ZX', 'QUAD', 'DIAG']);
    assert.deepEqual(parseGeneratorOptionList(''), []);
  });

  it('finds the name of the map the generator wrote', () => {
    const output = [
      'Generating map neroxis_map_generator_1.12.0_bmxq2zkxmi2gm_aidaaaa',
      'Seed: -42',
      'Saving map to C:\\Users\\me\\Documents\\My Games\\Gas Powered Games\\Supreme Commander Forged Alliance\\maps\\neroxis_map_generator_1.12.0_bmxq2zkxmi2gm_aidaaaa',
      'Map generation done',
    ].join('\n');
    assert.deepEqual(generatedMapNamesIn(output), ['neroxis_map_generator_1.12.0_bmxq2zkxmi2gm_aidaaaa']);
    assert.deepEqual(generatedMapNamesIn('"neroxis_map_generator_1.12.0_abc.scmap" done'), ['neroxis_map_generator_1.12.0_abc']);
    assert.deepEqual(generatedMapNamesIn('neroxis_map_generator_1.12_abc\nneroxis_map_generator_1.12.0_\nnothing'), []);
  });

  it('takes the newest release from GitHub only when it is a generator 1.x', () => {
    assert.equal(parseLatestGeneratorRelease({ tag_name: '1.12.0', name: 'Release 1.12.0' }), '1.12.0');
    assert.equal(parseLatestGeneratorRelease({ tag_name: '1.08.0' }), '1.8.0');
    assert.throws(() => parseLatestGeneratorRelease({ tag_name: '2.0.0' }));
    assert.throws(() => parseLatestGeneratorRelease({ tag_name: '0.7.1' }));
    assert.throws(() => parseLatestGeneratorRelease({ tag_name: 'v1.12.0' }));
    assert.throws(() => parseLatestGeneratorRelease({ message: 'API rate limit exceeded' }));
    assert.throws(() => parseLatestGeneratorRelease(null));
    assert.throws(() => checkCustomGeneratorVersion('0.7.1'));
    assert.deepEqual(checkCustomGeneratorVersion('1.22.2'), { version: '1.22.2', major: 1 });
  });
});
