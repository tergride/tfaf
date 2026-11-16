// WebGL 2 drawing of a map scene from straight above. The heightmap and the scene's masks are uploaded once, the
// terrain normals and shadows are baked from the heights; every frame draws the strata and decals into an albedo and a
// normal buffer at the canvas size, lights them in one pass and draws the props on top.
//
// Textures come in at the size the view needs: each knows how many game units it covers, so the renderer works out
// the mip levels that a view this close can show and asks for those (wantedTextures). Far out only small levels
// load; zooming in asks for larger ones, which replace them.

import {
  MAP_TEXTURE_MAX_SIDE,
  type MapMesh,
  type MapScene,
  type MapTexture,
  PROP_INSTANCE_FLOATS,
} from '../../../../shared/contract.ts';
import { type DecalGeometry, decalGeometry } from './decalGeometry.ts';
import { decodeDxt } from './dxt.ts';
import * as shaders from './shaders.ts';
import { TerrainFamily, type TerrainShader, terrainShader } from './terrainShaders.ts';

/** The part of the map on the canvas, in game units. */
export interface MapViewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A texture the view should load, or load larger, with the largest mip level it needs. */
export interface WantedTexture {
  path: string;
  maxSide: number;
}

export class MapRenderError extends Error {}

interface Program {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
  attributes: Map<string, number>;
}

interface Decal {
  texture: string;
  geometry: DecalGeometry;
  bounds: [number, number, number, number];
}

interface MeshBuffers {
  position: WebGLBuffer;
  normal: WebGLBuffer;
  uv: WebGLBuffer;
  index: WebGLBuffer;
  indexCount: number;
  /** The share of the surface that faces up or down, which is what a look from above sees of it. */
  upRatio: number;
  /** The largest side of the bounds, in the model's units. */
  extent: number;
}

interface PropGroup {
  lods: MapScene['props'][number]['lods'];
  instances: WebGLBuffer;
  /** Instances sorted by chunk; chunkStarts[c] is the first of chunk c, the last entry their count. */
  chunkStarts: Int32Array;
  /** The largest scale of any instance, the blueprint's included. */
  maxScale: number;
  vaos: (WebGLVertexArrayObject | null)[];
}

interface LoadedTexture {
  texture: WebGLTexture | null;
  /** The largest side uploaded. */
  side: number;
  /** No larger level exists, or the file could not be read. */
  complete: boolean;
  /** Transparent texels are black, so colours can be divided by the alpha after filtering. */
  blackMatte: boolean;
}

/** What the renderer keeps of the scene once the heavy parts are on the GPU. */
type SceneInfo = Pick<MapScene, 'width' | 'height' | 'heightScale' | 'strata' | 'lighting' | 'water' | 'textures'>;

const PROP_CHUNK = 32;
const PROP_MARGIN = 12;
const SHADOW_MAX_CELLS = 1024;
const MAX_ANISOTROPY = 8;
// The camera distance the game would pick a prop's level of detail by, for a view this many units high.
const LOD_DISTANCE_PER_VIEW_UNIT = 1;
// A level of detail this flat is a card facing up, the picture of a tree crown from above that the game shows far out.
const FLAT_LOD_UP_RATIO = 0.9;
// Decals and props smaller than this many pixels are left out, as the game drops them by their cut-off.
const MIN_PIXELS = 0.6;
const DECAL_FLOATS = 6;
// The lighting multiplier above which maps use FAF's absorbing water (MapUsesAdvancedWater in the shaders).
const ADVANCED_WATER_MULTIPLIER = 2.1;
const MIN_TEXTURE_SIDE = 16;
// A prop's texture is an atlas of its parts, so a part shows fewer texels than the whole mesh would.
const PROP_ATLAS_FACTOR = 2;
// The model size assumed for a prop whose mesh has not loaded.
const DEFAULT_PROP_EXTENT = 20;
// The first attribute of each list is per vertex: location 0 must not be instanced.
const SCREEN_ATTRIBUTES = ['aCorner'];
const DECAL_ATTRIBUTES = ['aCorner', 'iOrigin', 'iAxisU', 'iAxisV'];
const PROP_INSTANCE_ATTRIBUTES = ['iPosition', 'iRotationX', 'iRotationY', 'iRotationZ', 'iScale'];
const PROP_ATTRIBUTES = ['aPosition', 'aNormal', 'aUv', ...PROP_INSTANCE_ATTRIBUTES];

function textureKey(path: string): string {
  return path.toLowerCase();
}

/** The mip level side that gives a texture covering `pixels` screen pixels at least one texel per pixel. */
function textureSide(pixels: number): number {
  const side = 2 ** Math.ceil(Math.log2(Math.max(1, pixels)));
  return Math.min(MAP_TEXTURE_MAX_SIDE, Math.max(MIN_TEXTURE_SIDE, side));
}

