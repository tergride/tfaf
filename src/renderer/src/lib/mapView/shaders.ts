// GLSL of the map view. The terrain follows effects/terrain.fx of the game (TTerrain, TTerrainXP, FAF's numbered
// shaders, the decal techniques and the lighting functions), drawn from straight above: the strata go into an albedo
// and a normal buffer, the decals are blended into those, then one pass lights the result and tints the water. Props
// come on top. One program per pass covers every terrain shader; uFamily (terrainShaders.ts) picks the branch.

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
`;

// Heights are stored as the file has them, 16-bit integers, and interpolated here.
const HEIGHTS = `
uniform usampler2D uHeights;
uniform float uHeightScale;
uniform ivec2 uHeightSize;

float heightAt(ivec2 p) {
  return float(texelFetch(uHeights, clamp(p, ivec2(0), uHeightSize - 1), 0).r) * uHeightScale;
}

float heightAt(vec2 world) {
  vec2 p = clamp(world, vec2(0.0), vec2(uHeightSize - 1));
  ivec2 i = ivec2(floor(p));
  vec2 f = p - vec2(i);
  float h00 = heightAt(i);
  float h10 = heightAt(i + ivec2(1, 0));
  float h01 = heightAt(i + ivec2(0, 1));
  float h11 = heightAt(i + ivec2(1, 1));
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}
`;

// The shadow texture has one texel per sample of a grid over the map, corners included.
const SHADOW = `
uniform sampler2D uShadow;
uniform vec2 uShadowSize;

float shadowAt(vec2 world, vec2 mapSize) {
  return texture(uShadow, (world / mapSize * (uShadowSize - 1.0) + 0.5) / uShadowSize).r;
}
`;

// The water as terrain.fx, mesh.fx and water2.fx shade it from straight above. The engine fills the depth texture of
// the shaders from the heights when it loads a map, the same way as waterDepth here. Maps whose lighting multiplier
// is above 2.1 use FAF's absorption model instead of the plain ramp.
const WATER = `
uniform sampler2D uRamp;
uniform float uHasWater;
uniform float uHasRamp;
uniform float uAdvancedWater;
uniform float uWaterElevation;
uniform float uWaterAbyss;
uniform vec3 uSurfaceColor;
uniform vec2 uColorLerp;
uniform float uSkyReflection;
uniform vec3 uSkyColor;

float waterDepth(float height) {
  return clamp((uWaterElevation - height) / max(uWaterElevation - uWaterAbyss, 0.001), 0.0, 1.0);
}

// ApplyWaterColor: the light that reaches what lies under water at this depth.
vec3 underwater(vec3 color, float depth) {
  if (uHasWater == 0.0 || uHasRamp == 0.0 || depth <= 0.0) {
    return color;
  }
  if (uAdvancedWater > 0.0) {
    // A straight look travels the depth once, the light comes in over twice that.
    float absorption = 1.0 - exp(-3.0 * depth);
    color *= 1.0 - absorption;
    return mix(color, texture(uRamp, vec2(absorption, 0.5)).rgb, absorption);
  }
  vec4 water = texture(uRamp, vec2(depth, 0.5));
  return mix(color, water.rgb, water.a);
}

// The surface of water2.fx over a sea floor this deep: its colour, and the sky at the fresnel of a straight look.
vec3 waterSurface(vec3 color, float floorDepth) {
  color = mix(color, uSurfaceColor, clamp(floorDepth, uColorLerp.x, uColorLerp.y));
  float sky = uSkyReflection == 1.5 ? 1.0 : uSkyReflection;
  return mix(color, uSkyColor, clamp(0.08 * sky, 0.0, 1.0));
}
`;

/** A full-screen triangle pair; vWorld is the point of the map under the pixel, x east and z south. */
export const SCREEN_VERTEX = `${HEADER}
in vec2 aCorner;
uniform vec4 uView;
out vec2 vWorld;

void main() {
  vec2 uv = aCorner * 0.5 + 0.5;
  vWorld = vec2(uView.x + uv.x * uView.z, uView.y + (1.0 - uv.y) * uView.w);
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`;

/**
 * Normals of the heightmap, one per height sample, like the normal map an editor bakes into the file. Only x and z
 * are kept, as the game keeps them; y is the rest of the unit length.
 */
export const TERRAIN_NORMALS_BAKE = `${HEADER}
${HEIGHTS}
out vec4 outColor;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float west = heightAt(p + ivec2(-1, 0));
  float east = heightAt(p + ivec2(1, 0));
  float north = heightAt(p + ivec2(0, -1));
  float south = heightAt(p + ivec2(0, 1));
  vec3 normal = normalize(vec3(west - east, 2.0, north - south));
  outColor = vec4(normal.xz * 0.5 + 0.5, 0.0, 1.0);
}
`;

/** Soft shadows of the terrain from the sun, marched once over the heightmap. */
export const SHADOW_BAKE = `${HEADER}
${HEIGHTS}
uniform vec3 uSun;
uniform vec2 uCellSize;
uniform float uMaxHeight;
out vec4 outColor;

