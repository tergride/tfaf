import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { MAP_VIEW_BATCH, type MapScene } from '../../../shared/contract.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { MapRenderer, MapRenderError, type MapViewRect, type WantedTexture } from '../lib/mapView/mapRenderer.ts';

export interface MapLayers {
  props: boolean;
  shadows: boolean;
}

function failure(cause: unknown): string {
  if (cause instanceof MapRenderError) {
    if (cause.message === 'webgl2') {
      return t('maps.mapView.noWebgl');
    }
    if (cause.message === 'size') {
      return t('maps.mapView.tooLarge');
    }
  }
  return t('maps.mapView.failed', { error: errorMessage(cause) });
}

/**
 * Textures in the order they change the picture most: the ground and the water, then decals, then props. Props come
 * after the meshes, whose size tells how large their textures need to be.
 */
function textureGroups(map: MapScene): { terrain: string[]; props: string[] } {
  const first = new Set<string>();
  for (const stratum of map.strata) {
    for (const path of [stratum.albedo, stratum.normal]) {
      if (path) {
        first.add(path);
      }
    }
  }
  if (map.water?.ramp) {
    first.add(map.water.ramp);
  }
  const decals = new Set(map.decals.map((decal) => decal.texture));
  const terrain = [...map.textures.filter((path) => first.has(path)), ...map.textures.filter((path) => !first.has(path) && decals.has(path))];
  const placed = new Set(terrain);
  return { terrain, props: map.textures.filter((path) => !placed.has(path)) };
}

function batches<T>(items: T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += MAP_VIEW_BATCH) {
    result.push(items.slice(i, i + MAP_VIEW_BATCH));
  }
  return result;
}

/** Requests of one mip size each, in the order the textures were wanted. */
function requests(wanted: WantedTexture[]): { paths: string[]; maxSide: number }[] {
  const bySide = new Map<number, string[]>();
  for (const { path, maxSide } of wanted) {
    bySide.set(maxSide, [...(bySide.get(maxSide) ?? []), path]);
  }
  return [...bySide].flatMap(([maxSide, paths]) => batches(paths).map((batch) => ({ paths: batch, maxSide })));
}

/** The scene without what the renderer has put on the GPU, so that it does not stay in memory with the view. */
function lightScene(map: MapScene): MapScene {
  return {
    ...map,
    heights: new Uint16Array(0),
    masks: [null, null],
    props: map.props.map((group) => ({ ...group, instances: new Float32Array(0) })),
  };
}

/**
 * Reads a map from its files and draws the part `view` picks on the canvas; a redraw follows the view and the layers.
 * Textures load at the size the view shows them at; zooming in loads larger ones in the background.
 */
