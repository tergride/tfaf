// StoneMap for the renderer: the API is started on the first call and stays up until the launcher quits. Jobs it
// queued are followed through their event stream and every snapshot goes to the renderer.

import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  AdjustmentDelete,
  AdjustmentMove,
  AdjustmentPlacementMap,
  AdjustmentPlacementRequest,
  AdjustmentScene,
  GenerationCapabilities,
  GenerationRequest,
  MapAdjustments,
  MapFile,
  MapPresentation,
  MapResources,
  MapResult,
  NavigationReport,
  PreviewOptions,
  ReclaimPoint,
  ResolvedParameters,
  StoneMapJob,
  StoneMapJobList,
  StoneMapRecipe,
  StoneMapSavedMap,
  StoneMapState,
  StoneMapTextureAssets,
  StoneMapTextureLayer,
} from '../../shared/contract.ts';
import { describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import type { OldVersionFile } from '../oldVersions.ts';
import type { SettingsStore } from '../settings.ts';
import type { TaskReporter } from '../tasks.ts';
import { findChildCaseInsensitive } from '../vault/fsUtil.ts';
import type { StoneMapBuilds } from './stoneMapBuild.ts';
import { StoneMapApiError, StoneMapProcess } from './stoneMapProcess.ts';

export interface StoneMapServiceDependencies {
  settings: SettingsStore;
  tasks: TaskReporter;
  builds: StoneMapBuilds;
  /** A local StoneMap.Api.exe that a development run takes instead of the pinned build. */
  developmentExecutable: string | null;
  onState(state: StoneMapState): void;
  onJob(job: StoneMapJob): void;
}

/** The query string of a preview; the options were checked by the caller. */
export function previewQuery(options: PreviewOptions): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== null) {
      query.set(key, String(value));
    }
  }
  return query.toString();
}

function jobRoute(id: string, rest = ''): string {
  return `jobs/${encodeURIComponent(id)}${rest}`;
}

export class StoneMapService {
  private readonly deps: StoneMapServiceDependencies;
  private api: StoneMapProcess | null = null;
  private starting: Promise<StoneMapProcess> | null = null;
  private state: StoneMapState;
  private capabilitiesCache: Promise<GenerationCapabilities> | null = null;
  private readonly watches = new Map<string, AbortController>();
  /** Recipes of the StoneMap maps that TFAF rooms play, by lower-case folder name. */
  private readonly recipes = new Map<string, StoneMapRecipe>();
  private stopped = false;

  constructor(deps: StoneMapServiceDependencies) {
    this.deps = deps;
    this.state = {
      phase: 'stopped',
      error: null,
      buildId: deps.developmentExecutable ? 'dev' : deps.builds.id,
      downloaded: deps.developmentExecutable !== null || deps.builds.isDownloaded(),
    };
  }

  getState(): StoneMapState {
    return this.state;
  }

  /** The StoneMap build this launcher runs, which a TFAF room names. */
  get buildId(): string {
    return this.state.buildId;
  }

  /** A TFAF room told how its StoneMap map is made. */
  rememberRecipe(folderName: string, recipe: StoneMapRecipe): void {
    this.recipes.set(folderName.toLowerCase(), recipe);
  }

  /**
   * Makes the StoneMap map of a TFAF room from the recipe the room sent and copies it into the maps folder. The folder
   * name follows from the recipe, so a different one means another map and is refused.
   */
  async installMap(folderName: string): Promise<void> {
    const recipe = this.recipes.get(folderName.toLowerCase());
    if (!recipe) {
      throw new Error(t('main.stoneMap.noRecipe', { name: folderName }));
    }
    if (recipe.build !== this.state.buildId) {
      throw new Error(t('main.stoneMap.otherBuild', { host: recipe.build, own: this.state.buildId }));
    }
    await this.deps.tasks.run(
      t('main.stoneMap.installTask', { name: folderName }),
      async (task) => {
        const api = await this.running();
        const request: GenerationRequest = {
          mapName: recipe.mapName,
          presentation: recipe.presentation,
          adjustments: recipe.adjustments,
          preview: { kinds: [] },
        };
        const job = await api.json<StoneMapJob>('jobs', { method: 'POST', body: request });
        const cancel = (): void => void api.json(jobRoute(job.id, '/cancel'), { method: 'POST', body: {} }).catch(() => undefined);
        task.signal.addEventListener('abort', cancel, { once: true });
        let last = job;
        try {
          for await (const snapshot of api.watch(job.id, task.signal)) {
            last = snapshot;
            task.progress(snapshot.progress.percent / 100);
          }
          if (last.status !== 'completed') {
            throw new Error(last.error?.message ?? t('main.stoneMap.generationFailed'));
          }
          const { exportName } = await api.json<MapResult>(jobRoute(job.id, '/result'));
          if (exportName?.toLowerCase() !== folderName.toLowerCase()) {
            throw new Error(t('main.stoneMap.otherMap', { name: folderName, made: exportName ?? '?' }));
          }
          await this.saveToMaps(job.id);
        } finally {
          task.signal.removeEventListener('abort', cancel);
          // The map is in the maps folder now; the generator's history keeps only what the user made there.
          await api.json(jobRoute(job.id), { method: 'DELETE' }).catch(() => undefined);
        }
      },
      { cancellable: true },
    );
  }