void main() {
  vec2 start = (gl_FragCoord.xy - 0.5) * uCellSize;
  float horizontal = length(uSun.xz);
  float result = 1.0;
  if (horizontal > 0.0001 && uSun.y > 0.0) {
    vec2 direction = uSun.xz / horizontal;
    float rise = uSun.y / horizontal;
    float base = heightAt(start) + 0.05;
    float travel = 0.5 * max(uCellSize.x, 1.0);
    for (int i = 0; i < 160; i++) {
      float rayHeight = base + travel * rise;
      if (rayHeight > uMaxHeight) {
        break;
      }
      float terrain = heightAt(start + direction * travel);
      result = min(result, 8.0 * (rayHeight - terrain) / travel);
      if (result <= 0.0) {
        break;
      }
      travel += max(0.5, travel * 0.04) * max(uCellSize.x, 1.0);
    }
  }
  outColor = vec4(vec3(clamp(result, 0.0, 1.0)), 1.0);
}
`;

const MASKS = ['mask0.x', 'mask0.y', 'mask0.z', 'mask0.w', 'mask1.x', 'mask1.y', 'mask1.z', 'mask1.w'];
// The cell of a stratum's height and roughness in the 2×2 atlas of the upper stratum, and which pair of channels.
const ATLAS_CELLS = ['vec2(0.5, 0.0)', 'vec2(0.0, 0.5)', 'vec2(0.5, 0.5)', 'vec2(0.0, 0.0)', 'vec2(0.5, 0.0)', 'vec2(0.0, 0.5)', 'vec2(0.5, 0.5)'];
const ATLAS_FIRST = [true, true, true, false, false, false, false];
const BIPLANAR = [false, false, true, true, false, false, false];

/** GLSL lines for strata 0 to `count` - 1. */
function strata(count: number, line: (index: number) => string): string {
  return Array.from({ length: count }, (_, index) => line(index)).join('\n  ');
}

/** A stratum's entry of one of the tables above; a stratum past the table's end would put `undefined` into the GLSL. */
function of<T>(table: readonly T[], index: number): T {
  const value = table[index];
  if (value === undefined) {
    throw new RangeError(`No stratum ${index} in a table of ${table.length}`);
  }
  return value;
}

// What both strata passes share: the masks, the strata's textures and scales, and the textures FAF's shaders keep in
// stratum 8 and the upper stratum. uHas marks the textures of the pass that the map has.
const TERRAIN = `
${HEIGHTS}
uniform vec2 uMapSize;
uniform sampler2D uMask0;
uniform sampler2D uMask1;
uniform float uAlbedoScale[10];
uniform float uNormalScale[10];
uniform float uHas[10];
uniform int uFamily;
uniform float uAlbedoHalfRange;
uniform float uNormalHalfRange;
uniform int uMacrotexture;
uniform float uBiplanar;
uniform vec4 uSpecular;
uniform sampler2D uLower;
uniform sampler2D uStratum0;
uniform sampler2D uStratum1;
uniform sampler2D uStratum2;
uniform sampler2D uStratum3;
uniform sampler2D uStratum4;
uniform sampler2D uStratum5;
uniform sampler2D uStratum6;
uniform sampler2D uStratum7;
// The upper stratum's albedo: a macrotexture, Terrain001's specular map, or the atlas of heights and roughness.
uniform sampler2D uUpper;
// Stratum 8's normal: the map's normal texture, or Terrain301's atlas.
uniform sampler2D uMapNormal;
in vec2 vWorld;

const int LEGACY = 0;
const int XP = 1;
const int EXT = 2;
const int UDN = 3;
const int PBR = 4;
const int SPLAT = 5;
const int OLD = 6;

vec4 halfRange(vec4 mask) {
  return clamp(mask * 2.0 - 1.0, 0.0, 1.0);
}

// atlas2D: a cell of the upper stratum's atlas, repeated with the stratum; the derivatives keep its edges from seams.
vec4 atlas(vec2 uv, vec2 cell) {
  return textureGrad(uUpper, fract(uv) / 4.0 + cell + 0.125, dFdx(uv) / 8.0, dFdy(uv) / 8.0);
}

// atlas2D of Terrain301, whose atlas is stratum 8's normal.
vec4 oldAtlas(vec2 uv, vec2 cell) {
  return textureGrad(uMapNormal, fract(uv) / 4.0 + cell + 0.125, dFdx(uv) / 4.0, dFdy(uv) / 4.0);
}

// sampleAlbedo: the albedo with the stratum's roughness in its alpha.
vec4 pbrAlbedo(sampler2D map, vec2 uv, vec2 cell, bool first) {
  vec4 albedo = texture(map, uv);
  vec4 atlasValue = atlas(uv, cell);
  albedo.a = first ? atlasValue.x : atlasValue.z;
  return albedo;
}

vec4 oldAlbedo(sampler2D map, vec2 uv, vec2 cell, bool first) {
  vec4 albedo = texture(map, uv);
  vec4 atlasValue = oldAtlas(uv, cell);
  albedo.a = first ? atlasValue.y : atlasValue.w;
  return albedo;
}

