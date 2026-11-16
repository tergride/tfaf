// Generated maps of the Neroxis Map Generator, made the way the official client makes them (MapGeneratorService): the
// map name carries the generator version and the seed, the generator of that version comes from FAForever's GitHub
// releases and writes the map into the maps folder. Its version is chosen by whoever named the map (the matchmaker
// server, a game host), so the jar cannot be pinned by checksum; only the release address is fixed.
//
// A new map from chosen parameters is made by the newest generator 1.x; other players then make the same map from its
// name, which encodes the parameters.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import type { CustomMapRequest, GenerationType, GeneratorOptionLists } from '../../shared/contract.ts';
import { GENERATOR_DENSITY_MAX, isGeneratorOptionName, MAX_GENERATOR_OPTIONS } from '../../shared/mapGenerator.ts';
import { CancelledError, describeError } from '../errors.ts';
import type { RuntimeComponents } from '../game/runtimeComponents.ts';
import { t } from '../i18n.ts';
import { LineDecoder } from '../lineDecoder.ts';
import { fetchWithTimeout, retrying } from '../net/http.ts';
import { oldVersionFile, type OldVersionFile } from '../oldVersions.ts';
import type { SettingsStore } from '../settings.ts';
import type { TaskReporter } from '../tasks.ts';
import { downloadToTempFile, progressFraction } from './download.ts';
import { findChildCaseInsensitive, pathExists } from './fsUtil.ts';

const GENERATED_MAP = /^neroxis_map_generator_(\d{1,3}\.\d{1,3}\.\d{1,3})_([\w-]{1,200})$/i;
// GENERATED_MAP_PATTERN of the official client, which takes the rest of the line; here the name ends where a folder
// name would, so a path or a word after it on the same line is not taken in.
const GENERATED_MAP_IN_OUTPUT = /neroxis_map_generator_\d{1,3}\.\d{1,3}\.\d{1,3}_[\w-]+/gi;
const VERSION = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const GENERATOR_JAR = /^NeroxisGen_(\d{1,3}\.\d{1,3}\.\d{1,3})\.jar$/;
// The generator versions the official client accepts (map-generator min/max supported major version).
const MIN_MAJOR = 0;
const MAX_MAJOR = 1;
// Generators 0.x made a map from a seed alone; parameters came with 1.x.
const CUSTOM_MAJOR = 1;
const GENERATION_TIMEOUT_MS = 3 * 60 * 1000;
const OPTIONS_TIMEOUT_MS = 30_000;
const MAX_OPTIONS_OUTPUT = 64 * 1024;
const LATEST_RELEASE_URL = 'https://api.github.com/repos/FAForever/Neroxis-Map-Generator/releases/latest';
const LATEST_VERSION_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

// The queries of MapGeneratorService, in the order of the fields of GeneratorOptionLists.
const OPTION_QUERIES = [
  ['symmetries', '--symmetries'],
  ['styles', '--styles'],
  ['terrainStyles', '--terrain-styles'],
  ['textureStyles', '--texture-styles'],
  ['resourceStyles', '--resource-styles'],
  ['propStyles', '--prop-styles'],
] as const;

type OptionList = (typeof OPTION_QUERIES)[number][0];

const TYPE_FLAGS: Record<Exclude<GenerationType, 'casual'>, string> = {
  tournament: '--tournament-style',
  blind: '--blind',
  unexplored: '--unexplored',
};

export interface GeneratorVersion {
  version: string;
  major: number;
}

export interface GeneratedMapName extends GeneratorVersion {
  seed: string;
}

/** A version the official client would run, or an error saying why not. */
export function checkGeneratorVersion(version: string): GeneratorVersion {
  const match = VERSION.exec(version);
  if (!match) {
    throw new Error(t('main.generator.invalidVersion', { version }));
  }
  const major = Number(match[1]);
  if (major < MIN_MAJOR || major > MAX_MAJOR) {
    throw new Error(t('main.generator.unsupportedVersion', { version }));
  }
  return { version: match.slice(1, 4).map(Number).join('.'), major };
}

