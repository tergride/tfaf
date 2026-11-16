// Reader of `.scmap` files, versions 52–60: Supreme Commander's (53 and older), Forged Alliance's (56) and the one
// FAF's editors write (60, with an extra sky box). The layout follows the HazardX loader in the FAF map editor and
// SCMapImporter of the Neroxis map generator; what the map view does not draw is skipped. The rare in-between
// versions of some official maps were read from their files: 54 already has Forged Alliance's ten strata and two
// masks but no minimap block, 59 already has the sky box.

import type { MessageKey, MessageParams } from '../../shared/i18n/index.ts';
import { t } from '../i18n.ts';

const SCMAP_MAGIC = 0x1a70614d;
const MAX_SIDE = 8192;
const MAX_ITEMS = 2_000_000;

export class ScmapFormatError extends Error {
  constructor(detail: MessageKey, params?: MessageParams) {
    super(t('main.mapView.invalidMap', { detail: t(detail, params) }));
  }
}

type Vec3 = [number, number, number];

export interface ScmapLighting {
  multiplier: number;
  sunDirection: Vec3;
  sunAmbience: Vec3;
  sunColor: Vec3;
  shadowFill: Vec3;
  specular: [number, number, number, number];
  fogColor: Vec3;
}

export interface ScmapWater {
  present: boolean;
  elevation: number;
  elevationDeep: number;
  elevationAbyss: number;
  surfaceColor: Vec3;
  colorLerp: [number, number];
  skyReflection: number;
  rampTexture: string;
}

export interface ScmapStratum {
  albedo: string;
  albedoScale: number;
  normal: string;
  normalScale: number;
}

export interface ScmapDecal {
  /** 1 albedo, 2 normals, 7 normals with alpha; the others (water, glow) are not drawn. */
  type: number;
  textures: string[];
  scale: Vec3;
  position: Vec3;
  rotation: Vec3;
}

export interface ScmapProp {
  blueprint: string;
  position: Vec3;
  /** Rows of the rotation matrix: where the model's x, y and z axes point. */
  rotation: [Vec3, Vec3, Vec3];
  scale: Vec3;
}

export interface Scmap {
  version: number;
  width: number;
  height: number;
  heightScale: number;
  heights: Uint16Array;
  terrainShader: string;
  lighting: ScmapLighting;
  water: ScmapWater;
  /** Always ten: lower, eight masked, upper. Maps of version 53 and older have only strata 1–4 besides those. */
  strata: ScmapStratum[];
  decals: ScmapDecal[];
  /** DDS files of the stratum masks; the second is missing before version 54. */
  masks: [Uint8Array, Uint8Array | null];
  props: ScmapProp[];
}

class Reader {
  offset = 0;
  private readonly data: Buffer;

  constructor(data: Buffer) {
    this.data = data;
  }

  private need(bytes: number): void {
    if (bytes < 0 || this.offset + bytes > this.data.length) {
      throw new ScmapFormatError('main.mapView.truncated');
    }
  }

  skip(bytes: number): void {
    this.need(bytes);
    this.offset += bytes;
  }

  byte(): number {
    this.need(1);
    return this.data[this.offset++]!;
  }