// sampleHeight: the material's height at a near and a far scale.
float pbrHeight(vec2 near, vec2 far, vec2 cell, bool first) {
  vec4 a = atlas(near, cell);
  vec4 b = atlas(far, cell);
  return first ? (a.y + b.y) / 2.0 : (a.w + b.w) / 2.0;
}

float oldHeight(vec2 near, vec2 far, vec2 cell, bool first) {
  vec4 a = oldAtlas(near, cell);
  vec4 b = oldAtlas(far, cell);
  return first ? (a.x + b.x) / 2.0 : (a.z + b.z) / 2.0;
}

// The share of the second material where it lies over the first, by its height (splatLerp).
float splatFactor(float height, float opacity) {
  float blurriness = max(uSpecular.r, 0.0001);
  height = mix(height, 0.5, blurriness);
  // Increase the contrast of the height.
  height = (1.0 + uSpecular.g) * height - 0.5 * uSpecular.g;
  if (opacity <= 0.0) {
    return 0.0;
  }
  return opacity >= 1.0 ? 1.0 : clamp((height + opacity - 1.0 + 0.5 * blurriness) / blurriness, 0.0, 1.0);
}

vec2 oldSplatFactors(float height, float opacity) {
  float blurriness = max(uSpecular.r, 0.0001);
  float height2 = height * (1.0 - 2.0 * blurriness) + blurriness + opacity;
  float top = max(1.0, height2) - blurriness;
  vec2 factors = vec2(max(1.0 - top, 0.0), max(height2 - top, 0.0));
  return factors / (factors.x + factors.y);
}

// Turns positions by the angle of uSpecular.b and .a (Terrain2xx) or 30° (Terrain301), as mul(position, rotation).
vec2 rotated(vec2 p, vec2 cosSin) {
  return vec2(p.x * cosSin.x + p.y * cosSin.y, -p.x * cosSin.y + p.y * cosSin.x);
}

// calculateBlendWeights: how much the sides of a slope face east-west and north-south, from the map's normals. Flat
// ground has neither, which the game divides by zero; both sides then count the same here.
vec2 biplanarWeights(vec2 mapUv) {
  vec2 normal = texture(uMapNormal, mapUv).ag * 2.0 - 1.0;
  vec2 weights = pow(abs(normal), vec2(3.0));
  float sum = weights.x + weights.y;
  return sum > 0.000001 ? weights / sum : vec2(0.5);
}
`;

/**
 * The albedo of the strata, as the albedo shaders of terrain.fx blend it before they light it. Alpha is what the
 * lighting reads from the albedo: the specular amount of the legacy shaders or the roughness of the PBR ones.
 */
export const TERRAIN_ALBEDO = `${HEADER}
${TERRAIN}
out vec4 outColor;

// TerrainPS, TerrainAlbedoXP, Terrain000AlbedoPS and Terrain001AlbedoPS.
vec4 legacyAlbedo(vec4 mask0, vec4 mask1, int count) {
  vec4 lower = uHas[0] > 0.0 ? texture(uLower, vWorld / uAlbedoScale[0]) : vec4(0.45, 0.45, 0.45, 0.0);
  vec4 albedo = lower;
  ${strata(8, (i) => `if (${i} < count) albedo = mix(albedo, texture(uStratum${i}, vWorld / uAlbedoScale[${i + 1}]), ${of(MASKS, i)} * uHas[${i + 1}]);`)}
  if (uFamily == UDN) {
    return mix(albedo, lower, lower.a * uHas[0]);
  }
  vec4 upper = texture(uUpper, vWorld / uAlbedoScale[9]);
  albedo.rgb = mix(albedo.rgb, upper.rgb, upper.a * uHas[9]);
  return albedo;
}