export class MapRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly scene: SceneInfo;
  private readonly shader: TerrainShader;
  /** The file's specular colour; FAF's shaders keep splatting and rotation settings in it. */
  private readonly specular: [number, number, number, number];
  /** Stratum 8 holds the terrain info texture and the map's normal texture, read once over the whole map. */
  private readonly infoTexture: boolean;
  private readonly mapNormalTexture: boolean;
  private readonly s3tc: WEBGL_compressed_texture_s3tc | null;
  private readonly anisotropy: EXT_texture_filter_anisotropic | null;
  private readonly programs: Record<'albedo' | 'normals' | 'decalAlbedo' | 'decalNormals' | 'composite' | 'props', Program>;
  private readonly screenQuad: WebGLVertexArrayObject;
  private readonly decalQuad: WebGLBuffer;
  private readonly decalInstances: WebGLBuffer;
  private readonly decalVao: WebGLVertexArrayObject;
  private readonly heights: WebGLTexture;
  private readonly terrainNormals: WebGLTexture;
  private readonly shadow: WebGLTexture;
  private readonly shadowSize: [number, number];
  private readonly masks: [WebGLTexture, WebGLTexture];
  private readonly blank: WebGLTexture;
  private readonly textures = new Map<string, LoadedTexture>();
  private readonly meshes = new Map<string, MeshBuffers | null>();
  private readonly decals: { albedo: Decal[]; normals: Decal[] };
  private readonly props: PropGroup[];
  private readonly chunksX: number;
  private readonly chunksZ: number;
  private readonly depth: [number, number];
  /** Strata and props tile their textures; decals stretch theirs once. */
  private readonly repeatedTextures: Set<string>;
  /** Game units one repeat of a stratum or decal texture covers; the water ramp is always loaded whole. */
  private readonly textureUnits = new Map<string, number>();
  /** The prop groups and levels of detail each prop texture is drawn on. */
  private readonly propTextures = new Map<string, { group: PropGroup; mesh: string }[]>();
  private frame: { framebuffer: WebGLFramebuffer; albedo: WebGLTexture; normals: WebGLTexture; width: number; height: number } | null = null;

  constructor(canvas: HTMLCanvasElement, scene: MapScene) {
    // Multisampling would only smooth the edges of props, at four times the memory of the canvas.
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: true, premultipliedAlpha: true });
    if (!gl) {
      throw new MapRenderError('webgl2');
    }
    this.gl = gl;
    const { width, height, heightScale, strata, lighting, water, textures } = scene;
    this.scene = { width, height, heightScale, strata, lighting, water, textures };
    this.shader = terrainShader(scene.terrainShader);
    // The values the file has for unused components can be noise.
    this.specular = lighting.specular.map((value) => (Number.isFinite(value) ? value : 0)) as [number, number, number, number];
    // A stratum's tile, the map size over its scale, below 1 is how the shaders tell a map-wide texture.
    const mapWide = (scale: number): boolean => scale > width;
    this.infoTexture = mapWide(strata[8]?.albedoScale ?? 0);
    this.mapNormalTexture = mapWide(strata[8]?.normalScale ?? 0);
    this.s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
    this.anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
    const maxSide = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (scene.width + 1 > maxSide || scene.height + 1 > maxSide) {
      throw new MapRenderError('size');
    }

    this.programs = {
      albedo: this.program(shaders.SCREEN_VERTEX, shaders.TERRAIN_ALBEDO, SCREEN_ATTRIBUTES),
      normals: this.program(shaders.SCREEN_VERTEX, shaders.TERRAIN_NORMALS, SCREEN_ATTRIBUTES),
      decalAlbedo: this.program(shaders.DECAL_VERTEX, shaders.DECAL_ALBEDO, DECAL_ATTRIBUTES),
      decalNormals: this.program(shaders.DECAL_VERTEX, shaders.DECAL_NORMALS, DECAL_ATTRIBUTES),
      composite: this.program(shaders.SCREEN_VERTEX, shaders.COMPOSITE, SCREEN_ATTRIBUTES),
      props: this.program(shaders.PROP_VERTEX, shaders.PROP_FRAGMENT, PROP_ATTRIBUTES),
    };
    const bakeNormals = this.program(shaders.SCREEN_VERTEX, shaders.TERRAIN_NORMALS_BAKE, SCREEN_ATTRIBUTES);
    const bakeShadow = this.program(shaders.SCREEN_VERTEX, shaders.SHADOW_BAKE, SCREEN_ATTRIBUTES);

    this.screenQuad = gl.createVertexArray();
    gl.bindVertexArray(this.screenQuad);
    this.vertexBuffer(new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), 0, 2);
    gl.bindVertexArray(null);

    this.decalQuad = this.buffer(new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]));
    this.decalInstances = this.buffer(new Float32Array(0), gl.DYNAMIC_DRAW);
    this.decalVao = gl.createVertexArray();

    this.blank = this.solidTexture([255, 255, 255, 255]);
    this.heights = this.heightTexture(scene.heights);
    this.masks = [this.maskTexture(scene.masks[0]), this.maskTexture(scene.masks[1])];

    let minHeight = Infinity;
    let maxHeight = -Infinity;
    for (const value of scene.heights) {
      minHeight = Math.min(minHeight, value);
      maxHeight = Math.max(maxHeight, value);
    }
    minHeight *= scene.heightScale;
    maxHeight *= scene.heightScale;
    this.depth = [minHeight - 10, 1 / Math.max(1, maxHeight - minHeight + 80)];

    this.terrainNormals = this.bake(bakeNormals, gl.RG8, scene.width + 1, scene.height + 1, () => undefined);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    const cells = Math.min(SHADOW_MAX_CELLS, Math.max(scene.width, scene.height));
    const cellSize = Math.max(scene.width, scene.height) / cells;
    this.shadowSize = [Math.floor(scene.width / cellSize) + 1, Math.floor(scene.height / cellSize) + 1];
    const sun = normalize(scene.lighting.sunDirection);
    this.shadow = this.bake(bakeShadow, gl.R8, this.shadowSize[0], this.shadowSize[1], (uniform) => {
      gl.uniform3f(uniform('uSun'), sun[0], sun[1], sun[2]);
      gl.uniform2f(uniform('uCellSize'), cellSize, cellSize);
      gl.uniform1f(uniform('uMaxHeight'), maxHeight + 1);
    });
    for (const program of [bakeNormals, bakeShadow]) {
      gl.deleteProgram(program.program);
    }

    const units = (path: string | null, value: number): void => {
      if (path) {
        const key = textureKey(path);
        this.textureUnits.set(key, Math.max(this.textureUnits.get(key) ?? 0, value));
      }
    };
    const mapSide = Math.max(width, height);
    for (const stratum of strata) {
      units(stratum.albedo, stratum.albedoScale > width ? mapSide : stratum.albedoScale);
      units(stratum.normal, stratum.normalScale > width ? mapSide : stratum.normalScale);
    }
    // The atlas of heights and roughness repeats with every stratum, so it loads whole.
    const { family } = this.shader;
    if (family === TerrainFamily.pbr || family === TerrainFamily.splat) {
      units(strata[9]?.albedo ?? null, Infinity);
    }
    if (family === TerrainFamily.old) {
      units(strata[8]?.normal ?? null, Infinity);
    }
    units(scene.water?.ramp ?? null, Infinity);

    this.decals = { albedo: [], normals: [] };
    for (const decal of scene.decals) {
      const geometry = decalGeometry(decal);
      const xs = [0, geometry[2], geometry[4], geometry[2] + geometry[4]].map((offset) => geometry[0] + offset);
      const zs = [0, geometry[3], geometry[5], geometry[3] + geometry[5]].map((offset) => geometry[1] + offset);
      this.decals[decal.kind].push({
        texture: textureKey(decal.texture),
        geometry,
        bounds: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)],
      });
      units(decal.texture, Math.max(Math.abs(decal.scale[0]), Math.abs(decal.scale[2])));
    }

    this.repeatedTextures = new Set(
      [...scene.strata.flatMap((stratum) => [stratum.albedo, stratum.normal]), ...scene.props.flatMap((group) => group.lods.map((lod) => lod.albedo))]
        .filter((path): path is string => path !== null)
        .map(textureKey),
    );
    this.chunksX = Math.max(1, Math.ceil(scene.width / PROP_CHUNK));
    this.chunksZ = Math.max(1, Math.ceil(scene.height / PROP_CHUNK));
    this.props = scene.props.map((group) => this.propGroup(group));
    for (const group of this.props) {
      for (const lod of group.lods) {
        if (lod.albedo) {
          const key = textureKey(lod.albedo);
          this.propTextures.set(key, [...(this.propTextures.get(key) ?? []), { group, mesh: textureKey(lod.mesh) }]);
        }
      }
    }
  }

  /**
   * The textures among `paths` that the view needs and does not have at that size yet, each with the largest mip
   * level to ask for. One level more than needed is asked for, so zooming in does not ask again at every step.
   */
  wantedTextures(view: MapViewRect, paths: readonly string[]): WantedTexture[] {
    const pixelsPerUnit = this.gl.drawingBufferWidth / view.width;
    const wanted: WantedTexture[] = [];
    for (const path of paths) {
      const key = textureKey(path);
      const loaded = this.textures.get(key);
      if (loaded?.complete) {
        continue;
      }
      const side = textureSide(this.textureUnitsOf(key) * pixelsPerUnit);
      if (!loaded || loaded.side < side) {
        wanted.push({ path, maxSide: Math.min(MAP_TEXTURE_MAX_SIDE, side * 2) });
      }
    }
    return wanted;
  }

  /** Uploads loaded textures, replacing smaller ones; null marks one that could not be read, which is then drawn without. */
  addTextures(paths: string[], textures: (MapTexture | null)[], maxSide: number): void {
    paths.forEach((path, index) => {
      const texture = textures[index] ?? null;
      const key = textureKey(path);
      const previous = this.textures.get(key);
      if (previous?.texture) {
        this.gl.deleteTexture(previous.texture);
      }
      const side = texture ? Math.max(texture.width, texture.height) : 0;
      this.textures.set(key, {
        texture: texture ? this.upload(texture, { mipmaps: true, repeat: this.repeatedTextures.has(key) }) : null,
        side,
        complete: !texture || side < maxSide,
        blackMatte: texture ? hasBlackMatte(texture) : true,
      });
    });
  }

  addMeshes(paths: string[], meshes: (MapMesh | null)[]): void {
    paths.forEach((path, index) => {
      const mesh = meshes[index] ?? null;
      this.meshes.set(textureKey(path), mesh ? this.meshBuffers(mesh) : null);
    });
  }

  render(view: MapViewRect, options: { props: boolean; shadows: boolean }): void {
    const gl = this.gl;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const frame = this.ensureFrame(width, height);
    const viewUniform = [view.left, view.top, view.width, view.height] as const;

    gl.bindFramebuffer(gl.FRAMEBUFFER, frame.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    this.drawStrata(this.programs.albedo, viewUniform, 'albedo');
    gl.drawBuffers([gl.NONE, gl.COLOR_ATTACHMENT1]);
    this.drawStrata(this.programs.normals, viewUniform, 'normal');

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    const pixelsPerUnit = width / view.width;
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    this.drawDecals(this.programs.decalAlbedo, this.decals.albedo, view, pixelsPerUnit);
    // Normal decals replace the strata's normal in red and green; the relief's in blue and alpha stays.
    gl.drawBuffers([gl.NONE, gl.COLOR_ATTACHMENT1]);
    gl.colorMask(true, true, false, false);
    this.drawDecals(this.programs.decalNormals, this.decals.normals, view, pixelsPerUnit);
    gl.colorMask(true, true, true, true);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // The white texture reads as sunlit everywhere.
    const shadow = options.shadows ? this.shadow : this.blank;
    this.drawComposite(frame, viewUniform, shadow, options.shadows);
    if (options.props) {
      this.drawProps(view, pixelsPerUnit, shadow);
    }
  }

  /** Losing the context frees every texture and buffer at once. */
  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  // --- setup ---

  /** `attributes` get the locations of their order, so programs that share a vertex array agree on them. */
  private program(vertexSource: string, fragmentSource: string, attributeNames: readonly string[]): Program {
    const gl = this.gl;
    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new MapRenderError(`shader: ${gl.getShaderInfoLog(shader) ?? ''}`);
      }
      return shader;
    };
    const program = gl.createProgram();
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    attributeNames.forEach((name, location) => gl.bindAttribLocation(program, location, name));
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new MapRenderError(`program: ${gl.getProgramInfoLog(program) ?? ''}`);
    }
    const uniforms = new Map<string, WebGLUniformLocation>();
    const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < uniformCount; i++) {
      const info = gl.getActiveUniform(program, i);
      const name = info?.name.replace(/\[0\]$/, '');
      const location = name ? gl.getUniformLocation(program, info!.name) : null;
      if (name && location) {
        uniforms.set(name, location);
      }
    }
    const attributes = new Map(attributeNames.map((name, location) => [name, location]));
    return { program, uniforms, attributes };
  }

  private buffer(data: Float32Array | Uint16Array, usage: number = this.gl.STATIC_DRAW, target: number = this.gl.ARRAY_BUFFER): WebGLBuffer {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, usage);
    return buffer;
  }

  private vertexBuffer(data: Float32Array, location: number, size: number): void {
    const gl = this.gl;
    this.buffer(data);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }

  private solidTexture(rgba: [number, number, number, number]): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return texture;
  }

  private heightTexture(heights: Uint16Array): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, this.scene.width + 1, this.scene.height + 1, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, heights);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  /** A blend mask, stretched over the whole map; its mip levels keep a view far out from flickering. */
  private maskTexture(texture: MapTexture | null): WebGLTexture {
    return texture ? this.upload(texture, { mipmaps: true, repeat: false }) : this.solidTexture([0, 0, 0, 0]);
  }

  private upload(texture: MapTexture, options: { mipmaps: boolean; repeat: boolean }): WebGLTexture {
    const gl = this.gl;
    const result = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, result);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const { format, width, height, levels } = texture;
    const blockAligned = width % 4 === 0 && height % 4 === 0;
    let mipmapped = false;
    if (format !== 'rgba8' && this.s3tc && blockAligned && (!options.mipmaps || levels.length > 1)) {
      const internal = {
        dxt1: this.s3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT,
        dxt3: this.s3tc.COMPRESSED_RGBA_S3TC_DXT3_EXT,
        dxt5: this.s3tc.COMPRESSED_RGBA_S3TC_DXT5_EXT,
      }[format];
      const used = options.mipmaps ? levels : levels.slice(0, 1);
      used.forEach((data, level) => {
        gl.compressedTexImage2D(gl.TEXTURE_2D, level, internal, Math.max(1, width >> level), Math.max(1, height >> level), 0, data);
      });
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, used.length - 1);
      mipmapped = options.mipmaps;
    } else {
      const decoded = (data: Uint8Array, level: number): Uint8Array =>
        format === 'rgba8' ? data : decodeDxt(format, Math.max(1, width >> level), Math.max(1, height >> level), data);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, decoded(levels[0]!, 0));
      if (options.mipmaps) {
        gl.generateMipmap(gl.TEXTURE_2D);
        mipmapped = true;
      }
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = options.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (mipmapped && this.anisotropy) {
      gl.texParameterf(gl.TEXTURE_2D, this.anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, MAX_ANISOTROPY);
    }
    return result;
  }

  /** Renders a map-space texture once, one texel per sample; it stays bound afterwards. */
  private bake(
    program: Program,
    internalFormat: number,
    width: number,
    height: number,
    setUniforms: (uniform: (name: string) => WebGLUniformLocation | null) => void,
  ): WebGLTexture {
    const gl = this.gl;
    const target = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texStorage2D(gl.TEXTURE_2D, internalFormat === gl.RG8 ? mipLevels(width, height) : 1, internalFormat, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.viewport(0, 0, width, height);
    gl.useProgram(program.program);
    this.bindHeights(program, 0);
    setUniforms((name) => program.uniforms.get(name) ?? null);
    gl.bindVertexArray(this.screenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target);
    return target;
  }

  private bindHeights(program: Program, unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.heights);
    gl.uniform1i(program.uniforms.get('uHeights') ?? null, unit);
    gl.uniform1f(program.uniforms.get('uHeightScale') ?? null, this.scene.heightScale);
    gl.uniform2i(program.uniforms.get('uHeightSize') ?? null, this.scene.width + 1, this.scene.height + 1);
  }

  private propGroup(group: MapScene['props'][number]): PropGroup {
    const { instances } = group;
    const count = instances.length / PROP_INSTANCE_FLOATS;
    const chunkOf = new Int32Array(count);
    const chunkCount = this.chunksX * this.chunksZ;
    const chunkStarts = new Int32Array(chunkCount + 1);
    let maxScale = 0;
    for (let i = 0; i < count; i++) {
      const at = i * PROP_INSTANCE_FLOATS;
      const x = Math.min(this.chunksX - 1, Math.max(0, Math.floor(instances[at]! / PROP_CHUNK)));
      const z = Math.min(this.chunksZ - 1, Math.max(0, Math.floor(instances[at + 2]! / PROP_CHUNK)));
      chunkOf[i] = z * this.chunksX + x;
      chunkStarts[chunkOf[i]! + 1]!++;
      maxScale = Math.max(maxScale, Math.abs(instances[at + 12]!), Math.abs(instances[at + 13]!), Math.abs(instances[at + 14]!));
    }
    for (let c = 0; c < chunkCount; c++) {
      chunkStarts[c + 1]! += chunkStarts[c]!;
    }
    const sorted = new Float32Array(instances.length);
    const next = chunkStarts.slice(0, chunkCount);
    for (let i = 0; i < count; i++) {
      const target = next[chunkOf[i]!]!++;
      sorted.set(instances.subarray(i * PROP_INSTANCE_FLOATS, (i + 1) * PROP_INSTANCE_FLOATS), target * PROP_INSTANCE_FLOATS);
    }
    return { lods: group.lods, instances: this.buffer(sorted), chunkStarts, maxScale, vaos: group.lods.map(() => null) };
  }

  private meshBuffers(mesh: MapMesh): MeshBuffers {
    const gl = this.gl;
    return {
      position: this.buffer(mesh.positions),
      normal: this.buffer(mesh.normals),
      uv: this.buffer(mesh.uvs),
      index: this.buffer(mesh.indices, gl.STATIC_DRAW, gl.ELEMENT_ARRAY_BUFFER),
      indexCount: mesh.indices.length,
      ...meshShape(mesh),
    };
  }

  /** Game units the texture covers once: a stratum's repeat, a decal's size, a prop's parts. */
  private textureUnitsOf(key: string): number {
    const units = this.textureUnits.get(key);
    if (units !== undefined) {
      return units;
    }
    let largest = 0;
    for (const { group, mesh } of this.propTextures.get(key) ?? []) {
      const extent = this.meshes.get(mesh)?.extent ?? DEFAULT_PROP_EXTENT;
      largest = Math.max(largest, extent * group.maxScale * PROP_ATLAS_FACTOR);
    }
    return largest > 0 ? largest : DEFAULT_PROP_EXTENT;
  }

  private ensureFrame(width: number, height: number): NonNullable<MapRenderer['frame']> {
    const gl = this.gl;
    if (this.frame && this.frame.width === width && this.frame.height === height) {
      return this.frame;
    }
    if (this.frame) {
      gl.deleteFramebuffer(this.frame.framebuffer);
      gl.deleteTexture(this.frame.albedo);
      gl.deleteTexture(this.frame.normals);
    }
    const target = (): WebGLTexture => {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      return texture;
    };
    const albedo = target();
    const normals = target();
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, albedo, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, normals, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.frame = { framebuffer, albedo, normals, width, height };
    return this.frame;
  }

  // --- drawing ---

  private texture(path: string | null): WebGLTexture | null {
    return path ? (this.textures.get(textureKey(path))?.texture ?? null) : null;
  }

  private drawStrata(program: Program, view: readonly number[], kind: 'albedo' | 'normal'): void {
    const gl = this.gl;
    const { scene, shader } = this;
    gl.useProgram(program.program);
    const uniform = (name: string): WebGLUniformLocation | null => program.uniforms.get(name) ?? null;
    gl.uniform4f(uniform('uView'), view[0]!, view[1]!, view[2]!, view[3]!);
    gl.uniform2f(uniform('uMapSize'), scene.width, scene.height);
    gl.uniform1i(uniform('uFamily'), shader.family);
    gl.uniform1f(uniform('uAlbedoHalfRange'), shader.albedoHalfRange ? 1 : 0);
    gl.uniform1f(uniform('uNormalHalfRange'), shader.normalHalfRange ? 1 : 0);
    gl.uniform1i(uniform('uMacrotexture'), shader.macrotexture);
    gl.uniform1f(uniform('uBiplanar'), shader.biplanar ? 1 : 0);
    gl.uniform4f(uniform('uSpecular'), ...this.specular);
    const names = ['uLower', ...Array.from({ length: 8 }, (_, i) => `uStratum${i}`)];
    const has: number[] = [];
    let unit = 0;
    const bind = (name: string, texture: WebGLTexture): void => {
      const location = uniform(name);
      if (location) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(location, unit);
        unit++;
      }
    };
    bind('uMask0', this.masks[0]);
    bind('uMask1', this.masks[1]);
    scene.strata.forEach((stratum, index) => {
      const texture = this.texture(kind === 'albedo' ? stratum.albedo : stratum.normal);
      has.push(texture ? 1 : 0);
      if (index < names.length) {
        bind(names[index]!, texture ?? this.blank);
      }
    });
    gl.uniform1fv(uniform('uHas'), has);
    gl.uniform1fv(uniform('uAlbedoScale'), scene.strata.map((stratum) => stratum.albedoScale));
    gl.uniform1fv(uniform('uNormalScale'), scene.strata.map((stratum) => stratum.normalScale));
    // Both passes read the upper stratum's albedo and stratum 8's normal, which FAF's shaders fill with other data.
    bind('uUpper', this.texture(scene.strata[9]?.albedo ?? null) ?? this.blank);
    const mapNormal = this.texture(scene.strata[8]?.normal ?? null);
    bind('uMapNormal', mapNormal ?? this.blank);
    if (kind === 'normal') {
      bind('uTerrainNormals', this.terrainNormals);
      gl.uniform1f(uniform('uHasMapNormal'), this.mapNormalTexture && mapNormal ? 1 : 0);
    }
    this.bindHeights(program, unit);
    gl.bindVertexArray(this.screenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  private drawDecals(program: Program, decals: Decal[], view: MapViewRect, pixelsPerUnit: number): void {
    const gl = this.gl;
    const right = view.left + view.width;
    const bottom = view.top + view.height;
    const minSize = MIN_PIXELS / pixelsPerUnit;
    const data = new Float32Array(decals.length * DECAL_FLOATS);
    const runs: { texture: WebGLTexture; start: number; count: number }[] = [];
    let count = 0;
    let previous: string | null = null;
    for (const decal of decals) {
      const [x0, z0, x1, z1] = decal.bounds;
      if (x1 < view.left || z1 < view.top || x0 > right || z0 > bottom || (x1 - x0 < minSize && z1 - z0 < minSize)) {
        continue;
      }
      const texture = this.textures.get(decal.texture)?.texture;
      if (!texture) {
        continue;
      }
      data.set(decal.geometry, count * DECAL_FLOATS);
      if (previous === decal.texture && runs.length > 0) {
        runs[runs.length - 1]!.count++;
      } else {
        runs.push({ texture, start: count, count: 1 });
      }
      previous = decal.texture;
      count++;
    }
    if (count === 0) {
      return;
    }
    gl.useProgram(program.program);
    gl.uniform4f(program.uniforms.get('uView') ?? null, view.left, view.top, view.width, view.height);
    gl.uniform1i(program.uniforms.get('uTexture') ?? null, 0);
    gl.bindVertexArray(this.decalVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.decalQuad);
    const corner = program.attributes.get('aCorner')!;
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.decalInstances);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * DECAL_FLOATS), gl.DYNAMIC_DRAW);
    const instanceAttributes = ['iOrigin', 'iAxisU', 'iAxisV'].map((name) => program.attributes.get(name)!);
    for (const location of instanceAttributes) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribDivisor(location, 1);
    }
    gl.activeTexture(gl.TEXTURE0);
    for (const run of runs) {
      instanceAttributes.forEach((location, index) => {
        gl.vertexAttribPointer(location, 2, gl.FLOAT, false, DECAL_FLOATS * 4, run.start * DECAL_FLOATS * 4 + index * 8);
      });
      gl.bindTexture(gl.TEXTURE_2D, run.texture);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, run.count);
    }
    gl.bindVertexArray(null);
  }

  private bindLighting(program: Program): void {
    const gl = this.gl;
    const { lighting } = this.scene;
    const uniform = (name: string): WebGLUniformLocation | null => program.uniforms.get(name) ?? null;
    const sun = normalize(lighting.sunDirection);
    gl.uniform3f(uniform('uSunDirection'), sun[0], sun[1], sun[2]);
    gl.uniform3fv(uniform('uSunColor'), lighting.sunColor);
    gl.uniform3fv(uniform('uSunAmbience'), lighting.sunAmbience);
    gl.uniform3fv(uniform('uShadowFill'), lighting.shadowFill);
    gl.uniform1f(uniform('uMultiplier'), lighting.multiplier);
    gl.uniform2f(uniform('uMapSize'), this.scene.width, this.scene.height);
    gl.uniform2f(uniform('uShadowSize'), this.shadowSize[0], this.shadowSize[1]);
  }

  /** The water uniforms, the ramp on texture unit `unit`. */
  private bindWater(program: Program, unit: number): void {
    const gl = this.gl;
    const { water, lighting } = this.scene;
    const uniform = (name: string): WebGLUniformLocation | null => program.uniforms.get(name) ?? null;
    const ramp = this.texture(water?.ramp ?? null);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, ramp ?? this.blank);
    gl.uniform1i(uniform('uRamp'), unit);
    gl.uniform1f(uniform('uHasWater'), water ? 1 : 0);
    gl.uniform1f(uniform('uHasRamp'), ramp ? 1 : 0);
    gl.uniform1f(uniform('uAdvancedWater'), lighting.multiplier > ADVANCED_WATER_MULTIPLIER ? 1 : 0);
    if (water) {
      gl.uniform1f(uniform('uWaterElevation'), water.elevation);
      gl.uniform1f(uniform('uWaterAbyss'), water.elevationAbyss);
      gl.uniform3fv(uniform('uSurfaceColor'), water.surfaceColor);
      gl.uniform2fv(uniform('uColorLerp'), water.colorLerp);
      gl.uniform1f(uniform('uSkyReflection'), water.skyReflection);
      gl.uniform3fv(uniform('uSkyColor'), lighting.fogColor);
    }
  }

  private drawComposite(frame: NonNullable<MapRenderer['frame']>, view: readonly number[], shadow: WebGLTexture, shadows: boolean): void {
    const gl = this.gl;
    const program = this.programs.composite;
    const { scene } = this;
    const uniform = (name: string): WebGLUniformLocation | null => program.uniforms.get(name) ?? null;
    gl.useProgram(program.program);
    gl.uniform4f(uniform('uView'), view[0]!, view[1]!, view[2]!, view[3]!);
    this.bindLighting(program);
    gl.uniform1i(uniform('uFamily'), this.shader.family);
    gl.uniform4f(uniform('uSpecular'), ...this.specular);
    gl.uniform1f(uniform('uShadows'), shadows ? 1 : 0);
    const info = this.infoTexture ? this.texture(scene.strata[8]?.albedo ?? null) : null;
    const upper = this.texture(scene.strata[9]?.albedo ?? null);
    gl.uniform1f(uniform('uHasInfo'), info ? 1 : 0);
    gl.uniform1f(uniform('uHasUpper'), upper ? 1 : 0);
    const textures: [string, WebGLTexture][] = [
      ['uAlbedoBuffer', frame.albedo],
      ['uNormalBuffer', frame.normals],
      ['uShadow', shadow],
      ['uInfo', info ?? this.blank],
      ['uUpper', upper ?? this.blank],
    ];
    textures.forEach(([name, texture], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uniform(name), unit);
    });
    this.bindWater(program, textures.length);
    this.bindHeights(program, textures.length + 1);
    gl.bindVertexArray(this.screenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  private drawProps(view: MapViewRect, pixelsPerUnit: number, shadow: WebGLTexture): void {
    const gl = this.gl;
    const program = this.programs.props;
    // Props smaller than a pixel only cost time; a tree is about one unit across.
    if (pixelsPerUnit < MIN_PIXELS / 4) {
      return;
    }
    const uniform = (name: string): WebGLUniformLocation | null => program.uniforms.get(name) ?? null;
    gl.useProgram(program.program);
    gl.uniform4f(uniform('uView'), view.left, view.top, view.width, view.height);
    gl.uniform2f(uniform('uDepth'), this.depth[0], this.depth[1]);
    this.bindLighting(program);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shadow);
    gl.uniform1i(uniform('uShadow'), 1);
    this.bindWater(program, 2);
    this.bindHeights(program, 3);
    gl.uniform1i(uniform('uAlbedo'), 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);

    const distance = view.height * LOD_DISTANCE_PER_VIEW_UNIT;
    const ranges = this.visibleChunkRanges(view);
    const instanceAttributes = PROP_INSTANCE_ATTRIBUTES.map((name) => program.attributes.get(name)!);
    for (const group of this.props) {
      const lodIndex = this.levelOfDetail(group, distance);
      const lod = group.lods[lodIndex]!;
      const mesh = this.meshes.get(textureKey(lod.mesh));
      const albedoKey = lod.albedo ? textureKey(lod.albedo) : null;
      if (!mesh || (albedoKey && !this.textures.has(albedoKey))) {
        continue;
      }
      const albedo = albedoKey ? this.textures.get(albedoKey) : undefined;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, albedo?.texture ?? this.blank);
      gl.uniform1f(uniform('uHasAlbedo'), albedo?.texture ? 1 : 0);
      gl.uniform1f(uniform('uAlphaCutoff'), lod.alphaCutoff);
      gl.uniform1f(uniform('uUnpremultiply'), albedo?.blackMatte === false ? 0 : 1);
      const vao = this.propVao(group, lodIndex, mesh, program);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, group.instances);
      for (const [startChunk, endChunk] of ranges) {
        const start = group.chunkStarts[startChunk]!;
        const count = group.chunkStarts[endChunk]! - start;
        if (count <= 0) {
          continue;
        }
        instanceAttributes.forEach((location, index) => {
          gl.vertexAttribPointer(location, 3, gl.FLOAT, false, PROP_INSTANCE_FLOATS * 4, start * PROP_INSTANCE_FLOATS * 4 + index * 12);
        });
        gl.drawElementsInstanced(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0, count);
      }
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }

  /**
   * The level of detail the game would show at this distance, as it looks from above. Past the first, levels made of
   * upright cards show only their edges from there; a card facing up, the picture of the crown that the game shows
   * far out, stands in for them, and without one a level that faces up much less than the one before is skipped.
   */
  private levelOfDetail(group: PropGroup, distance: number): number {
    let index = group.lods.findIndex((lod) => lod.cutoff >= distance);
    if (index < 0) {
      index = group.lods.length - 1;
    }
    if (index === 0) {
      return 0;
    }
    const upRatio = (lod: number): number => this.meshes.get(textureKey(group.lods[lod]!.mesh))?.upRatio ?? 0;
    for (let lod = 1; lod < group.lods.length; lod++) {
      if (upRatio(lod) >= FLAT_LOD_UP_RATIO) {
        return lod;
      }
    }
    while (index > 0 && upRatio(index) < 0.5 * upRatio(index - 1)) {
      index--;
    }
    return index;
  }

  private propVao(group: PropGroup, lodIndex: number, mesh: MeshBuffers, program: Program): WebGLVertexArrayObject {
    const existing = group.vaos[lodIndex];
    if (existing) {
      return existing;
    }
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const attribute = (name: string, buffer: WebGLBuffer, size: number): void => {
      const location = program.attributes.get(name);
      if (location === undefined) {
        return;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    };
    attribute('aPosition', mesh.position, 3);
    attribute('aNormal', mesh.normal, 3);
    attribute('aUv', mesh.uv, 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
    gl.bindBuffer(gl.ARRAY_BUFFER, group.instances);
    for (const name of PROP_INSTANCE_ATTRIBUTES) {
      const location = program.attributes.get(name)!;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);
    group.vaos[lodIndex] = vao;
    return vao;
  }

  /** Runs of chunk indices [start, end) the view touches: whole rows merge into one run. */
  private visibleChunkRanges(view: MapViewRect): [number, number][] {
    const clampChunk = (value: number, count: number): number => Math.min(count - 1, Math.max(0, Math.floor(value / PROP_CHUNK)));
    const x0 = clampChunk(view.left - PROP_MARGIN, this.chunksX);
    const x1 = clampChunk(view.left + view.width + PROP_MARGIN, this.chunksX);
    const z0 = clampChunk(view.top - PROP_MARGIN, this.chunksZ);
    const z1 = clampChunk(view.top + view.height + PROP_MARGIN, this.chunksZ);
    if (x0 === 0 && x1 === this.chunksX - 1) {
      return [[z0 * this.chunksX, (z1 + 1) * this.chunksX]];
    }
    const ranges: [number, number][] = [];
    for (let z = z0; z <= z1; z++) {
      ranges.push([z * this.chunksX + x0, z * this.chunksX + x1 + 1]);
    }
    return ranges;
  }
}

function normalize([x, y, z]: [number, number, number]): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function mipLevels(width: number, height: number): number {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

/** How much of the mesh faces up and how large it is. */
function meshShape(mesh: MapMesh): Pick<MeshBuffers, 'upRatio' | 'extent'> {
  const { positions, indices } = mesh;
  let area = 0;
  let up = 0;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i]! * 3;
    const b = indices[i + 1]! * 3;
    const c = indices[i + 2]! * 3;
    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    area += Math.hypot(nx, ny, nz);
    up += Math.abs(ny);
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3]!, positions[i]!);
    max[i % 3] = Math.max(max[i % 3]!, positions[i]!);
  }
  const extent = positions.length > 0 ? Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) : 0;
  return { upRatio: area > 0 ? up / area : 0, extent };
}

/**
 * Whether the transparent texels of a cut-out texture are black, judged on a small level. Most leaves are drawn on
 * black, so their smaller levels darken by coverage and dividing by the alpha brings the colour back; some bushes
 * are drawn on green, which that would only brighten.
 */
function hasBlackMatte(texture: MapTexture): boolean {
  let width = texture.width;
  let height = texture.height;
  let level = 0;
  while (level < texture.levels.length - 1 && Math.max(width, height) > 64) {
    level++;
    width = Math.max(1, width >> 1);
    height = Math.max(1, height >> 1);
  }
  const data = texture.levels[level]!;
  const rgba = texture.format === 'rgba8' ? data : decodeDxt(texture.format, width, height, data);
  let transparent = 0;
  const sum = [0, 0, 0];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! < 16) {
      transparent++;
      sum[0]! += rgba[i]!;
      sum[1]! += rgba[i + 1]!;
      sum[2]! += rgba[i + 2]!;
    }
  }
  return transparent === 0 || Math.max(...sum) / transparent <= 20;
}