  int(): number {
    this.need(4);
    const value = this.data.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  count(): number {
    const value = this.int();
    if (value < 0 || value > MAX_ITEMS) {
      throw new ScmapFormatError('main.mapView.truncated');
    }
    return value;
  }

  /** A byte length; reading past the end fails when it is used. */
  length(): number {
    const value = this.int();
    if (value < 0) {
      throw new ScmapFormatError('main.mapView.truncated');
    }
    return value;
  }

  float(): number {
    this.need(4);
    const value = this.data.readFloatLE(this.offset);
    this.offset += 4;
    return value;
  }

  vec3(): Vec3 {
    return [this.float(), this.float(), this.float()];
  }

  string(): string {
    const end = this.data.indexOf(0, this.offset);
    if (end < 0) {
      throw new ScmapFormatError('main.mapView.truncated');
    }
    const value = this.data.toString('latin1', this.offset, end);
    this.offset = end + 1;
    return value;
  }

  fixedString(length: number): string {
    this.need(length);
    const value = this.data.toString('latin1', this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  bytes(length: number): Uint8Array {
    this.need(length);
    const value = new Uint8Array(this.data.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  /** A length-prefixed block, such as an embedded DDS file. */
  block(): Uint8Array {
    return this.bytes(this.length());
  }
}

const EMPTY_STRATUM: ScmapStratum = { albedo: '', albedoScale: 4, normal: '', normalScale: 4 };

export function readScmap(data: Buffer): Scmap {
  const reader = new Reader(data);
  if (reader.int() !== SCMAP_MAGIC) {
    throw new ScmapFormatError('main.mapView.notScmap');
  }
  // Major version, two constants, the size as floats, two zeros, then the preview picture.
  reader.skip(4 * 6 + 2);
  reader.skip(reader.length());
  let version = reader.int();
  // The editors read a zero version as Forged Alliance's.
  if (version <= 0) {
    version = 56;
  }
  if (version < 52 || version > 60) {
    throw new ScmapFormatError('main.mapView.unsupportedVersion', { version });
  }

  const width = reader.int();
  const height = reader.int();
  if (width <= 0 || height <= 0 || width > MAX_SIDE || height > MAX_SIDE) {
    throw new ScmapFormatError('main.mapView.badSize', { width, height });
  }
  const heightScale = reader.float();
  const heights = new Uint16Array((width + 1) * (height + 1));
  // The file and every platform the launcher runs on are little-endian.
  new Uint8Array(heights.buffer).set(reader.bytes(heights.byteLength));
  if (version >= 54) {
    reader.skip(1);
  }

  const terrainShader = reader.string();
  reader.string(); // background texture
  reader.string(); // sky cube map
  if (version >= 56) {
    const cubeMaps = reader.count();
    for (let i = 0; i < cubeMaps; i++) {
      reader.string();
      reader.string();
    }
  } else {
    reader.string();
  }

  const multiplier = reader.float();
  const sunDirection = reader.vec3();
  const sunAmbience = reader.vec3();
  const sunColor = reader.vec3();
  const shadowFill = reader.vec3();
  const specular: [number, number, number, number] = [reader.float(), reader.float(), reader.float(), reader.float()];
  reader.skip(4); // bloom
  const fogColor = reader.vec3();
  reader.skip(8); // fog start and end
  const lighting: ScmapLighting = { multiplier, sunDirection, sunAmbience, sunColor, shadowFill, specular, fogColor };

  const water = readWater(reader);
  const waveGenerators = reader.count();
  for (let i = 0; i < waveGenerators; i++) {
    reader.string();
    reader.string();
    reader.skip(4 * (3 + 1 + 3 + 10));
  }

  const strata: ScmapStratum[] = [];
  if (version < 54) {
    reader.string(); // "No Tileset"
    reader.skip(4); // layer count, always 6
    const layer = (): ScmapStratum => {
      const albedo = reader.string();
      const normal = reader.string();
      return { albedo, normal, albedoScale: reader.float(), normalScale: reader.float() };
    };
    for (let i = 0; i < 5; i++) {
      strata.push(layer());
    }
    for (let i = 5; i < 9; i++) {
      strata.push({ ...EMPTY_STRATUM });
    }
    strata.push(layer());
  } else {
    if (version >= 56) {
      reader.skip(4 * 6); // minimap contour interval and colours
    }
    if (version > 56) {
      reader.skip(4);
    }
    for (let i = 0; i < 10; i++) {
      strata.push({ albedo: reader.string(), albedoScale: reader.float(), normal: '', normalScale: 4 });
    }
    for (let i = 0; i < 9; i++) {
      strata[i]!.normal = reader.string();
      strata[i]!.normalScale = reader.float();
    }
  }
  reader.skip(8);

  const decals: ScmapDecal[] = [];
  const decalCount = reader.count();
  for (let i = 0; i < decalCount; i++) {
    reader.skip(4); // id
    const type = reader.int();
    const textureCount = reader.count();
    const textures: string[] = [];
    for (let j = 0; j < textureCount; j++) {
      textures.push(reader.fixedString(reader.length()));
    }
    const scale = reader.vec3();
    const position = reader.vec3();
    const rotation = reader.vec3();
    reader.skip(4 * 3); // LOD cut-offs and owner army
    decals.push({ type, textures, scale, position, rotation });
  }
  const decalGroups = reader.count();
  for (let i = 0; i < decalGroups; i++) {
    reader.skip(4);
    reader.string();
    reader.skip(4 * reader.count());
  }

  reader.skip(8); // the size again
  const normalMaps = reader.count();
  for (let i = 0; i < normalMaps; i++) {
    reader.skip(reader.length());
  }
  if (version < 54) {
    reader.skip(4);
  }
  const lowMask = reader.block();
  const highMask = version >= 54 ? reader.block() : null;
  // The water map: the engine works the water depth out from the heights when it loads the map, so the copy in the
  // file is often empty or stale and is not used.
  reader.skip(4);
  reader.skip(reader.length());
  // Foam, flatness and depth bias at half resolution, then the terrain types.
  reader.skip(3 * Math.floor(width / 2) * Math.floor(height / 2) + width * height);
  if (version <= 52) {
    reader.skip(2);
  }
  if (version >= 59) {
    skipSkyBox(reader);
  }

  const props: ScmapProp[] = [];
  const propCount = reader.count();
  for (let i = 0; i < propCount; i++) {
    const blueprint = reader.string();
    const position = reader.vec3();
    const rotation: [Vec3, Vec3, Vec3] = [reader.vec3(), reader.vec3(), reader.vec3()];
    props.push({ blueprint, position, rotation, scale: reader.vec3() });
  }

  return {
    version,
    width,
    height,
    heightScale,
    heights,
    terrainShader,
    lighting,
    water,
    strata,
    decals,
    masks: [lowMask, highMask],
    props,
  };
}

function readWater(reader: Reader): ScmapWater {
  const present = reader.byte() === 1;
  const elevation = reader.float();
  const elevationDeep = reader.float();
  const elevationAbyss = reader.float();
  const surfaceColor = reader.vec3();
  const colorLerp: [number, number] = [reader.float(), reader.float()];
  // Refraction, fresnel bias and power, unit reflection.
  reader.skip(4 * 4);
  const skyReflection = reader.float();
  // Sun shininess and strength, direction, colour, reflection and glow.
  reader.skip(4 * (2 + 3 + 3 + 2));
  reader.string(); // cube map
  const rampTexture = reader.string();
  reader.skip(4 * 4); // wave repeats
  for (let i = 0; i < 4; i++) {
    reader.skip(8);
    reader.string();
  }
  return { present, elevation, elevationDeep, elevationAbyss, surfaceColor, colorLerp, skyReflection, rampTexture };
}

function skipSkyBox(reader: Reader): void {
  // Position, horizon height, scale, sub height, two subdivision counts, zenith height, horizon and zenith colours, glow.
  reader.skip(4 * 16);
  reader.string(); // albedo
  reader.string(); // glow
  reader.skip(reader.count() * 4 * (3 + 1 + 2 + 4)); // planets
  reader.skip(3 + 4 + 12); // mid colour, cirrus multiplier and colour
  reader.string(); // cirrus texture
  reader.skip(reader.count() * 4 * (2 + 1 + 2)); // cirrus layers
  reader.skip(4);
}