// Terrain100AlbedoPS, Terrain200AlbedoPS and their biplanar variants.
vec4 pbrAlbedo(vec4 mask0, vec4 mask1, vec2 mapUv) {
  bool splat = uFamily == SPLAT;
  vec2 turn = uSpecular.ba;
  vec2 weights = uBiplanar > 0.0 ? biplanarWeights(mapUv) : vec2(0.0, 1.0);
  float height = uBiplanar > 0.0 ? heightAt(vWorld) : 0.0;
  vec4 albedo = uHas[0] > 0.0 ? pbrAlbedo(uLower, vWorld / uAlbedoScale[0], vec2(0.0), true) : vec4(0.45, 0.45, 0.45, 0.5);
  vec2 world;
  vec4 stratum;
  float stratumHeight;
  ${strata(7, (i) => {
    const turned = i % 2 === 0;
    const near = `world / uAlbedoScale[${i + 1}]`;
    const far = `world / uNormalScale[${i + 1}]`;
    const sideways = BIPLANAR[i]
      ? `if (uBiplanar > 0.0) {
    vec2 xz = vec2(vWorld.x, height);
    vec2 yz = vec2(vWorld.y, height);
    stratum = pbrAlbedo(uStratum${i}, yz / uAlbedoScale[${i + 1}], ${of(ATLAS_CELLS, i)}, ${of(ATLAS_FIRST, i)}) * weights.x
      + pbrAlbedo(uStratum${i}, xz / uAlbedoScale[${i + 1}], ${of(ATLAS_CELLS, i)}, ${of(ATLAS_FIRST, i)}) * weights.y;
    stratumHeight = (pbrHeight(yz / uAlbedoScale[${i + 1}], yz / uNormalScale[${i + 1}], ${of(ATLAS_CELLS, i)}, ${of(ATLAS_FIRST, i)}) * weights.x
      + pbrHeight(xz / uAlbedoScale[${i + 1}], xz / uNormalScale[${i + 1}], ${of(ATLAS_CELLS, i)}, ${of(ATLAS_FIRST, i)}) * weights.y);
  } else {`
      : '{';
    return `world = ${turned ? 'splat ? rotated(vWorld, turn) : vWorld' : 'vWorld'};
  ${sideways}
    stratum = pbrAlbedo(uStratum${i}, ${near}, ${of(ATLAS_CELLS, i)}, ${of(ATLAS_FIRST, i)});
    stratumHeight = splat ? pbrHeight(${near}, ${far}, ${of(ATLAS_CELLS, i)}, ${of(ATLAS_FIRST, i)}) : 0.0;
  }
  albedo = mix(albedo, stratum, (splat ? splatFactor(stratumHeight, ${of(MASKS, i)}) : ${of(MASKS, i)}) * uHas[${i + 1}]);`;
  })}
  if (uMacrotexture > 0 && uHas[0] > 0.0) {
    vec4 macro = texture(uLower, vWorld / uAlbedoScale[0]);
    albedo.rgb = mix(albedo.rgb, uMacrotexture == 1 ? macro.rgb : 2.0 * macro.rgb * albedo.rgb, macro.a);
  }
  // applyPbrShading: the layer mask of stratum 8 scales the roughness, 0.5 leaves it.
  albedo.a = clamp(albedo.a * mask1.w * 2.0 + 0.01, 0.0, 1.0);
  return albedo;
}

// Terrain301AlbedoPS.
vec4 oldAlbedo(vec4 mask0, vec4 mask1, vec2 mapUv) {
  vec2 turn = vec2(0.866, 0.5);
  vec4 albedo = uHas[0] > 0.0 ? oldAlbedo(uLower, vWorld / uAlbedoScale[0], vec2(0.0), true) : vec4(0.45, 0.45, 0.45, 0.5);
  vec2 world;
  vec2 factors;
  ${strata(7, (i) => `world = ${i % 2 === 0 ? 'rotated(vWorld, turn)' : 'vWorld'};
  factors = oldSplatFactors(oldHeight(world / uAlbedoScale[${i + 1}], world / uNormalScale[${i + 1}], ${of(ATLAS_CELLS, i)}, ${of(ATLAS_FIRST, i)}), ${of(MASKS, i)});
  albedo = mix(albedo, albedo * factors.x + oldAlbedo(uStratum${i}, world / uAlbedoScale[${i + 1}], ${of(ATLAS_CELLS, i)}, ${of(ATLAS_FIRST, i)}) * factors.y, uHas[${i + 1}]);`)}
  vec4 mapwide = texture(uStratum7, mapUv);
  albedo.rgb = mix(albedo.rgb, mapwide.rgb, mapwide.a * uHas[8]);
  albedo.a = clamp(albedo.a * mask1.w * 2.0 + 0.01, 0.0, 1.0);
  return albedo;
}

void main() {
  if (vWorld.x < 0.0 || vWorld.y < 0.0 || vWorld.x > uMapSize.x || vWorld.y > uMapSize.y) {
    outColor = vec4(0.0);
    return;
  }
  vec2 mapUv = vWorld / uMapSize;
  vec4 mask0 = clamp(texture(uMask0, mapUv), 0.0, 1.0);
  vec4 mask1 = uFamily == LEGACY ? vec4(0.0) : clamp(texture(uMask1, mapUv), 0.0, 1.0);
  if (uAlbedoHalfRange > 0.0) {
    mask0 = halfRange(mask0);
    // The PBR shaders keep the roughness mask of stratum 8 as it is.
    mask1 = uFamily == PBR || uFamily == SPLAT ? vec4(halfRange(mask1).xyz, mask1.w) : halfRange(mask1);
  }
  vec4 albedo;
  if (uFamily == PBR || uFamily == SPLAT) {
    albedo = pbrAlbedo(mask0, mask1, mapUv);
  } else if (uFamily == OLD) {
    albedo = oldAlbedo(mask0, mask1, mapUv);
  } else {
    albedo = legacyAlbedo(mask0, mask1, uFamily == LEGACY ? 4 : uFamily == XP ? 8 : 7);
    // Terrain001 takes its specular from a map of its own.
    albedo.a = uFamily == UDN ? 1.0 : albedo.a;
  }
  // Alpha 0 marks the outside of the map, so what the lighting reads from it keeps a minimum.
  outColor = vec4(albedo.rgb, max(albedo.a, 0.004));
}
`;

/**
 * The normal shaders of terrain.fx and TTerrainBasis: the normal buffer holds what the game's does. Red and green are
 * x and z of the strata's normal maps blended by the masks, which the decals blend into; blue and alpha are x and z
 * of the relief's normal, from the heights or from the map's normal texture, which nothing covers.
 */
export const TERRAIN_NORMALS = `${HEADER}
${TERRAIN}
uniform sampler2D uTerrainNormals;
uniform float uHasMapNormal;
// The normal buffer is the frame's second attachment.
layout(location = 1) out vec4 outColor;