/** A version that makes maps from chosen parameters. */
export function checkCustomGeneratorVersion(version: string): GeneratorVersion {
  const checked = checkGeneratorVersion(version);
  if (checked.major !== CUSTOM_MAJOR) {
    throw new Error(t('main.generator.customUnsupported', { version: checked.version }));
  }
  return checked;
}

export function parseGeneratedMapName(folderName: string): GeneratedMapName | null {
  const match = GENERATED_MAP.exec(folderName);
  if (!match) {
    return null;
  }
  const version = VERSION.exec(match[1]!)!;
  return { version: version.slice(1, 4).map(Number).join('.'), major: Number(version[1]), seed: match[2]! };
}

export function generatorDownloadUrl(version: string): string {
  return `https://github.com/FAForever/Neroxis-Map-Generator/releases/download/${version}/${generatorJarName(version)}`;
}

/** The version of GitHub's answer about the latest release; only a generator 1.x will do. */
export function parseLatestGeneratorRelease(value: unknown): string {
  const tag = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).tag_name : undefined;
  if (typeof tag !== 'string') {
    throw new Error(t('main.generator.latestFormat'));
  }
  return checkCustomGeneratorVersion(tag.trim()).version;
}

/**
 * The answer of a query like `--styles`: one option per line. Like GeneratorOptionsTask of the official client it
 * skips lines with a colon, which are log lines; whatever is not an option name is skipped too.
 */
export function parseGeneratorOptionList(output: string): string[] {
  const options = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !line.includes(':') && isGeneratorOptionName(line));
  return [...new Set(options)].slice(0, MAX_GENERATOR_OPTIONS);
}

/** Names of generated maps the generator printed, each once, in the order it printed them. */
export function generatedMapNamesIn(output: string): string[] {
  const names = [...output.matchAll(GENERATED_MAP_IN_OUTPUT)].map(([name]) => name).filter((name) => parseGeneratedMapName(name));
  return [...new Set(names)];
}