export function useMapDrawing(view: (scene: MapScene) => MapViewRect, layers: () => MapLayers) {
  const scene = shallowRef<MapScene | null>(null);
  const status = ref<'loading' | 'ready' | 'failed'>('loading');
  const error = ref<string | null>(null);
  const progress = ref<{ done: number; total: number } | null>(null);
  const canvas = ref<HTMLCanvasElement | null>(null);
  // A lost WebGL context cannot be used again, so every map gets a new canvas.
  const canvasKey = ref(0);
  const frameSize = ref({ width: 0, height: 0 });
  let renderer: MapRenderer | null = null;
  let loadId = 0;
  let frameRequest = 0;
  let refining = false;

  const currentView = (): MapViewRect | null => (scene.value ? view(scene.value) : null);

  function requestRender(): void {
    if (frameRequest === 0) {
      frameRequest = requestAnimationFrame(() => {
        frameRequest = 0;
        const rect = currentView();
        if (renderer && rect) {
          renderer.render(rect, layers());
          if (status.value === 'ready') {
            void refine(loadId);
          }
        }
      });
    }
  }

  watch([currentView, () => layers().props, () => layers().shadows], requestRender);

  /** Loads `paths` at the size the current view needs; false once the map is gone. */
  async function loadTextures(id: number, paths: string[], onBatch: (count: number) => void): Promise<boolean> {
    const rect = currentView();
    if (!renderer || !rect) {
      return false;
    }
    for (const request of requests(renderer.wantedTextures(rect, paths))) {
      const result = await window.tfaf.mapView.textures(request.paths, request.maxSide);
      if (id !== loadId || !renderer) {
        return false;
      }
      renderer.addTextures(request.paths, result, request.maxSide);
      onBatch(request.paths.length);
      requestRender();
    }
    return true;
  }

  /** Loads larger textures while the view needs them, one request at a time, after the map has loaded. */
  async function refine(id: number): Promise<void> {
    if (refining) {
      return;
    }
    refining = true;
    try {
      for (;;) {
        const rect = currentView();
        const map = scene.value;
        if (id !== loadId || !renderer || !rect || !map) {
          return;
        }
        const [next] = requests(renderer.wantedTextures(rect, map.textures));
        if (!next) {
          return;
        }
        const result = await window.tfaf.mapView.textures(next.paths, next.maxSide);
        if (id !== loadId || !renderer) {
          return;
        }
        renderer.addTextures(next.paths, result, next.maxSide);
        requestRender();
      }
    } catch (cause) {
      console.warn(`Map view textures could not be loaded: ${errorMessage(cause)}`);
    } finally {
      refining = false;
    }
  }

  function resizeCanvas(): void {
    const element = canvas.value;
    if (!element) {
      return;
    }
    const rect = element.getBoundingClientRect();
    frameSize.value = { width: rect.width, height: rect.height };
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (element.width !== width || element.height !== height) {
      element.width = width;
      element.height = height;
    }
    requestRender();
  }

  let observer: ResizeObserver | null = null;
  watch(canvas, (element) => {
    observer?.disconnect();
    observer = null;
    if (element) {
      observer = new ResizeObserver(resizeCanvas);
      observer.observe(element);
    }
  });

  function disposeRenderer(): void {
    loadId++;
    if (frameRequest !== 0) {
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    }
    renderer?.dispose();
    renderer = null;
  }

  async function load(folderName: string): Promise<void> {
    disposeRenderer();
    const id = loadId;
    scene.value = null;
    status.value = 'loading';
    error.value = null;
    progress.value = null;
    canvasKey.value++;
    try {
      const loaded = await window.tfaf.mapView.scene(folderName);
      if (id !== loadId) {
        return;
      }
      scene.value = loaded;
      await nextTick();
      if (!canvas.value || id !== loadId) {
        return;
      }
      resizeCanvas();
      renderer = new MapRenderer(canvas.value, loaded);
      const map = lightScene(loaded);
      scene.value = map;
      requestRender();
      const textures = textureGroups(map);
      const total = map.textures.length + map.meshes.length;
      let done = 0;
      const advance = (count: number): void => {
        done += count;
        progress.value = { done, total };
      };
      progress.value = { done, total };
      if (!(await loadTextures(id, textures.terrain, advance))) {
        return;
      }
      for (const batch of batches(map.meshes)) {
        const result = await window.tfaf.mapView.meshes(batch);
        if (id !== loadId || !renderer) {
          return;
        }
        renderer.addMeshes(batch, result);
        advance(batch.length);
        requestRender();
      }
      if (!(await loadTextures(id, textures.props, advance))) {
        return;
      }
      status.value = 'ready';
      requestRender();
    } catch (cause) {
      if (id === loadId) {
        status.value = 'failed';
        error.value = failure(cause);
      }
    }
  }

  function clear(): void {
    disposeRenderer();
    scene.value = null;
  }

  function onContextLost(event: Event): void {
    event.preventDefault();
    // A replaced canvas loses its context on purpose, when the view moves to another map.
    if (renderer && event.target === canvas.value) {
      disposeRenderer();
      status.value = 'failed';
      error.value = t('maps.mapView.contextLost');
    }
  }

  onBeforeUnmount(() => {
    observer?.disconnect();
    disposeRenderer();
  });

  return { scene, status, error, progress, canvas, canvasKey, frameSize, load, clear, onContextLost };
}
