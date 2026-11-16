// Scenes of the map view: everything about a map the renderer needs to draw it the way the game does. The scene comes
// first, its textures and meshes afterwards in parts, so the view shows the terrain while props still load.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  type MapDecal,
  type MapMesh,
  type MapPropGroup,
  type MapScene,
  type MapStratum,
  type MapTexture,
  PROP_INSTANCE_FLOATS,
} from '../../shared/contract.ts';
import { describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import type { SettingsStore } from '../settings.ts';
import { readTextFile } from '../vault/fsUtil.ts';
import { readScenario, type ScenarioInfo } from '../vault/scenarioReader.ts';
import { readDds } from './ddsReader.ts';
import { GameFileSystem } from './gameFileSystem.ts';
import { gamePathKey, normalizeGamePath } from './gamePaths.ts';
import { type PropModel, readPropBlueprint } from './propBlueprint.ts';
import { readSaveMarkers } from './saveMarkers.ts';
import { readScm } from './scmReader.ts';
import { readScmap, type Scmap } from './scmapReader.ts';

const MAX_SCMAP_BYTES = 512 * 1024 ** 2;
const MAX_TEXTURE_BYTES = 128 * 1024 ** 2;
const MAX_FILE_BYTES = 16 * 1024 ** 2;
const DEFAULT_WATER_RAMP = '/textures/engine/waterramp.dds';

/** The file a scenario names, found in the map's own folder, or else the first one with the suffix. */
function pickFile(files: string[], gamePath: string | null, suffix: string): string | null {
  const wanted = gamePath?.split('/').filter(Boolean).at(-1)?.toLowerCase();
  return (
    (wanted ? files.find((file) => file.toLowerCase() === wanted) : undefined) ??
    files.find((file) => file.toLowerCase().endsWith(suffix)) ??
    null
  );
}

export class MapViewService {
  private readonly files: GameFileSystem;

  constructor(settings: Pick<SettingsStore, 'get' | 'mapsDirectory'>) {
    this.files = new GameFileSystem(settings);
  }

  /** Whether the map is on disk, so that its view can open. */
  async available(folderName: string): Promise<boolean> {
    const folder = await this.files.mapFolder(folderName);
    return folder !== null && pickFile(await readdir(folder).catch(() => []), null, '.scmap') !== null;
  }

  async scene(folderName: string): Promise<MapScene> {
    const folder = await this.files.mapFolder(folderName);
    if (!folder) {
      throw new Error(t('main.mapView.notFound', { name: folderName }));
    }
    await this.files.refresh();
    const files = await readdir(folder);
    const scenario = await this.readScenarioFile(folder, files);
    const scmapName = pickFile(files, scenario?.files.map ?? null, '.scmap');
    if (!scmapName) {
      throw new Error(t('main.mapView.noScmap', { name: folderName }));
    }
    const scmapFile = path.join(folder, scmapName);
    if ((await stat(scmapFile)).size > MAX_SCMAP_BYTES) {
      throw new Error(t('main.mapView.tooLarge', { name: folderName }));
    }
    const scmap = readScmap(await readFile(scmapFile));
    const saveName = pickFile(files, scenario?.files.save ?? null, '_save.lua');
    const markers = saveName ? await this.readMarkers(path.join(folder, saveName)) : [];
    const props = await this.propGroups(scmap);
    const scene = buildScene(folderName, scmap, props, markers);
    console.info(
      `Map view ${folderName}: version ${scmap.version}, ${scmap.width}x${scmap.height}, ${scmap.terrainShader}, ` +
        `${scene.decals.length} decals, ${scmap.props.length} props, ${scene.textures.length} textures, ${scene.meshes.length} meshes`,
    );
    return scene;
  }

  /**
   * Textures in the order of `paths`, without the mip levels larger than `maxSide`; null for one no mount has or that
   * is not a texture the view draws.
   */
  async textures(paths: string[], maxSide: number): Promise<(MapTexture | null)[]> {
    return Promise.all(paths.map((gamePath) => this.readAsset(gamePath, MAX_TEXTURE_BYTES, (data) => limitTexture(readDds(data), maxSide))));
  }

  async meshes(paths: string[]): Promise<(MapMesh | null)[]> {
    return Promise.all(paths.map((gamePath) => this.readAsset(gamePath, MAX_FILE_BYTES, readScm)));
  }

  private async readAsset<T>(gamePath: string, maxBytes: number, parse: (data: Uint8Array) => T | null): Promise<T | null> {
    const normalized = normalizeGamePath(gamePath);
    if (!normalized) {
      return null;
    }
    try {
      const data = await this.files.read(normalized, maxBytes);
      return data ? parse(data) : null;
    } catch (error) {
      console.warn(`Map view file ${normalized} could not be read: ${describeError(error)}`);
      return null;
    }
  }

  private async readScenarioFile(folder: string, files: string[]): Promise<ScenarioInfo | null> {
    const name = files.find((file) => file.toLowerCase().endsWith('_scenario.lua'));
    if (!name) {
      return null;
    }
    try {
      return readScenario(await readTextFile(path.join(folder, name)));
    } catch (error) {
      console.warn(`Scenario of ${folder} could not be read: ${describeError(error)}`);
      return null;
    }
  }

  private async readMarkers(file: string): Promise<MapScene['markers']> {
    try {
      return readSaveMarkers(await readTextFile(file));
    } catch (error) {
      console.warn(`Markers of ${file} could not be read: ${describeError(error)}`);
      return [];
    }
  }

  private async propGroups(scmap: Scmap): Promise<MapPropGroup[]> {
    const byBlueprint = new Map<string, { blueprint: string; props: Scmap['props'] }>();
    for (const prop of scmap.props) {
      const blueprint = normalizeGamePath(prop.blueprint);
      if (!blueprint) {
        continue;
      }
      const key = gamePathKey(blueprint);
      const group = byBlueprint.get(key) ?? { blueprint, props: [] };
      group.props.push(prop);
      byBlueprint.set(key, group);
    }
    const groups: MapPropGroup[] = [];
    for (const { blueprint, props } of byBlueprint.values()) {
      const model = await this.readModel(blueprint);
      if (!model) {
        continue;
      }
      const instances = new Float32Array(props.length * PROP_INSTANCE_FLOATS);
      props.forEach((prop, index) => {
        const scale = prop.scale.map((value) => value * model.uniformScale);
        instances.set([...prop.position, ...prop.rotation[0], ...prop.rotation[1], ...prop.rotation[2], ...scale], index * PROP_INSTANCE_FLOATS);
      });
      groups.push({ blueprint, lods: model.lods, instances });
    }
    return groups;
  }

  private async readModel(blueprint: string): Promise<PropModel | null> {
    try {
      const data = await this.files.read(blueprint, MAX_FILE_BYTES);
      return data ? readPropBlueprint(data.toString('latin1'), blueprint) : null;
    } catch (error) {
      console.warn(`Prop blueprint ${blueprint} could not be read: ${describeError(error)}`);
      return null;
    }
  }
}

/** The texture from its first level no larger than `maxSide`; one without such a level keeps its smallest. */
export function limitTexture(texture: MapTexture | null, maxSide: number): MapTexture | null {
  if (!texture) {
    return null;
  }
  let first = 0;
  let width = texture.width;
  let height = texture.height;
  while (first < texture.levels.length - 1 && Math.max(width, height) > maxSide) {
    first++;
    width = Math.max(1, width >> 1);
    height = Math.max(1, height >> 1);
  }
  return first === 0 ? texture : { ...texture, width, height, levels: texture.levels.slice(first) };
}

/** A mask's largest level: the renderer makes the smaller ones itself. */
function maskTexture(file: Uint8Array | null): MapTexture | null {
  const texture = file ? readDds(file) : null;
  return texture ? { ...texture, levels: texture.levels.slice(0, 1) } : null;
}

function buildScene(folderName: string, scmap: Scmap, props: MapPropGroup[], markers: MapScene['markers']): MapScene {
  const textures = new Map<string, string>();
  const meshes = new Map<string, string>();
  const texture = (raw: string): string | null => {
    const normalized = raw ? normalizeGamePath(raw) : null;
    if (normalized && !textures.has(gamePathKey(normalized))) {
      textures.set(gamePathKey(normalized), normalized);
    }
    return normalized;
  };

  const strata: MapStratum[] = scmap.strata.map((stratum) => ({
    albedo: texture(stratum.albedo),
    albedoScale: stratum.albedoScale > 0 ? stratum.albedoScale : 4,
    normal: texture(stratum.normal),
    normalScale: stratum.normalScale > 0 ? stratum.normalScale : 4,
  }));

  const decals: MapDecal[] = [];
  for (const decal of scmap.decals) {
    const kind = decal.type === 1 ? 'albedo' : decal.type === 2 || decal.type === 7 ? 'normals' : null;
    const file = kind ? texture(decal.textures[0] ?? '') : null;
    if (kind && file) {
      decals.push({ kind, texture: file, position: decal.position, rotation: decal.rotation, scale: decal.scale });
    }
  }

  const { water } = scmap;
  const ramp = water.present ? texture(water.rampTexture || DEFAULT_WATER_RAMP) : null;

  for (const group of props) {
    for (const lod of group.lods) {
      if (lod.albedo) {
        texture(lod.albedo);
      }
      meshes.set(gamePathKey(lod.mesh), lod.mesh);
    }
  }

  return {
    folderName,
    width: scmap.width,
    height: scmap.height,
    heights: scmap.heights,
    heightScale: scmap.heightScale,
    terrainShader: scmap.terrainShader,
    lighting: scmap.lighting,
    water: water.present
      ? {
          elevation: water.elevation,
          elevationAbyss: water.elevationAbyss,
          surfaceColor: water.surfaceColor,
          colorLerp: water.colorLerp,
          skyReflection: water.skyReflection,
          ramp,
        }
      : null,
    strata,
    masks: [maskTexture(scmap.masks[0]), maskTexture(scmap.masks[1])],
    decals,
    props,
    markers,
    textures: [...textures.values()],
    meshes: [...meshes.values()],
  };
}
