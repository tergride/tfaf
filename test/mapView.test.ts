import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { readDds } from '../src/main/mapView/ddsReader.ts';
import { GameFileSystem } from '../src/main/mapView/gameFileSystem.ts';
import { normalizeGamePath, resolveGamePath } from '../src/main/mapView/gamePaths.ts';
import { limitTexture } from '../src/main/mapView/mapViewService.ts';
import { readPropBlueprint } from '../src/main/mapView/propBlueprint.ts';
import { readSaveMarkers } from '../src/main/mapView/saveMarkers.ts';
import { readScm } from '../src/main/mapView/scmReader.ts';
import { readScmap, ScmapFormatError } from '../src/main/mapView/scmapReader.ts';
import { zipFolder } from '../src/main/vault/zipWriter.ts';
import { decalGeometry } from '../src/renderer/src/lib/mapView/decalGeometry.ts';
import { TerrainFamily, terrainShader } from '../src/renderer/src/lib/mapView/terrainShaders.ts';
import type { Settings } from '../src/shared/contract.ts';

/** Little-endian writer for the binary files of the tests. */
class Writer {
  private readonly parts: Buffer[] = [];

  int(value: number): this {
    const part = Buffer.alloc(4);
    part.writeInt32LE(value);
    this.parts.push(part);
    return this;
  }

  uint(value: number): this {
    const part = Buffer.alloc(4);
    part.writeUInt32LE(value >>> 0);
    this.parts.push(part);
    return this;
  }

  float(...values: number[]): this {
    for (const value of values) {
      const part = Buffer.alloc(4);
      part.writeFloatLE(value);
      this.parts.push(part);
    }
    return this;
  }

  short(value: number): this {
    const part = Buffer.alloc(2);
    part.writeUInt16LE(value);
    this.parts.push(part);
    return this;
  }

  bytes(data: Uint8Array | number[]): this {
    this.parts.push(Buffer.from(data));
    return this;
  }

  string(value: string): this {
    this.parts.push(Buffer.from(`${value}\0`, 'latin1'));
    return this;
  }

  block(data: Buffer): this {
    return this.int(data.length).bytes(data);
  }

  build(): Buffer {
    return Buffer.concat(this.parts);
  }
}

/** A DDS header of 128 bytes, followed by `data`. */
function dds(options: { width: number; height: number; fourCc?: string; bits?: number; masks?: number[]; levels?: number; alpha?: boolean }, data: Buffer): Buffer {
  const header = Buffer.alloc(128);
  header.write('DDS ', 0, 'latin1');
  header.writeUInt32LE(124, 4);
  header.writeUInt32LE(0x1007 | (options.levels ? 0x20000 : 0), 8);
  header.writeUInt32LE(options.height, 12);
  header.writeUInt32LE(options.width, 16);
  header.writeUInt32LE(options.levels ?? 0, 28);
  header.writeUInt32LE(32, 76);
  if (options.fourCc) {
    header.writeUInt32LE(0x4, 80);
    header.write(options.fourCc, 84, 'latin1');
  } else {
    header.writeUInt32LE(0x40 | (options.alpha ? 0x1 : 0), 80);
    header.writeUInt32LE(options.bits ?? 32, 88);
    (options.masks ?? [0xff0000, 0xff00, 0xff, 0xff000000]).forEach((mask, index) => header.writeUInt32LE(mask >>> 0, 92 + index * 4));
  }
  return Buffer.concat([header, data]);
}

/** A 4×4 A8R8G8B8 texture, as maps store their masks. */
function rawTexture(): Buffer {
  return dds({ width: 4, height: 4, alpha: true }, Buffer.alloc(4 * 4 * 4, 0x80));
}

const SIZE = 4;