function generatorJarName(version: string): string {
  return `NeroxisGen_${version}.jar`;
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/** Arguments of `java` for a map by name (GeneratorCommand of the official client). */
export function generatorArguments(jarPath: string, mapName: string, generated: GeneratedMapName): string[] {
  return generated.major >= 1
    ? ['-jar', jarPath, '--map-name', mapName]
    : ['-jar', jarPath, '.', generated.seed, generated.version, mapName];
}

/** A density of 0..127 as the fraction the generator takes, like the sliders of the official client. */
function densityArgument(density: number | null): string | null {
  return density === null ? null : String(density / GENERATOR_DENSITY_MAX);
}

/** Arguments of `java` for a new map of chosen parameters (GeneratorCommand of the official client, generator 1.x). */
export function customGeneratorArguments(jarPath: string, request: CustomMapRequest): string[] {
  const args = [
    '-jar',
    jarPath,
    '--map-size',
    String(request.mapSize),
    '--spawn-count',
    String(request.spawnCount),
    '--num-teams',
    String(request.numTeams),
  ];
  if (request.generationType !== 'casual') {
    return [...args, TYPE_FLAGS[request.generationType]];
  }
  const option = (flag: string, value: string | null): string[] => (value === null ? [] : [flag, value]);
  args.push(...option('--seed', request.seed), ...option('--terrain-symmetry', request.symmetry));
  if (request.style !== null) {
    return [...args, '--style', request.style];
  }
  return [
    ...args,
    ...option('--terrain-style', request.terrainStyle),
    ...option('--texture-style', request.textureStyle),
    ...option('--resource-style', request.resourceStyle),
    ...option('--prop-style', request.propStyle),
    ...option('--resource-density', densityArgument(request.resourceDensity)),
    ...option('--reclaim-density', densityArgument(request.reclaimDensity)),
  ];
}

function supportedOrThrow(folderName: string): GeneratedMapName {
  const generated = parseGeneratedMapName(folderName);
  if (!generated) {
    throw new Error(t('main.generator.invalidMapName', { name: folderName }));
  }
  checkGeneratorVersion(generated.version);
  return generated;
}

function exitError(code: number | null): Error | null {
  if (code === null) {
    return new Error(t('main.generator.exitedUnknownCode'));
  }
  return code === 0 ? null : new Error(t('main.generator.exitedWithCode', { code }));
}

interface GeneratorRun {
  cwd: string;
  /** Aborting it stops the generator, which then fails with CancelledError. */
  signal: AbortSignal | null;
  timeoutMs: number;
  timeoutMessage: string;
  /** Each line of the generator's standard output. */
  onLine?: (line: string) => void;
}

export class MapGenerator {
  private readonly runtime: RuntimeComponents;
  private readonly settings: SettingsStore;
  private readonly tasks: TaskReporter;
  private readonly userAgent: string;
  private readonly downloads = new Map<string, Promise<string>>();
  private readonly optionLists = new Map<string, Promise<GeneratorOptionLists>>();
  private latest: { version: string; checkedAt: number } | null = null;
  private pendingLatest: Promise<string> | null = null;

  constructor(runtime: RuntimeComponents, settings: SettingsStore, tasks: TaskReporter, userAgent: string) {
    this.runtime = runtime;
    this.settings = settings;
    this.tasks = tasks;
    this.userAgent = userAgent;
  }

  /** Gets Java and the generator of a version ahead of the game that will need them. */
  async prepare(version: string): Promise<void> {
    await Promise.all([this.runtime.ensureJava(), this.ensureGenerator(checkGeneratorVersion(version).version)]);
  }

  /** Writes the map into the maps folder, unless it is already there. */
  async generate(folderName: string): Promise<void> {
    const generated = supportedOrThrow(folderName);
    const mapsDirectory = this.settings.mapsDirectory;
    if (await findChildCaseInsensitive(mapsDirectory, folderName)) {
      return;
    }
    const [javaPath, jarPath] = await Promise.all([this.runtime.ensureJava(), this.ensureGenerator(generated.version)]);
    await mkdir(mapsDirectory, { recursive: true });
    const code = await this.tasks.run(
      t('main.generator.generateTask', { name: folderName }),
      (task) =>
        this.runGenerator(javaPath, generatorArguments(jarPath, folderName, generated), {
          cwd: mapsDirectory,
          signal: task.signal,
          timeoutMs: GENERATION_TIMEOUT_MS,
          timeoutMessage: t('main.generator.timeout'),
        }),
      { cancellable: true },
    );
    const failure = exitError(code);
    if (failure) {
      throw failure;
    }
    if (!(await findChildCaseInsensitive(mapsDirectory, folderName))) {
      throw new Error(t('main.generator.noMap', { name: folderName, log: this.logPath }));
    }
    console.info(`Map ${folderName} generated`);
  }

  /**
   * The newest generator release, asked of GitHub at most once an hour. When GitHub cannot be asked, the newest
   * generator 1.x downloaded earlier is used.
   */
  latestVersion(): Promise<string> {
    if (this.latest && Date.now() - this.latest.checkedAt < LATEST_VERSION_TTL_MS) {
      return Promise.resolve(this.latest.version);
    }
    this.pendingLatest ??= this.fetchLatestVersion().finally(() => {
      this.pendingLatest = null;
    });
    return this.pendingLatest;
  }

  /** Symmetries and styles the generator of a version offers, asked of it once per version (MapGeneratorService). */
  async options(version: string): Promise<GeneratorOptionLists> {
    const checked = checkCustomGeneratorVersion(version).version;
    let pending = this.optionLists.get(checked);
    if (!pending) {
      pending = this.queryOptions(checked);
      this.optionLists.set(checked, pending);
      pending.catch(() => this.optionLists.delete(checked));
    }
    return pending;
  }

  /** Makes a new map of the chosen parameters in the maps folder; returns its folder name. */
  async generateCustom(request: CustomMapRequest): Promise<string> {
    const { version } = checkCustomGeneratorVersion(request.version);
    await this.checkChosenOptions(version, request);
    const mapsDirectory = this.settings.mapsDirectory;
    const [javaPath, jarPath] = await Promise.all([this.runtime.ensureJava(), this.ensureGenerator(version)]);
    await mkdir(mapsDirectory, { recursive: true });
    const names: string[] = [];
    const code = await this.tasks.run(
      t('main.generator.generateCustomTask'),
      (task) =>
        this.runGenerator(javaPath, customGeneratorArguments(jarPath, { ...request, version }), {
          cwd: mapsDirectory,
          signal: task.signal,
          timeoutMs: GENERATION_TIMEOUT_MS,
          timeoutMessage: t('main.generator.timeout'),
          onLine: (line) => names.push(...generatedMapNamesIn(line)),
        }),
      { cancellable: true },
    );
    const failure = exitError(code);
    if (failure) {
      throw failure;
    }
    for (const name of new Set(names)) {
      const directory = await findChildCaseInsensitive(mapsDirectory, name);
      if (directory) {
        const folderName = path.basename(directory);
        console.info(`Map ${folderName} generated`);
        return folderName;
      }
    }
    throw new Error(t('main.generator.noMapReported', { log: this.logPath }));
  }

  private ensureGenerator(version: string): Promise<string> {
    let pending = this.downloads.get(version);
    if (!pending) {
      pending = this.downloadGenerator(version).finally(() => this.downloads.delete(version));
      this.downloads.set(version, pending);
    }
    return pending;
  }

  /** Downloaded generators other than the newest; one that a map names again is downloaded again. */
  async oldVersions(): Promise<OldVersionFile[]> {
    const directory = this.directory;
    const versions = await this.downloadedVersions();
    return Promise.all(
      versions
        .slice(0, -1)
        .map((version) => oldVersionFile(t('main.generator.oldVersion', { version }), path.join(directory, generatorJarName(version)))),
    );
  }

  private get directory(): string {
    return path.join(this.runtime.runtimeDirectory, 'map_generator');
  }

  private get logPath(): string {
    return path.join(this.settings.logsDirectory, 'map-generator.log');
  }

  /** Versions of the downloaded generators, oldest first. */
  private async downloadedVersions(): Promise<string[]> {
    return (await readdir(this.directory).catch(() => []))
      .map((name) => GENERATOR_JAR.exec(name)?.[1])
      .filter((version) => version !== undefined)
      .sort(compareVersions);
  }

  private async fetchLatestVersion(): Promise<string> {
    try {
      const response = await retrying(() =>
        fetchWithTimeout(
          LATEST_RELEASE_URL,
          { headers: { Accept: 'application/vnd.github+json', 'User-Agent': this.userAgent } },
          REQUEST_TIMEOUT_MS,
        ),
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(t('main.generator.latestStatus', { status: response.status }));
      }
      const version = parseLatestGeneratorRelease(await response.json());
      this.latest = { version, checkedAt: Date.now() };
      return version;
    } catch (error) {
      const downloaded = (await this.downloadedVersions()).filter((version) => Number(version.split('.')[0]) === CUSTOM_MAJOR).at(-1);
      if (!downloaded) {
        throw error;
      }
      console.warn(`Latest map generator version unknown (${describeError(error)}), using the downloaded ${downloaded}`);
      return downloaded;
    }
  }

  private async queryOptions(version: string): Promise<GeneratorOptionLists> {
    const [javaPath, jarPath] = await Promise.all([this.runtime.ensureJava(), this.ensureGenerator(version)]);
    const query = async (flag: string): Promise<string[]> => {
      let output = '';
      const code = await this.runGenerator(javaPath, ['-jar', jarPath, flag], {
        cwd: this.directory,
        signal: null,
        timeoutMs: OPTIONS_TIMEOUT_MS,
        timeoutMessage: t('main.generator.optionsTimeout', { seconds: OPTIONS_TIMEOUT_MS / 1000 }),
        onLine: (line) => {
          if (output.length < MAX_OPTIONS_OUTPUT) {
            output += `${line}\n`;
          }
        },
      });
      const options = parseGeneratorOptionList(output);
      // The official client takes whatever was printed, whatever the exit code.
      const failure = options.length === 0 ? exitError(code) : null;
      if (failure) {
        throw failure;
      }
      return options;
    };
    const lists = await Promise.all(OPTION_QUERIES.map(([, flag]) => query(flag)));
    const result: GeneratorOptionLists = {
      version,
      symmetries: [],
      styles: [],
      terrainStyles: [],
      textureStyles: [],
      resourceStyles: [],
      propStyles: [],
    };
    OPTION_QUERIES.forEach(([list], index) => {
      result[list] = lists[index] ?? [];
    });
    return result;
  }

  /** The styles and the symmetry must be ones the generator of this version offers. */
  private async checkChosenOptions(version: string, request: CustomMapRequest): Promise<void> {
    const chosen: [string | null, OptionList][] = [
      [request.symmetry, 'symmetries'],
      [request.style, 'styles'],
      [request.terrainStyle, 'terrainStyles'],
      [request.textureStyle, 'textureStyles'],
      [request.resourceStyle, 'resourceStyles'],
      [request.propStyle, 'propStyles'],
    ];
    // Without a chosen option the generator need not be asked, so a failed query does not stop the generation.
    if (chosen.every(([value]) => value === null)) {
      return;
    }
    const lists = await this.options(version);
    const unknown = chosen.find(([value, list]) => value !== null && !lists[list].includes(value));
    if (unknown) {
      throw new Error(t('main.generator.unknownOption', { version, option: unknown[0] ?? '' }));
    }
  }

  private async downloadGenerator(version: string): Promise<string> {
    const directory = this.directory;
    const jarPath = path.join(directory, generatorJarName(version));
    if (await pathExists(jarPath)) {
      return jarPath;
    }
    await mkdir(directory, { recursive: true });
    await this.tasks.run(
      t('main.generator.downloadTask', { version }),
      async (task) => {
        const download = await downloadToTempFile(
          generatorDownloadUrl(version),
          this.userAgent,
          (received, total) => task.progress(progressFraction(received, total)),
          { signal: task.signal },
        );
        try {
          await copyFile(download.path, `${jarPath}.tmp`);
          await rename(`${jarPath}.tmp`, jarPath);
        } finally {
          await download.cleanup();
        }
      },
      { cancellable: true },
    );
    return jarPath;
  }

  /** Runs the generator with its output appended to map-generator.log; resolves with its exit code. */
  private async runGenerator(javaPath: string, args: string[], run: GeneratorRun): Promise<number | null> {
    await mkdir(this.settings.logsDirectory, { recursive: true });
    return new Promise((resolve, reject) => {
      const log = createWriteStream(this.logPath, { flags: 'a' });
      log.on('error', (error) => console.warn('Map generator log could not be written', describeError(error)));
      log.write(`\n${new Date().toISOString()} ${args.slice(2).join(' ')}\n`);
      const child = spawn(javaPath, args, { cwd: run.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const lines = new LineDecoder();
      const emitLines = (text: string): void => {
        try {
          for (const line of lines.push(text)) {
            run.onLine?.(line);
          }
        } catch (error) {
          console.warn('Map generator output could not be read', describeError(error));
        }
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        log.write(chunk);
        emitLines(chunk);
      });
      child.stderr.pipe(log, { end: false });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, run.timeoutMs);
      const abort = (): void => {
        child.kill();
      };
      run.signal?.addEventListener('abort', abort, { once: true });
      let settled = false;
      const finish = (outcome: { error: Error } | { code: number | null }): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        run.signal?.removeEventListener('abort', abort);
        log.end();
        if ('error' in outcome) {
          reject(outcome.error);
        } else {
          resolve(outcome.code);
        }
      };
      child.once('error', (error) => finish({ error: new Error(t('main.generator.spawnFailed', { error: error.message })) }));
      // `close` rather than `exit`: by then all of the output has been read.
      child.once('close', (code) => {
        emitLines('\n');
        if (run.signal?.aborted) {
          finish({ error: new CancelledError() });
        } else if (timedOut) {
          finish({ error: new Error(run.timeoutMessage) });
        } else {
          finish({ code });
        }
      });
    });
  }
}