vec4 detail(sampler2D map, vec2 uv, float has) {
  return has > 0.0 ? normalize(texture(map, uv) * 2.0 - 1.0) : vec4(0.0, 0.0, 1.0, 0.0);
}

vec3 detail3(sampler2D map, vec2 uv, float has) {
  return has > 0.0 ? normalize(texture(map, uv).xyz * 2.0 - 1.0) : vec3(0.0, 0.0, 1.0);
}

vec3 udn(vec3 n1, vec3 n2, float factor) {
  return normalize(vec3(n1.xy + n2.xy * factor, n1.z));
}

// splatBlendNormal: low opacities still show, as small changes to the albedo are noticed more easily.
vec3 splatNormal(vec3 n1, vec3 n2, float factor) {
  factor = pow(factor, 0.6);
  return normalize(vec3(n1.xy * (1.0 - factor) + n2.xy * factor, n1.z));
}

// TerrainNormalsPS, TerrainNormalsXP and Terrain000NormalsPS.
vec3 legacyNormal(vec4 mask0, vec4 mask1, int count) {
  vec4 normal = detail(uLower, vWorld / uNormalScale[0], uHas[0]);
  ${strata(8, (i) => `if (${i} < count) {
    vec4 stratum = detail(uStratum${i}, vWorld / uNormalScale[${i + 1}], uHas[${i + 1}]);
    normal = uFamily == EXT ? normalize(mix(normal, stratum, ${of(MASKS, i)})) : mix(normal, stratum, ${of(MASKS, i)});
  }`)}
  return normalize(normal.xyz);
}

// Terrain001NormalsPS, Terrain100NormalsPS and Terrain100BNormalsPS.
vec3 udnNormal(vec4 mask0, vec4 mask1, vec2 mapUv) {
  vec2 weights = uBiplanar > 0.0 ? biplanarWeights(mapUv) : vec2(0.0, 1.0);
  float height = uBiplanar > 0.0 ? heightAt(vWorld) : 0.0;
  vec3 normal = uFamily == UDN ? detail(uLower, vWorld / uNormalScale[0], uHas[0]).xyz : detail3(uLower, vWorld / uNormalScale[0], uHas[0]);
  vec3 stratum;
  ${strata(7, (i) => {
    const plain = `detail3(uStratum${i}, vWorld / uNormalScale[${i + 1}], uHas[${i + 1}])`;
    const sideways = BIPLANAR[i]
      ? `uBiplanar > 0.0
    ? detail3(uStratum${i}, vec2(vWorld.y, height) / uNormalScale[${i + 1}], uHas[${i + 1}]) * weights.x
      + detail3(uStratum${i}, vec2(vWorld.x, height) / uNormalScale[${i + 1}], uHas[${i + 1}]) * weights.y
    : `
      : '';
    return `stratum = ${sideways}${plain};
  normal = udn(normal, stratum, ${of(MASKS, i)});`;
  })}
  return normal;
}

// Terrain200NormalsPS and Terrain200BNormalsPS.
vec3 splatNormal(vec4 mask0, vec4 mask1, vec2 mapUv) {
  vec2 turn = uSpecular.ba;
  vec2 weights = uBiplanar > 0.0 ? biplanarWeights(mapUv) : vec2(0.0, 1.0);
  float height = uBiplanar > 0.0 ? heightAt(vWorld) : 0.0;
  vec3 normal = detail3(uLower, vWorld / uNormalScale[0], uHas[0]);
  vec2 world;
  vec3 stratum;
  float stratumHeight;
  ${strata(7, (i) => {
    const turned = i % 2 === 0;
    const sideways = BIPLANAR[i]
      ? `if (uBiplanar > 0.0) {
    vec2 xz = vec2(vWorld.x, height);
    vec2 yz = vec2(vWorld.y, height);
    stratum = detail3(uStratum${i}, yz / uAlbedoScale[${i + 1}], uHas[${i + 1}]) * weights.x
      + detail3(uStratum${i}, xz / uAlbedoScale[${i + 1}], uHas[${i + 1}]) * weights.y;
    stratumHeight = pbrHeight(yz / uAlbedoScale[${i + 1}], yz / uNormalScale[${i + 1}], ${of(ATLAS_CELLS, i)}, ${of(ATLAS_FIRST, i)}) * weights.x
      + pbrHeight(xz / uAlbedoScale[${i + 1}], xz / uNormalScale[${i + 1}], ${of(ATLAS_CELLS, i)}, ${of(ATLAS_FIRST, i)}) * weights.y;
  } else {`
      : '{';
    const turnBack = turned
      ? `
    // The normal of a turned texture is turned back.
    stratum.xy = vec2(turn.x * stratum.x - turn.y * stratum.y, turn.y * stratum.x + turn.x * stratum.y);`
      : '';
    return `world = ${turned ? 'rotated(vWorld, turn)' : 'vWorld'};
  ${sideways}
    stratum = detail3(uStratum${i}, world / uAlbedoScale[${i + 1}], uHas[${i + 1}]);${turnBack}
    stratumHeight = pbrHeight(world / uAlbedoScale[${i + 1}], world / uNormalScale[${i + 1}], ${of(ATLAS_CELLS, i)}, ${of(ATLAS_FIRST, i)});
  }
  normal = splatNormal(normal, stratum, splatFactor(stratumHeight, ${of(MASKS, i)}));`;
  })}
  return normal;
}