/** A minimal `.scmap` of the given version with one stratum, one decal and one prop. */
function scmapFile(version: number, options: { truncate?: number } = {}): Buffer {
  const file = new Writer()
    .uint(0x1a70614d)
    .int(2)
    .uint(0xbeefedfe)
    .int(2)
    .float(SIZE, SIZE)
    .int(0)
    .short(0)
    .block(rawTexture())
    .int(version)
    .int(SIZE)
    .int(SIZE)
    .float(1 / 128);
  for (let i = 0; i < (SIZE + 1) * (SIZE + 1); i++) {
    file.short(i * 100);
  }
  if (version >= 54) {
    file.bytes([0]);
  }
  file.string(version >= 56 ? 'TTerrainXP' : 'TTerrain').string('/textures/environment/defaultbackground.dds').string('/textures/environment/sky.dds');
  if (version >= 56) {
    file.int(1).string('<default>').string('/textures/environment/envcube.dds');
  } else {
    file.string('/textures/environment/envcube.dds');
  }
  // Lighting: multiplier, sun direction, ambience, colour, shadow fill, specular, bloom, fog colour, start, end.
  file.float(1.5, 0, 1, 0, 0, 0, 0, 1.2, 1.1, 1, 0.5, 0.5, 0.6, 0.1, 0.1, 0.1, 0.2, 0.08, 0.4, 0.5, 0.6, 0, 1000);
  // Water: present, elevations, surface colour, lerp, refraction, fresnel ×2, unit and sky reflection, sun.
  file.bytes([1]).float(17.5, 15, 2.5, 0, 0.7, 1.5, 0.06, 0.12, 0.38, 0.14, 1.5, 1, 0.68, 78, 3.9, 0.1, -0.96, 0.25, 0.5, 0.5, 0.4, 2, 0.16);
  file.string('/textures/engine/watercubemap.dds').string('/textures/engine/waterramp.dds').float(0.1, 0.2, 0.3, 0.4);
  for (let i = 0; i < 4; i++) {
    file.float(0.01, 0.02).string('/textures/engine/waves.dds');
  }
  file.int(0); // wave generators
  if (version < 54) {
    file.string('No Tileset').int(6);
    for (let i = 0; i < 6; i++) {
      file.string(`/env/layers/albedo${i}.dds`).string(`/env/layers/normal${i}.dds`).float(4 + i, 2 + i);
    }
  } else {
    if (version >= 56) {
      file.int(24).int(0).int(0).int(0).int(0).int(0);
    }
    if (version > 56) {
      file.float(0);
    }
    for (let i = 0; i < 10; i++) {
      file.string(i === 5 ? '' : `/env/layers/albedo${i}.dds`).float(4 + i);
    }
    for (let i = 0; i < 9; i++) {
      file.string(`/env/layers/normal${i}.dds`).float(2 + i);
    }
  }
  file.int(0).int(0);
  // One albedo decal with its two textures, then no decal groups.
  file.int(1).int(0).int(1).int(2);
  for (const texture of ['/env/decals/road_albedo.dds', '/env/decals/road_mask.dds']) {
    file.int(texture.length).bytes(Buffer.from(texture, 'latin1'));
  }
  file.float(8, 1, 4, 10, 20, 30, 0, Math.PI / 2, 0, 1000, 0).int(-1);
  file.int(0).int(SIZE).int(SIZE);
  file.int(1).block(dds({ width: 4, height: 4, fourCc: 'DXT5' }, Buffer.alloc(16)));
  if (version < 54) {
    file.int(1);
  }
  file.block(rawTexture());
  if (version >= 54) {
    file.block(rawTexture());
  }
  file.int(1).block(dds({ width: 2, height: 2, fourCc: 'DXT5' }, Buffer.alloc(16)));
  file.bytes(Buffer.alloc(3 * (SIZE / 2) * (SIZE / 2) + SIZE * SIZE));
  if (version <= 52) {
    file.short(0);
  }
  if (version >= 59) {
    file.float(...Array<number>(16).fill(0)).string('/textures/sky/albedo.dds').string('/textures/sky/glow.dds');
    file.int(1).float(...Array<number>(10).fill(1));
    file.bytes([1, 2, 3]).float(1, 0.5, 0.5, 0.5).string('/textures/sky/cirrus.dds');
    file.int(1).float(1, 1, 1, 1, 1).float(0);
  }
  file.int(1).string('/env/evergreen/props/trees/pine06_prop.bp').float(1, 2, 3, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1);
  const data = file.build();
  return options.truncate ? data.subarray(0, data.length - options.truncate) : data;
}

