// What the map view needs from a prop blueprint (`*_prop.bp`): the meshes and textures of its levels of detail and the
// scale of the model. Names the blueprint leaves out follow the engine's convention, `<name>_lod<n>.scm` and
// `<name>_albedo.dds` next to the blueprint, as the FAF map editor resolves them too.

import { LuaFunction, LuaTable, type LuaValue, parseLua } from '../lua/luaParser.ts';
import { resolveGamePath } from './gamePaths.ts';

export interface PropLod {
  mesh: string;
  albedo: string | null;
  alphaCutoff: number;
  cutoff: number;
}

export interface PropModel {
  lods: PropLod[];
  uniformScale: number;
}

const DEFAULT_UNIFORM_SCALE = 1;
const DEFAULT_CUTOFF = 1000;

/** The table a blueprint file hands to `constructor`, such as `PropBlueprint { ... }`. */
export function readBlueprintTable(source: string, constructor: string): LuaTable | null {
  const captured: { blueprint: LuaTable | null } = { blueprint: null };
  const capture = new LuaFunction((args) => {
    const value = args[0];
    if (value instanceof LuaTable) {
      captured.blueprint = value;
    }
    return null;
  });
  const globals: [string, LuaValue][] = [[constructor, capture]];
  try {
    parseLua(source, { globals });
  } catch {
    parseLua(source, { globals, lenient: true });
  }
  return captured.blueprint;
}

function table(value: LuaValue): LuaTable | null {
  return value instanceof LuaTable ? value : null;
}

function text(value: LuaValue): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * The alpha reference of the mesh shader's technique (effects/mesh.fx): leaves of NormalMappedAlpha and its kin,
 * the far tree impostors of VertexNormal, clutter. TMeshAlpha, Supreme Commander's name that many trees and bushes
 * still use, cuts its leaves out the same way. The other techniques keep other data in the alpha.
 */
function alphaCutoff(shader: string): number {
  if (/^vertexnormal$/i.test(shader)) {
    return 0x23 / 255;
  }
  if (/clutter/i.test(shader)) {
    return 0x70 / 255;
  }
  if (/alpha/i.test(shader)) {
    return 0x80 / 255;
  }
  return 0;
}

/**
 * The model of the blueprint at `blueprintPath`, or null when it names no mesh at all or shrinks it to nothing, as
 * the markers of effect emitters (steam over lava, bubbles) do.
 */
export function readPropBlueprint(source: string, blueprintPath: string): PropModel | null {
  const blueprint = readBlueprintTable(source, 'PropBlueprint');
  const display = table(blueprint?.get('Display') ?? null);
  const lodTable = table(table(display?.get('Mesh') ?? null)?.get('LODs') ?? null);
  const base = blueprintPath.replace(/prop\.bp$/i, '');
  if (base === blueprintPath) {
    return null;
  }
  const scale = display?.get('UniformScale');
  if (scale === 0) {
    return null;
  }
  const uniformScale = typeof scale === 'number' && scale > 0 ? scale : DEFAULT_UNIFORM_SCALE;
  const entries = lodTable ? Array.from({ length: lodTable.length }, (_, i) => table(lodTable.get(i + 1))) : [];
  const lods: PropLod[] = [];
  let firstAlbedo: string | null = null;
  for (const [index, entry] of (entries.length > 0 ? entries : [null]).entries()) {
    const meshName = text(entry?.get('MeshName') ?? null);
    const mesh = meshName ? resolveGamePath(blueprintPath, meshName) : resolveGamePath(blueprintPath, `${base}lod${index}.scm`);
    const albedoName = text(entry?.get('AlbedoName') ?? null);
    const albedo: string | null = albedoName
      ? resolveGamePath(blueprintPath, albedoName)
      : index === 0
        ? resolveGamePath(blueprintPath, `${base}albedo.dds`)
        : firstAlbedo;
    if (index === 0) {
      firstAlbedo = albedo;
    }
    const cutoff = entry?.get('LODCutoff');
    const shader = text(entry?.get('ShaderName') ?? null) ?? '';
    if (mesh) {
      lods.push({
        mesh,
        albedo,
        alphaCutoff: alphaCutoff(shader),
        cutoff: typeof cutoff === 'number' && cutoff > 0 ? cutoff : DEFAULT_CUTOFF,
      });
    }
  }
  return lods.length > 0 ? { lods, uniformScale } : null;
}