// Terrain301NormalsPS: the old splatting, the lower normal at the lower albedo's scale.
vec3 oldNormal(vec4 mask0, vec4 mask1) {
  vec2 turn = vec2(0.866, 0.5);
  vec3 normal = detail3(uLower, vWorld / uAlbedoScale[0], uHas[0]);
  vec2 world;
  vec2 factors;
  ${strata(7, (i) => `world = ${i % 2 === 0 ? 'rotated(vWorld, turn)' : 'vWorld'};
  factors = pow(oldSplatFactors(oldHeight(world / uAlbedoScale[${i + 1}], world / uNormalScale[${i + 1}], ${of(ATLAS_CELLS, i)}, ${of(ATLAS_FIRST, i)}), ${of(MASKS, i)}), vec2(0.6));
  normal = normalize(vec3(normal.xy * factors.x + detail3(uStratum${i}, world / uAlbedoScale[${i + 1}], uHas[${i + 1}]).xy * factors.y, normal.z));`)}
  return normal;
}

void main() {
  vec2 mapUv = vWorld / uMapSize;
  vec4 mask0 = clamp(texture(uMask0, mapUv), 0.0, 1.0);
  vec4 mask1 = uFamily == LEGACY ? vec4(0.0) : clamp(texture(uMask1, mapUv), 0.0, 1.0);
  if (uNormalHalfRange > 0.0) {
    mask0 = halfRange(mask0);
    mask1 = halfRange(mask1);
  }
  vec3 normal;
  if (uFamily == UDN || uFamily == PBR) {
    normal = udnNormal(mask0, mask1, mapUv);
  } else if (uFamily == SPLAT) {
    normal = splatNormal(mask0, mask1, mapUv);
  } else if (uFamily == OLD) {
    normal = oldNormal(mask0, mask1);
  } else {
    normal = legacyNormal(mask0, mask1, uFamily == LEGACY ? 4 : uFamily == XP ? 8 : 7);
  }
  // The texture's x runs east and its y south, like the map's x and z.
  vec2 base = uHasMapNormal > 0.0 ? texture(uMapNormal, mapUv).ag : texture(uTerrainNormals, (vWorld + 0.5) / (uMapSize + 1.0)).rg;
  outColor = vec4(normal.xy * 0.5 + 0.5, base);
}
`;

/** A decal is a rectangle from its corner along two axes; drawn instanced, one decal per instance. */
export const DECAL_VERTEX = `${HEADER}
in vec2 aCorner;
in vec2 iOrigin;
in vec2 iAxisU;
in vec2 iAxisV;
uniform vec4 uView;
out vec2 vUv;
flat out vec2 vTangentU;
flat out vec2 vTangentV;

void main() {
  vec2 world = iOrigin + aCorner.x * iAxisU + aCorner.y * iAxisV;
  vUv = aCorner;
  vTangentU = normalize(iAxisU);
  vTangentV = normalize(iAxisV);
  gl_Position = vec4((world.x - uView.x) / uView.z * 2.0 - 1.0, 1.0 - (world.y - uView.y) / uView.w * 2.0, 0.0, 1.0);
}
`;

export const DECAL_ALBEDO = `${HEADER}
uniform sampler2D uTexture;
in vec2 vUv;
out vec4 outColor;

void main() {
  outColor = texture(uTexture, vUv);
}
`;

/**
 * DecalsNormalsPS: x and z in alpha and green, the blend factor in red. The decal turns them its way and they replace
 * the strata's normal in red and green only, so the relief stays under the decal.
 */
export const DECAL_NORMALS = `${HEADER}
uniform sampler2D uTexture;
in vec2 vUv;
flat in vec2 vTangentU;
flat in vec2 vTangentV;
// The normal buffer is the frame's second attachment.
layout(location = 1) out vec4 outColor;