describe('map view files', () => {
  it('reads the layout of every scmap version the vault has', () => {
    for (const version of [52, 53, 54, 56, 59, 60]) {
      const map = readScmap(scmapFile(version));
      assert.equal(map.version, version);
      assert.deepEqual([map.width, map.height], [SIZE, SIZE]);
      assert.equal(map.heights.length, (SIZE + 1) * (SIZE + 1));
      assert.equal(map.heights[3], 300);
      assert.equal(map.strata.length, 10);
      assert.equal(map.strata[0]!.albedo, '/env/layers/albedo0.dds');
      assert.equal(map.lighting.multiplier, 1.5);
      assert.deepEqual(map.lighting.sunDirection, [0, 1, 0]);
      assert.equal(map.water.present, true);
      assert.equal(map.water.rampTexture, '/textures/engine/waterramp.dds');
      assert.equal(map.decals.length, 1);
      assert.deepEqual(map.decals[0]!.textures, ['/env/decals/road_albedo.dds', '/env/decals/road_mask.dds']);
      assert.deepEqual(map.decals[0]!.position, [10, 20, 30]);
      assert.equal(map.props.length, 1);
      assert.deepEqual(map.props[0]!.position, [1, 2, 3]);
      assert.equal(map.masks[1] === null, version < 54);
    }
    // Before Forged Alliance the upper stratum follows the first four, and strata 5–8 are empty.
    const old = readScmap(scmapFile(53));
    assert.equal(old.strata[9]!.albedo, '/env/layers/albedo5.dds');
    assert.equal(old.strata[5]!.albedo, '');
    assert.equal(old.strata[9]!.normalScale, 7);
  });

  it('rejects a truncated scmap and other files', () => {
    assert.throws(() => readScmap(scmapFile(56, { truncate: 10 })), ScmapFormatError);
    assert.throws(() => readScmap(Buffer.from('not a map at all, not at all')), ScmapFormatError);
  });

  it('keeps DXT levels as they are and turns masked colours into RGBA', () => {
    const dxt = readDds(dds({ width: 8, height: 4, fourCc: 'DXT1', levels: 4 }, Buffer.alloc(16 + 8 + 8 + 8)));
    assert.equal(dxt?.format, 'dxt1');
    assert.deepEqual(
      dxt?.levels.map((level) => level.length),
      [16, 8, 8, 8],
    );

    const argb = readDds(dds({ width: 1, height: 1, alpha: true }, Buffer.from([0x10, 0x20, 0x30, 0x40])));
    assert.deepEqual([...argb!.levels[0]!], [0x30, 0x20, 0x10, 0x40]);

    const rgb = readDds(dds({ width: 1, height: 1, bits: 24, masks: [0xff0000, 0xff00, 0xff, 0] }, Buffer.from([0x10, 0x20, 0x30])));
    assert.deepEqual([...rgb!.levels[0]!], [0x30, 0x20, 0x10, 0xff]);

    assert.equal(readDds(Buffer.from('DDX nothing')), null);
    assert.equal(readDds(dds({ width: 4, height: 4, fourCc: 'DX10' }, Buffer.alloc(64))), null);
  });

  it('reads positions, normals, UVs and indices of an SCM mesh', () => {
    const vertices = Buffer.alloc(3 * 68);
    for (let i = 0; i < 3; i++) {
      vertices.writeFloatLE(i, i * 68);
      // The normal follows the position; the tangent after it is not the normal.
      vertices.writeFloatLE(1, i * 68 + 16);
      vertices.writeFloatLE(1, i * 68 + 24);
      vertices.writeFloatLE(0.5, i * 68 + 48);
    }
    const header = new Writer().bytes(Buffer.from('MODL')).int(5).int(0).int(1).int(48).int(0).int(3).int(48 + vertices.length).int(3).int(0).int(0).int(1).build();
    const indices = new Writer().short(0).short(1).short(2).build();
    const mesh = readScm(Buffer.concat([header, vertices, indices]));
    assert.deepEqual([...mesh!.positions], [0, 0, 0, 1, 0, 0, 2, 0, 0]);
    assert.deepEqual([...mesh!.normals.subarray(0, 3)], [0, 1, 0]);
    assert.deepEqual([...mesh!.uvs.subarray(0, 2)], [0.5, 0]);
    assert.deepEqual([...mesh!.indices], [0, 1, 2]);

    const broken = Buffer.concat([header, vertices, new Writer().short(0).short(1).short(7).build()]);
    assert.equal(readScm(broken), null);
  });

  it('resolves prop levels of detail like the engine names them', () => {
    const blueprint = `PropBlueprint {
      Display = {
        Mesh = {
          LODs = {
            { AlbedoName = '../Pine06_V1_albedo.dds', LODCutoff = 30, ShaderName = 'NormalMappedAlpha' },
            { LODCutoff = 175, ShaderName = 'VertexNormal' },
            { MeshName = '/env/common/props/rock_lod2.scm', AlbedoName = 'Far_albedo.dds', LODCutoff = 700 },
            { LODCutoff = 900, ShaderName = 'TMeshAlpha' },
          },
        },
        UniformScale = 0.05,
      },
      Audio = { TreeFall = Sound { Bank = 'AmbientTest', Cue = 'Gen_Tree_Crush' } },
    }`;
    const model = readPropBlueprint(blueprint, '/env/evergreen/props/trees/groups/Pine06_GroupA_prop.bp');
    assert.equal(model?.uniformScale, 0.05);
    assert.deepEqual(
      model?.lods.map((lod) => [lod.mesh, lod.albedo, lod.cutoff]),
      [
        ['/env/evergreen/props/trees/groups/Pine06_GroupA_lod0.scm', '/env/evergreen/props/trees/Pine06_V1_albedo.dds', 30],
        ['/env/evergreen/props/trees/groups/Pine06_GroupA_lod1.scm', '/env/evergreen/props/trees/Pine06_V1_albedo.dds', 175],
        ['/env/common/props/rock_lod2.scm', '/env/evergreen/props/trees/groups/Far_albedo.dds', 700],
        ['/env/evergreen/props/trees/groups/Pine06_GroupA_lod3.scm', '/env/evergreen/props/trees/Pine06_V1_albedo.dds', 900],
      ],
    );
    // Supreme Commander's TMeshAlpha cuts leaves out like NormalMappedAlpha.
    assert.deepEqual(
      model?.lods.map((lod) => Math.round(lod.alphaCutoff * 255)),
      [0x80, 0x23, 0, 0x80],
    );

    const plain = readPropBlueprint('PropBlueprint { Display = { UniformScale = 0.1 } }', '/env/rocks/Rock01_prop.bp');
    assert.deepEqual(plain?.lods, [{ mesh: '/env/rocks/Rock01_lod0.scm', albedo: '/env/rocks/Rock01_albedo.dds', alphaCutoff: 0, cutoff: 1000 }]);

    // Effect emitters such as steam over lava shrink their marker mesh to nothing.
    assert.equal(readPropBlueprint('PropBlueprint { Display = { UniformScale = 0 } }', '/env/common/props/LavaSteam01_prop.bp'), null);
  });

  it('sends only the mip levels a view far out needs', () => {
    const texture = readDds(dds({ width: 8, height: 4, fourCc: 'DXT1', levels: 4 }, Buffer.alloc(16 + 8 + 8 + 8)));
    const limited = limitTexture(texture, 4);
    assert.deepEqual([limited?.width, limited?.height, limited?.levels.length], [4, 2, 3]);
    assert.equal(limitTexture(texture, 8), texture);
    // Without a level that small, the smallest one is sent.
    assert.deepEqual([limitTexture(texture, 0.5)?.width, limitTexture(texture, 0.5)?.levels.length], [1, 1]);
    assert.equal(limitTexture(null, 4), null);
  });

  it('tells the terrain shader families apart by name', () => {
    assert.deepEqual(terrainShader('TTerrain'), { family: TerrainFamily.legacy, albedoHalfRange: true, normalHalfRange: false, macrotexture: 0, biplanar: false });
    assert.equal(terrainShader('TTerrainXP').family, TerrainFamily.xp);
    assert.deepEqual(terrainShader('TTerrainXPExt'), { family: TerrainFamily.ext, albedoHalfRange: true, normalHalfRange: false, macrotexture: 0, biplanar: false });
    assert.deepEqual(terrainShader('Terrain051'), { family: TerrainFamily.udn, albedoHalfRange: true, normalHalfRange: true, macrotexture: 1, biplanar: false });
    assert.deepEqual(terrainShader('terrain152B'), { family: TerrainFamily.pbr, albedoHalfRange: true, normalHalfRange: true, macrotexture: 2, biplanar: true });
    assert.deepEqual(terrainShader('Terrain250'), { family: TerrainFamily.splat, albedoHalfRange: true, normalHalfRange: true, macrotexture: 0, biplanar: false });
    assert.equal(terrainShader('Terrain301').family, TerrainFamily.old);
    // A shader the view does not know is drawn as TTerrainXP.
    assert.equal(terrainShader('Terrain999').family, TerrainFamily.xp);
  });

  it('turns decals about their corner the way the game does', () => {
    const geometry = (heading: number): number[] =>
      decalGeometry({ position: [100, 5, 200], rotation: [0, heading, 0], scale: [40, 40, 20] }).map((value) => Math.round(value * 1000) / 1000 + 0);
    assert.deepEqual(geometry(0), [100, 200, 40, 0, 0, 20]);
    // A quarter turn points the decal's u axis south (+z) and its v axis west (-x).
    assert.deepEqual(geometry(Math.PI / 2), [100, 200, 0, 40, -20, 0]);
  });

  it('finds resources and start positions in a save file', () => {
    const save = `Scenario = {
      MasterChain = {
        ['_MASTERCHAIN_'] = {
          Markers = {
            ['Mass 01'] = { ['type'] = STRING( 'Mass' ), ['position'] = VECTOR3( 10.5, 20, 30.5 ) },
            ['Hydrocarbon 01'] = { ['type'] = STRING( 'Hydrocarbon' ), ['position'] = VECTOR3( 40, 20, 50 ) },
            ['ARMY_2'] = { ['type'] = STRING( 'Blank Marker' ), ['position'] = VECTOR3( 60, 20, 70 ) },
            ['Rally 1'] = { ['type'] = STRING( 'Blank Marker' ), ['position'] = VECTOR3( 1, 2, 3 ) },
            ['Path 1'] = { ['type'] = STRING( 'Land Path Node' ), ['size'] = FLOAT( 1.0 ), ['position'] = VECTOR3( 1, 2, 3 ) },
          },
        },
      },
      Areas = { ['AREA_1'] = { ['rectangle'] = RECT( 0, 0, 256, 256 ) } },
    }`;
    const markers = readSaveMarkers(save).sort((a, b) => a.kind.localeCompare(b.kind));
    assert.deepEqual(markers, [
      { kind: 'hydro', x: 40, z: 50, army: null },
      { kind: 'mass', x: 10.5, z: 30.5, army: null },
      { kind: 'spawn', x: 60, z: 70, army: 2 },
    ]);
  });

  it('brings game paths to one form and keeps them inside the root', () => {
    assert.equal(normalizeGamePath('\\env\\Layers\\./a.dds'), '/env/Layers/a.dds');
    assert.equal(normalizeGamePath('/env/a/../b.dds'), '/env/b.dds');
    assert.equal(normalizeGamePath('/../secret.dds'), null);
    assert.equal(normalizeGamePath('C:/windows/a.dds'), null);
    assert.equal(resolveGamePath('/env/trees/a_prop.bp', 'b_albedo.dds'), '/env/trees/b_albedo.dds');
    assert.equal(resolveGamePath('/env/trees/a_prop.bp', '/textures/c.dds'), '/textures/c.dds');
  });
});