  /** Downloads the generator if needed and starts it. */
  async start(): Promise<void> {
    await this.running();
  }

  capabilities(): Promise<GenerationCapabilities> {
    this.capabilitiesCache ??= this.call((api) => api.json<GenerationCapabilities>('capabilities'));
    this.capabilitiesCache.catch(() => {
      this.capabilitiesCache = null;
    });
    return this.capabilitiesCache;
  }

  resolve(request: GenerationRequest): Promise<ResolvedParameters> {
    return this.call((api) => api.json('parameters/resolve', { method: 'POST', body: request }));
  }

  async generate(request: GenerationRequest): Promise<StoneMapJob> {
    const api = await this.running();
    const job = await api.json<StoneMapJob>('jobs', { method: 'POST', body: request });
    this.watch(api, job.id);
    return job;
  }

  jobs(limit: number): Promise<StoneMapJobList> {
    return this.call((api) => api.json(`jobs?limit=${limit}`));
  }

  job(id: string): Promise<StoneMapJob> {
    return this.call((api) => api.json(jobRoute(id)));
  }

  cancel(id: string): Promise<StoneMapJob> {
    return this.call((api) => api.json(jobRoute(id, '/cancel'), { method: 'POST', body: {} }));
  }

  remove(id: string): Promise<void> {
    return this.call((api) => api.json(jobRoute(id), { method: 'DELETE' }));
  }

  result(id: string): Promise<MapResult> {
    return this.call((api) => api.json(jobRoute(id, '/result')));
  }

  resources(id: string): Promise<MapResources> {
    return this.call((api) => api.json(jobRoute(id, '/resources')));
  }

  reclaim(id: string): Promise<ReclaimPoint[]> {
    return this.call((api) => api.json(jobRoute(id, '/reclaim')));
  }

  navigation(id: string): Promise<NavigationReport> {
    return this.call((api) => api.json(jobRoute(id, '/navigation')));
  }

  files(id: string): Promise<MapFile[]> {
    return this.call((api) => api.json(jobRoute(id, '/files')));
  }

  heightmap(id: string): Promise<Uint8Array<ArrayBuffer>> {
    return this.call((api) => api.bytes(jobRoute(id, '/heightmap')));
  }

  preview(id: string, options: PreviewOptions): Promise<Uint8Array<ArrayBuffer>> {
    return this.call((api) => api.bytes(jobRoute(id, `/preview?${previewQuery(options)}`)));
  }

  textureLayers(id: string): Promise<StoneMapTextureLayer[]> {
    return this.call((api) => api.json(jobRoute(id, '/texture-layers')));
  }

  textureAssets(): Promise<StoneMapTextureAssets> {
    return this.call((api) => api.json('texture-assets'));
  }

  /** Shows the textures preview with the game's own textures, read from the game folder, or in plain colours. */
  useGameTextures(enabled: boolean): Promise<StoneMapTextureAssets> {
    const gamePath = this.deps.settings.get().gamePath;
    if (enabled && !gamePath) {
      return Promise.reject(new Error(t('main.stoneMap.noGamePath')));
    }
    return this.call((api) => api.json('texture-assets', { method: 'POST', body: { directory: enabled ? gamePath : null } }));
  }

  updatePresentation(id: string, presentation: MapPresentation): Promise<MapResult> {
    return this.call((api) => api.json(jobRoute(id, '/presentation'), { method: 'POST', body: presentation }));
  }

  adjustments(id: string): Promise<AdjustmentScene> {
    return this.call((api) => api.json(jobRoute(id, '/adjustments')));
  }

  moveAdjustment(id: string, move: AdjustmentMove): Promise<MapAdjustments> {
    return this.call((api) => api.json(jobRoute(id, '/adjustments/move'), { method: 'POST', body: move }));
  }

  deleteAdjustment(id: string, deletion: AdjustmentDelete): Promise<MapAdjustments> {
    return this.call((api) => api.json(jobRoute(id, '/adjustments/delete'), { method: 'POST', body: deletion }));
  }

  adjustmentPlacement(id: string, request: AdjustmentPlacementRequest): Promise<AdjustmentPlacementMap> {
    return this.call((api) => api.json(jobRoute(id, '/adjustments/placement'), { method: 'POST', body: request }));
  }

