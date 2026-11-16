// The map view draws a map from its own files, the way the game does: the main process reads the `.scmap`, the save
// file, prop blueprints, textures and meshes; the renderer draws them with WebGL.

export type Vec3 = [number, number, number];

/** How many textures or meshes one request may ask for. */
export const MAP_VIEW_BATCH = 16;

/** DXT textures go to the GPU as they are; every other format arrives as RGBA. */
export type MapTextureFormat = 'dxt1' | 'dxt3' | 'dxt5' | 'rgba8';

export interface MapTexture {
  format: MapTextureFormat;
  /** The size of the first level sent, which is smaller than the file's when its larger levels were left out. */
  width: number;
  height: number;
  /** Mip levels from the largest; RGBA rows are tightly packed. */
  levels: Uint8Array[];
}

/** The largest texture side a request may ask for. */
export const MAP_TEXTURE_MAX_SIDE = 16384;

export interface MapMesh {
  /** Three floats per vertex in the model's units. */
  positions: Float32Array;
  normals: Float32Array;
  /** Two floats per vertex. */
  uvs: Float32Array;
  /** A triangle list. */
  indices: Uint16Array;
}

export interface MapLighting {
  multiplier: number;
  /** Points to the sun. */
  sunDirection: Vec3;
  sunAmbience: Vec3;
  sunColor: Vec3;
  shadowFill: Vec3;
  specular: [number, number, number, number];
  fogColor: Vec3;
}

export interface MapWater {
  elevation: number;
  elevationAbyss: number;
  surfaceColor: Vec3;
  /** How much of the surface colour the depth lets in, clamped to this range. */
  colorLerp: [number, number];
  skyReflection: number;
  /** The ramp that colours the sea floor by depth. */
  ramp: string | null;
}

export interface MapStratum {
  albedo: string | null;
  /** World units per repeat of the texture. */
  albedoScale: number;
  normal: string | null;
  normalScale: number;
}

export interface MapDecal {
  kind: 'albedo' | 'normals';
  texture: string;
  /** The corner the decal grows from along +x and +z. */
  position: Vec3;
  /** Radians around each axis; terrain decals turn around y only, about their corner, +x toward +z. */
  rotation: Vec3;
  scale: Vec3;
}

export interface MapPropLod {
  mesh: string;
  albedo: string | null;
  /** Texels with less alpha are dropped, as the alpha test of the mesh shader does; 0 keeps every texel. */
  alphaCutoff: number;
  /** Camera distance up to which the game shows this level. */
  cutoff: number;
}

/** PROP_INSTANCE_FLOATS per instance: position, the three rows of the rotation, scale with the blueprint's applied. */
export const PROP_INSTANCE_FLOATS = 15;

export interface MapPropGroup {
  blueprint: string;
  lods: MapPropLod[];
  instances: Float32Array;
}

export interface MapMarker {
  kind: 'mass' | 'hydro' | 'spawn';
  x: number;
  z: number;
  /** The number of a start position. */
  army: number | null;
}

export interface MapScene {
  folderName: string;
  /** Size in game units, which is also the number of heightmap cells. */
  width: number;
  height: number;
  /** (width + 1) × (height + 1) samples, row by row from the north-west corner; heightScale turns them into units. */
  heights: Uint16Array;
  heightScale: number;
  /** The technique of effects/terrain.fx the map draws its terrain with, such as TTerrainXP or FAF's Terrain250. */
  terrainShader: string;
  lighting: MapLighting;
  water: MapWater | null;
  /** Lower stratum, the eight the masks blend in, upper stratum. */
  strata: MapStratum[];
  /** Blend masks of strata 1–4 and 5–8, their largest level only. */
  masks: [MapTexture | null, MapTexture | null];
  decals: MapDecal[];
  props: MapPropGroup[];
  markers: MapMarker[];
  /** Every texture and mesh the scene refers to, loaded afterwards in parts. */
  textures: string[];
  meshes: string[];
}
