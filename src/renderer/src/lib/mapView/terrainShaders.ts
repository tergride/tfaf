// The terrain shaders of effects/terrain.fx, by what changes how the map view draws them. Besides Supreme Commander's
// TTerrain and TTerrainXP, FAF adds families named by digits (see the "FAF Terrain Shaders" page of the FAF wiki):
// the first is the lighting (0 legacy, 1 PBR, 2 PBR with height-based splatting), the second the mask range (0 full,
// 5 the upper half), the third how the lower stratum is laid over the rest again, and a trailing B maps strata 3
// and 4 from the sides. These shaders keep map-wide textures in stratum 8 and the upper stratum.

export const TerrainFamily = {
  /** TTerrain and TTerrainGlow: four strata, specular from the inverted albedo alpha. */
  legacy: 0,
  /** TTerrainXP, and any shader the view does not know. */
  xp: 1,
  /** TTerrainXPExt, Terrain000 and Terrain050: TTerrainXP with the terrain info and normal textures. */
  ext: 2,
  /** Terrain001 and Terrain051: normals blended by UDN, the upper stratum a specular map. */
  udn: 3,
  /** Terrain1xx: PBR lighting with the roughness of the upper stratum's atlas. */
  pbr: 4,
  /** Terrain2xx: PBR and height-based splatting, every other stratum turned. */
  splat: 5,
  /** Terrain301 of the old map generator: like Terrain250 with its own texture layout. */
  old: 6,
} as const;

export type TerrainFamily = (typeof TerrainFamily)[keyof typeof TerrainFamily];

export interface TerrainShader {
  family: TerrainFamily;
  /** Masks of the albedo strata stretched by *2-1, so only their upper half shows. */
  albedoHalfRange: boolean;
  normalHalfRange: boolean;
  /** The lower stratum laid over the rest again: 0 not, 1 by its alpha, 2 multiplied in by its alpha. */
  macrotexture: 0 | 1 | 2;
  /** Strata 3 and 4 (the third and fourth masked) are mapped from the sides as well as from above. */
  biplanar: boolean;
}

const LEGACY_SHADERS = new Set(['tterrain', 'tterrainglow']);

export function terrainShader(name: string): TerrainShader {
  const key = name.trim().toLowerCase();
  const shader = (family: TerrainFamily, albedoHalfRange: boolean, normalHalfRange: boolean, macrotexture: 0 | 1 | 2 = 0, biplanar = false): TerrainShader => ({
    family,
    albedoHalfRange,
    normalHalfRange,
    macrotexture,
    biplanar,
  });
  if (LEGACY_SHADERS.has(key)) {
    return shader(TerrainFamily.legacy, true, false);
  }
  switch (key) {
    case 'tterrainxpext':
      return shader(TerrainFamily.ext, true, false);
    case 'terrain000':
      return shader(TerrainFamily.ext, false, false);
    case 'terrain050':
      return shader(TerrainFamily.ext, true, true);
    case 'terrain001':
      return shader(TerrainFamily.udn, false, false, 1);
    case 'terrain051':
      return shader(TerrainFamily.udn, true, true, 1);
    case 'terrain301':
      return shader(TerrainFamily.old, true, true);
  }
  const numbered = /^terrain([12])([05])([012])(b?)$/.exec(key);
  if (numbered) {
    const half = numbered[2] === '5';
    return shader(
      numbered[1] === '1' ? TerrainFamily.pbr : TerrainFamily.splat,
      half,
      half,
      Number(numbered[3]) as 0 | 1 | 2,
      numbered[4] === 'b',
    );
  }
  return shader(TerrainFamily.xp, true, false);
}