  /** Queues the adjusted map as a new job; the original job stays as it is. */
  async applyAdjustments(id: string, draft: MapAdjustments): Promise<StoneMapJob> {
    const api = await this.running();
    const job = await api.json<StoneMapJob>(jobRoute(id, '/adjustments'), { method: 'POST', body: draft });
    this.watch(api, job.id);
    return job;
  }

  /**
   * Copies the finished map into the maps folder of the vault, where the game and the launcher find it. Its folder
   * name is a hash of everything that makes the map, so a folder of that name already holds the same map.
   */
  async saveToMaps(id: string): Promise<StoneMapSavedMap> {
    const api = await this.running();
    const { exportName } = await api.json<MapResult>(jobRoute(id, '/result'));
    if (!exportName) {
      throw new Error(t('main.stoneMap.noExportName'));
    }
    const mapsDirectory = this.deps.settings.mapsDirectory;
    if (await findChildCaseInsensitive(mapsDirectory, exportName)) {
      return { folderName: exportName, existed: true };
    }
    await mkdir(mapsDirectory, { recursive: true });
    try {
      await api.json(jobRoute(id, '/save'), { method: 'POST', body: { directory: path.resolve(mapsDirectory) } });
    } catch (error) {
      if (error instanceof StoneMapApiError && error.code === 'destination_exists') {
        return { folderName: exportName, existed: true };
      }
      throw error;
    }
    console.info(`StoneMap map ${exportName} saved to the maps folder`);
    return { folderName: exportName, existed: false };
  }

  /** Writes the map's ZIP to `file`, replacing it; the user confirmed that in the save dialog. */
  async exportZip(id: string, file: string): Promise<void> {
    const api = await this.running();
    const partial = `${file}.part`;
    try {
      const body = await api.stream(jobRoute(id, '/zip'));
      await pipeline(Readable.fromWeb(body), createWriteStream(partial));
      await rename(partial, file);
    } finally {
      await rm(partial, { force: true });
    }
  }

  /** The name the save dialog offers for the ZIP of a job. */
  async zipName(id: string): Promise<string> {
    const { exportName } = await this.result(id);
    return `${exportName ?? id}.zip`;
  }

  oldVersions(): Promise<OldVersionFile[]> {
    return this.deps.builds.oldVersions();
  }

  /** Stops the API for good, with the generation it runs; the launcher is quitting. */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const controller of this.watches.values()) {
      controller.abort();
    }
    await this.api?.stop();
  }

  private get dataDirectory(): string {
    return path.join(this.deps.settings.get().dataPath, 'stonemap');
  }

  private get logPath(): string {
    return path.join(this.deps.settings.logsDirectory, 'stonemap.log');
  }

  private async call<T>(work: (api: StoneMapProcess) => Promise<T>): Promise<T> {
    return work(await this.running());
  }

  private running(): Promise<StoneMapProcess> {
    if (this.stopped) {
      return Promise.reject(new Error(t('main.stoneMap.notRunning')));
    }
    if (this.api?.running) {
      return Promise.resolve(this.api);
    }
    this.starting ??= this.launch().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async launch(): Promise<StoneMapProcess> {
    try {
      let executable = this.deps.developmentExecutable;
      if (!executable) {
        this.setState('installing', null);
        executable = await this.deps.builds.ensure();
        this.state = { ...this.state, downloaded: true };
      }
      this.setState('starting', null);
      let started: StoneMapProcess | null = null;
      started = await StoneMapProcess.start(executable, this.dataDirectory, this.logPath, (code) => {
        if (started && this.api === started) {
          this.exited(code);
        }
      });
      this.api = started;
      this.setState('ready', null);
      console.info(`StoneMap API ${this.state.buildId} started`);
      return started;
    } catch (error) {
      this.setState('stopped', describeError(error));
      throw error;
    }
  }

  private exited(code: number | null): void {
    this.api = null;
    this.capabilitiesCache = null;
    for (const controller of this.watches.values()) {
      controller.abort();
    }
    if (!this.stopped) {
      console.warn(`StoneMap API exited with ${code ?? 'no code'}`);
      this.setState('stopped', t('main.stoneMap.exited', { code: code ?? '?', log: this.logPath }));
    }
  }

  private watch(api: StoneMapProcess, id: string): void {
    if (this.watches.has(id)) {
      return;
    }
    const controller = new AbortController();
    this.watches.set(id, controller);
    void (async () => {
      try {
        for await (const job of api.watch(id, controller.signal)) {
          this.deps.onJob(job);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn(`StoneMap job ${id} could not be followed: ${describeError(error)}`);
          await api
            .json<StoneMapJob>(jobRoute(id))
            .then((job) => this.deps.onJob(job))
            .catch(() => undefined);
        }
      } finally {
        this.watches.delete(id);
      }
    })();
  }

  private setState(phase: StoneMapState['phase'], error: string | null): void {
    this.state = { ...this.state, phase, error };
    this.deps.onState(this.state);
  }
}