void main() {
  vec4 raw = texture(uTexture, vUv);
  vec2 tangent = raw.ag * 2.0 - 1.0;
  vec2 planar = tangent.x * vTangentU + tangent.y * vTangentV;
  outColor = vec4(planar * 0.5 + 0.5, 0.0, raw.r);
}
`;

/**
 * The lighting of the terrain shaders (CalculateLighting, TerrainAlbedoXP, Terrain000AlbedoPS, Terrain001AlbedoPS,
 * PBR and PBR_old), then ApplyWaterColor and the water surface. The normal is put together the way BasisPS of
 * effects/frame.fx does: the strata's normal is turned to the relief's.
 */
export const COMPOSITE = `${HEADER}
${HEIGHTS}
uniform sampler2D uAlbedoBuffer;
uniform sampler2D uNormalBuffer;
${SHADOW}
${WATER}
uniform vec2 uMapSize;
uniform int uFamily;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uSunAmbience;
uniform vec3 uShadowFill;
uniform vec4 uSpecular;
uniform float uMultiplier;
uniform float uShadows;
// Stratum 8's albedo: the terrain info texture of FAF's shaders, with the shadow in alpha and occlusion in green.
uniform sampler2D uInfo;
uniform float uHasInfo;
// The upper stratum's albedo: Terrain001's specular map, Terrain301's shadow in alpha.
uniform sampler2D uUpper;
uniform float uHasUpper;
in vec2 vWorld;
out vec4 outColor;

const float PI = 3.14159265359;

vec3 basisNormal(vec4 raw) {
  raw = raw * 2.0 - 1.0;
  vec3 detail = vec3(raw.x, sqrt(max(0.0, 1.0 - dot(raw.xy, raw.xy))), raw.y);
  vec3 base = vec3(raw.z, sqrt(max(0.0, 1.0 - dot(raw.zw, raw.zw))), raw.w);
  vec3 h = normalize(base + vec3(0.0, 1.0, 0.0));
  vec3 xAxis = vec3(1.0 - 2.0 * h.x * h.x, 2.0 * h.x * h.y, -2.0 * h.x * h.z);
  vec3 zAxis = vec3(-2.0 * h.z * h.x, 2.0 * h.z * h.y, 1.0 - 2.0 * h.z * h.z);
  return normalize(vec3(dot(detail, xAxis), dot(detail, base), dot(detail, zAxis)));
}

float geometrySchlick(float nDotV, float roughness) {
  float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  return nDotV / (nDotV * (1.0 - k) + k);
}