describe('game file system', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'tfaf-map-view-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function file(relative: string, content: string): Promise<void> {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }

  it('finds files where the game would: vault maps, FAF packages, then the game', async () => {
    await file('faf/env/layers/grass.dds', 'faf');
    await file('game/env/layers/grass.dds', 'game');
    await file('game/env/layers/rock.dds', 'game rock');
    await mkdir(path.join(root, 'data', 'gamedata'), { recursive: true });
    await mkdir(path.join(root, 'install', 'gamedata'), { recursive: true });
    await zipFolder(path.join(root, 'faf', 'env'), path.join(root, 'data', 'gamedata', 'env.nx2'));
    await zipFolder(path.join(root, 'game', 'env'), path.join(root, 'install', 'gamedata', 'env.scd'));
    await file('vault/maps/Seton.v0003/env/decal.dds', 'vault decal');
    await file('install/maps/Seton.v0003/env/decal.dds', 'game decal');
    await file('install/maps/SCMP_009/env/decal.dds', 'official decal');

    const files = new GameFileSystem({
      get: () => ({ dataPath: path.join(root, 'data'), gamePath: path.join(root, 'install') }) as Settings,
      mapsDirectory: path.join(root, 'vault', 'maps'),
    });
    const text = async (gamePath: string): Promise<string | null> => (await files.read(gamePath, 1024))?.toString() ?? null;
    assert.equal(await text('/ENV/Layers/Grass.dds'), 'faf');
    assert.equal(await text('/env/layers/rock.dds'), 'game rock');
    assert.equal(await text('/env/layers/missing.dds'), null);
    assert.equal(await text('/maps/seton.v0003/env/decal.dds'), 'vault decal');
    assert.equal(await text('/maps/SCMP_009/env/decal.dds'), 'official decal');
    assert.equal(await files.mapFolder('../outside'), null);
  });
});