// PBR of terrain.fx (Cook-Torrance) for a look from straight above; PBR_old has no occlusion.
vec3 pbr(vec3 albedo, vec3 n, float roughness, float depth, float shadow, float occlusion) {
  float facingSpecular = 0.04 * (1.0 - 0.9 * clamp(depth * 20.0, 0.0, 1.0));
  vec3 v = vec3(0.0, 1.0, 0.0);
  vec3 l = uSunDirection;
  vec3 h = normalize(v + l);
  float nDotL = max(dot(n, l), 0.0);
  float nDotV = abs(dot(n, v)) + 0.001;
  vec3 f = facingSpecular + (1.0 - facingSpecular) * pow(1.0 - max(dot(h, v), 0.0), 5.0) * vec3(1.0);
  float a2 = roughness * roughness;
  float nDotH = max(dot(n, h), 0.0);
  float denominator = nDotH * nDotH * (a2 - 1.0) + 1.0;
  float distribution = a2 / (PI * denominator * denominator);
  float geometry = geometrySchlick(nDotL, roughness) * geometrySchlick(nDotV, roughness);
  vec3 reflected = PI * distribution * geometry * f / (4.0 * nDotV * nDotL + 0.0001);
  vec3 color = ((1.0 - f) * albedo + reflected) * uSunColor * uMultiplier * shadow * nDotL;
  vec3 shadowColor = (1.0 - (uSunColor * shadow * nDotL + uSunAmbience)) * uShadowFill;
  return color + albedo * (uSunAmbience * occlusion * uMultiplier + shadowColor);
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec4 albedo = texelFetch(uAlbedoBuffer, pixel, 0);
  if (albedo.a == 0.0) {
    outColor = vec4(0.0);
    return;
  }
  vec2 mapUv = vWorld / uMapSize;
  vec3 normal = basisNormal(texelFetch(uNormalBuffer, pixel, 0));
  float terrain = heightAt(vWorld);
  float depth = uHasWater > 0.0 ? waterDepth(terrain) : 0.0;
  // The game casts no shadows of the terrain; FAF's shaders take them from the map's own textures, the view bakes
  // them where a map has none.
  float shadow = shadowAt(vWorld, uMapSize);
  float occlusion = 1.0;
  if (uFamily == 6) {
    shadow = uHasUpper > 0.0 && uShadows > 0.0 ? texture(uUpper, mapUv).a : shadow;
  } else if (uHasInfo > 0.0 && uFamily != 1) {
    vec4 info = texture(uInfo, mapUv);
    shadow = uShadows > 0.0 ? info.a : 1.0;
    occlusion = uFamily == 3 ? 1.0 : info.g;
  }
  vec3 view = vec3(0.0, -1.0, 0.0);
  float sunDotNormal = dot(uSunDirection, normal);
  vec3 color;
  if (uFamily == 0) {
    vec3 reflected = uSunDirection - 2.0 * sunDotNormal * normal;
    float specular = pow(clamp(dot(reflected, view), 0.0, 1.0), 80.0) * uSpecular.x * (1.0 - albedo.a);
    vec3 light = uSunColor * clamp(sunDotNormal, 0.0, 1.0) * shadow + uSunAmbience * occlusion + specular;
    light = uMultiplier * light + uShadowFill * (1.0 - light);
    color = light * albedo.rgb;
  } else if (uFamily == 4 || uFamily == 5 || uFamily == 6) {
    color = pbr(albedo.rgb, normal, albedo.a, depth, shadow, occlusion);
  } else {
    vec3 reflected = reflect(view, normal);
    vec3 specular;
    if (uFamily == 3) {
      vec4 map = uHasUpper > 0.0 ? texture(uUpper, mapUv) : vec4(0.0);
      specular = pow(clamp(dot(reflected, uSunDirection), 0.0, 1.0), 80.0 * map.a * uSpecular.r) * map.rgb * shadow * uSunColor;
    } else {
      specular = pow(clamp(dot(reflected, uSunDirection), 0.0, 1.0), 80.0) * albedo.a * uSpecular.a * uSpecular.rgb;
    }
    vec3 light = uSunColor * clamp(sunDotNormal, 0.0, 1.0) * shadow + uSunAmbience * occlusion;
    light = uMultiplier * light + uShadowFill * (1.0 - light);
    color = light * (albedo.rgb + specular);
  }
  if (uHasWater > 0.0) {
    color = underwater(color, depth);
    if (terrain < uWaterElevation) {
      color = waterSurface(color, depth);
    }
  }
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

/** Props as the meshes are, placed by the rows of their rotation; higher points are nearer the camera. */
export const PROP_VERTEX = `${HEADER}
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUv;
in vec3 iPosition;
in vec3 iRotationX;
in vec3 iRotationY;
in vec3 iRotationZ;
in vec3 iScale;
uniform vec4 uView;
uniform vec2 uDepth;
out vec2 vUv;
out vec3 vNormal;
out vec2 vWorld;
out float vHeight;

void main() {
  vec3 local = aPosition * iScale;
  vec3 world = iPosition + local.x * iRotationX + local.y * iRotationY + local.z * iRotationZ;
  vNormal = aNormal.x * iRotationX + aNormal.y * iRotationY + aNormal.z * iRotationZ;
  vUv = aUv;
  vWorld = world.xz;
  vHeight = world.y;
  float depth = clamp(1.0 - 2.0 * (world.y - uDepth.x) * uDepth.y, -1.0, 1.0);
  gl_Position = vec4((world.x - uView.x) / uView.z * 2.0 - 1.0, 1.0 - (world.z - uView.y) / uView.w * 2.0, depth, 1.0);
}
`;

export const PROP_FRAGMENT = `${HEADER}
${HEIGHTS}
uniform sampler2D uAlbedo;
${SHADOW}
${WATER}
uniform vec2 uMapSize;
uniform float uHasAlbedo;
uniform float uAlphaCutoff;
uniform float uUnpremultiply;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uSunAmbience;
uniform vec3 uShadowFill;
uniform float uMultiplier;
in vec2 vUv;
in vec3 vNormal;
in vec2 vWorld;
in float vHeight;
out vec4 outColor;

// The mip level the texture is read at. Smaller levels average the cut-out alpha with the holes around it, so
// leaves thin out and vanish as a prop gets smaller; scaling the alpha up by the level keeps their coverage.
float mipLevel(vec2 uv) {
  vec2 texels = uv * vec2(textureSize(uAlbedo, 0));
  vec2 dx = dFdx(texels);
  vec2 dy = dFdy(texels);
  return max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
}

void main() {
  // Some maps leave props outside their edges, where there is no terrain to stand on.
  if (any(lessThan(vWorld, vec2(0.0))) || any(greaterThan(vWorld, uMapSize))) {
    discard;
  }
  vec4 albedo = uHasAlbedo > 0.0 ? texture(uAlbedo, vUv) : vec4(0.4, 0.4, 0.4, 1.0);
  if (uAlphaCutoff > 0.0) {
    if (albedo.a * (1.0 + 0.25 * mipLevel(vUv)) < uAlphaCutoff) {
      discard;
    }
    // Cut-out textures are mostly black behind the leaves, so smaller mips darken by coverage; this undoes it.
    if (uUnpremultiply > 0.0) {
      albedo.rgb = min(albedo.rgb / max(albedo.a, 0.001), vec3(1.0));
    }
  }
  // Seen from above, the side that faces up is the one in view, whichever way the triangle winds.
  vec3 normal = normalize(vNormal);
  if (normal.y < 0.0) {
    normal = -normal;
  }
  float shadow = shadowAt(vWorld, uMapSize);
  vec3 light = uSunColor * clamp(dot(uSunDirection, normal), 0.0, 1.0) * shadow + uSunAmbience;
  light = uMultiplier * light + uShadowFill * (1.0 - light);
  vec3 color = light * albedo.rgb;
  // What stands in the water is seen through it, as the terrain under it is.
  if (uHasWater > 0.0 && vHeight < uWaterElevation) {
    color = underwater(color, waterDepth(vHeight));
    color = waterSurface(color, waterDepth(heightAt(vWorld)));
  }
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
