// Map and mod uploads to the FAF vault, as the official client's MapUploadTask and ModUploadTask send them, with the
// folder checked on this computer first so that the common mistakes show before a long upload.

import { randomUUID } from 'node:crypto';
import { type FileHandle, open, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { UploadCandidate } from '../../shared/contract.ts';
import type { FafApi } from '../api/fafApi.ts';
import { asObject, asString } from '../api/jsonApi.ts';
import { describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import { LuaParseError } from '../lua/luaParser.ts';
import type { TaskReporter } from '../tasks.ts';
import { readTextFile } from './fsUtil.ts';
import { type ModInfo, readModInfo } from './modInfoReader.ts';
import { readScenario, type ScenarioInfo } from './scenarioReader.ts';
import { zipFolder } from './zipWriter.ts';

export type UploadKind = 'map' | 'mod';

export interface ScmapPreview {
  width: number;
  height: number;
  /** Pixels in BGRA order, as Electron's nativeImage.createFromBitmap takes them. */
  bgra: Buffer;
}

export interface UploadDependencies {
  api: FafApi;
  tasks: TaskReporter;
  /** The system folder dialog; null when the user cancelled. */
  pickFolder(kind: UploadKind): Promise<string | null>;
  /** A data URL of the map's preview, which needs Electron's image support. */
  previewDataUrl(preview: ScmapPreview): string | null;
}

interface FolderChecks {
  problems: string[];
  warnings: string[];
}

const SCMAP_MAGIC = 0x1a70614d;
const DDS_MAGIC = 0x20534444;
const DDS_HEADER_SIZE = 128;
// The preview comes first in the .scmap file; this reads it without loading a large map whole.
const SCMAP_HEAD_BYTES = 2 * 1024 * 1024;
const COMPRESS_SHARE = 0.3;

/**
 * The preview picture stored at the start of a `.scmap` file: after a fixed header comes a DDS image, which FA writes
 * as uncompressed 32-bit A8R8G8B8. Anything else is not shown.
 */
export function readScmapPreview(head: Buffer): ScmapPreview | null {
  if (head.length < 34 || head.readUInt32LE(0) !== SCMAP_MAGIC) {
    return null;
  }
  const length = head.readUInt32LE(30);
  const dds = head.subarray(34, 34 + length);
  if (dds.length !== length || length < DDS_HEADER_SIZE || dds.readUInt32LE(0) !== DDS_MAGIC) {
    return null;
  }
  const height = dds.readUInt32LE(12);
  const width = dds.readUInt32LE(16);
  const fourCc = dds.readUInt32LE(84);
  const bitCount = dds.readUInt32LE(88);
  const [red, green, blue, alpha] = [92, 96, 100, 104].map((offset) => dds.readUInt32LE(offset));
  const pixels = width * height * 4;
  if (
    width === 0 ||
    height === 0 ||
    width > 2048 ||
    height > 2048 ||
    fourCc !== 0 ||
    bitCount !== 32 ||
    red !== 0x00ff0000 ||
    green !== 0x0000ff00 ||
    blue !== 0x000000ff ||
    dds.length < DDS_HEADER_SIZE + pixels
  ) {
    return null;
  }
  const bgra = Buffer.from(dds.subarray(DDS_HEADER_SIZE, DDS_HEADER_SIZE + pixels));
  // A preview without alpha would otherwise be fully transparent.
  if (alpha === 0) {
    for (let index = 3; index < bgra.length; index += 4) {
      bgra[index] = 0xff;
    }
  }
  return { width, height, bgra };
}

/** A game path's last part: `/maps/seton.v0003/seton.scmap` → `seton.scmap`. */
function fileNameOf(gamePath: string): string {
  return gamePath.split('/').filter(Boolean).at(-1) ?? '';
}

/**
 * What stops a map upload or deserves a look: the scenario, its integer `map_version`, the map, save and script files
 * it names, and whether the folder name and the paths in the scenario agree with the version and the folder.
 */
export function checkMapFolder(folderName: string, rootFiles: readonly string[], scenario: ScenarioInfo): FolderChecks {
  const problems: string[] = [];
  const warnings: string[] = [];
  const present = new Set(rootFiles.map((name) => name.toLowerCase()));
  if (!scenario.version || !/^\d+$/.test(scenario.version) || Number(scenario.version) <= 0) {
    problems.push(t('main.vault.uploads.mapVersionMissing'));
  }
  const kinds = [
    ['map', scenario.files.map],
    ['save', scenario.files.save],
    ['script', scenario.files.script],
  ] as const;
  let otherFolder: string | null = null;
  for (const [kind, gamePath] of kinds) {
    if (!gamePath) {
      problems.push(t('main.vault.uploads.scenarioFileMissing', { kind }));
    } else if (!present.has(fileNameOf(gamePath).toLowerCase())) {
      problems.push(t('main.vault.uploads.fileMissing', { file: fileNameOf(gamePath) }));
    } else {
      const folder = gamePath.split('/').filter(Boolean).at(-2);
      if (folder && folder.toLowerCase() !== folderName.toLowerCase()) {
        otherFolder ??= folder;
      }
    }
  }
  if (otherFolder) {
    warnings.push(t('main.vault.uploads.pathFolderMismatch', { folder: otherFolder, actual: folderName }));
  }
  const suffix = /\.v(\d+)$/i.exec(folderName)?.[1];
  if (scenario.version && /^\d+$/.test(scenario.version)) {
    const expected = `.v${scenario.version.padStart(4, '0')}`;
    if (suffix === undefined) {
      warnings.push(t('main.vault.uploads.folderWithoutVersion', { expected }));
    } else if (Number(suffix) !== Number(scenario.version)) {
      warnings.push(t('main.vault.uploads.folderVersionMismatch', { expected, version: scenario.version }));
    }
  }
  return { problems, warnings };
}

/** The API takes only a whole number as a mod's version. */
export function checkModInfo(info: ModInfo): FolderChecks {
  const problems: string[] = [];
  if (!info.version || !/^\d+$/.test(info.version)) {
    problems.push(t('main.vault.uploads.modVersionInvalid'));
  }
  return { problems, warnings: [] };
}

async function readHead(file: string, length: number): Promise<Buffer> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(file, 'r');
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle?.close();
  }
}

export class UploadService {
  private readonly deps: UploadDependencies;
  // Only folders the user picked in the dialog can be uploaded, whatever the renderer asks for.
  private readonly picked = new Map<string, { kind: UploadKind; folder: string }>();

  constructor(deps: UploadDependencies) {
    this.deps = deps;
  }

  async pick(kind: UploadKind): Promise<UploadCandidate | null> {
    const folder = await this.deps.pickFolder(kind);
    if (!folder) {
      return null;
    }
    const token = randomUUID();
    this.picked.set(token, { kind, folder });
    return { token, ...(kind === 'map' ? await this.inspectMap(folder) : await this.inspectMod(folder)) };
  }

  async uploadMap(token: string, ranked: boolean): Promise<void> {
    const folder = this.folderOf(token, 'map');
    const inspected = await this.inspectMap(folder);
    if (inspected.problems.length > 0) {
      throw new Error(inspected.problems.join('\n'));
    }
    await this.deps.tasks.run(
      t('main.vault.uploads.mapTask', { name: inspected.name }),
      async (task) => {
        await this.withZip(folder, (fraction) => task.progress(fraction * COMPRESS_SHARE), task.signal, async (zip) => {
          await this.deps.api.uploadMultipart(
            '/maps/upload',
            [
              { name: 'file', file: zip, fileName: `${path.basename(folder)}.zip`, contentType: 'application/zip' },
              { name: 'metadata', value: JSON.stringify({ isRanked: ranked }), contentType: 'application/json' },
            ],
            { signal: task.signal, onProgress: (sent, total) => task.progress(COMPRESS_SHARE + (1 - COMPRESS_SHARE) * (sent / total)) },
          );
        });
      },
      { cancellable: true },
    );
    this.picked.delete(token);
  }

  /** The mod goes to the storage address the API hands out, then the API is told to take it from there. */
  async uploadMod(token: string): Promise<void> {
    const folder = this.folderOf(token, 'mod');
    const inspected = await this.inspectMod(folder);
    if (inspected.problems.length > 0) {
      throw new Error(inspected.problems.join('\n'));
    }
    await this.deps.tasks.run(
      t('main.vault.uploads.modTask', { name: inspected.name }),
      async (task) => {
        await this.withZip(folder, (fraction) => task.progress(fraction * COMPRESS_SHARE), task.signal, async (zip) => {
          const start = asObject(await this.deps.api.getJson('/mods/upload/start'));
          const uploadUrl = asString(start?.uploadUrl);
          const requestId = asString(start?.requestId);
          if (!uploadUrl || !requestId) {
            throw new Error(t('main.api.invalidResponse'));
          }
          await this.deps.api.putPresigned(uploadUrl, zip, 'application/zip', {
            signal: task.signal,
            onProgress: (sent, total) => task.progress(COMPRESS_SHARE + (1 - COMPRESS_SHARE) * (sent / total)),
          });
          await this.deps.api.postJson('/mods/upload/complete', { requestId, licenseId: null, repositoryUrl: null });
        });
      },
      { cancellable: true },
    );
    this.picked.delete(token);
  }

  /** The API lets only the uploader hide a version; it stays installable for games and replays that use it. */
  async hideVersion(kind: UploadKind, versionId: number): Promise<void> {
    const type = kind === 'map' ? 'mapVersion' : 'modVersion';
    await this.deps.api.patch(`/data/${type}/${versionId}`, {
      data: { type, id: String(versionId), attributes: { hidden: true } },
    });
  }

  private folderOf(token: string, kind: UploadKind): string {
    const entry = this.picked.get(token);
    if (!entry || entry.kind !== kind) {
      throw new Error(t('main.vault.uploads.pickAgain'));
    }
    return entry.folder;
  }

  private async withZip(
    folder: string,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
    upload: (zip: string) => Promise<void>,
  ): Promise<void> {
    const zip = path.join(os.tmpdir(), `tfaf-upload-${randomUUID()}.zip`);
    try {
      await zipFolder(folder, zip, { onProgress, signal });
      signal.throwIfAborted();
      await upload(zip);
    } finally {
      await rm(zip, { force: true }).catch(() => undefined);
    }
  }

  private async rootFiles(folder: string): Promise<string[]> {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  }

  private async inspectMap(folder: string): Promise<Omit<UploadCandidate, 'token'>> {
    const folderName = path.basename(folder);
    const files = await this.rootFiles(folder);
    const scenarios = files.filter((name) => name.toLowerCase().endsWith('_scenario.lua'));
    const base = {
      folderName,
      name: folderName,
      description: '',
      version: null,
      maxPlayers: null,
      widthPx: null,
      heightPx: null,
      author: null,
      uiOnly: null,
      previewDataUrl: null,
      warnings: [],
    };
    if (scenarios.length !== 1) {
      return { ...base, problems: [t(scenarios.length === 0 ? 'main.vault.uploads.noScenario' : 'main.vault.uploads.severalScenarios')] };
    }
    let scenario: ScenarioInfo;
    try {
      scenario = readScenario(await readTextFile(path.join(folder, scenarios[0]!)));
    } catch (error) {
      const reason = error instanceof LuaParseError ? error.message : describeError(error);
      return { ...base, problems: [t('main.vault.uploads.scenarioUnreadable', { reason })] };
    }
    const checks = checkMapFolder(folderName, files, scenario);
    return {
      ...base,
      name: scenario.name,
      description: scenario.description,
      version: scenario.version,
      maxPlayers: scenario.maxPlayers,
      widthPx: scenario.widthPx,
      heightPx: scenario.heightPx,
      previewDataUrl: await this.preview(folder, files, scenario),
      problems: checks.problems,
      warnings: checks.warnings,
    };
  }

  private async preview(folder: string, files: readonly string[], scenario: ScenarioInfo): Promise<string | null> {
    const wanted = scenario.files.map ? fileNameOf(scenario.files.map).toLowerCase() : null;
    const scmap = files.find((name) => name.toLowerCase() === wanted) ?? files.find((name) => name.toLowerCase().endsWith('.scmap'));
    if (!scmap) {
      return null;
    }
    try {
      const preview = readScmapPreview(await readHead(path.join(folder, scmap), SCMAP_HEAD_BYTES));
      return preview ? this.deps.previewDataUrl(preview) : null;
    } catch (error) {
      console.warn('Map preview could not be read', describeError(error));
      return null;
    }
  }

  private async inspectMod(folder: string): Promise<Omit<UploadCandidate, 'token'>> {
    const folderName = path.basename(folder);
    const files = await this.rootFiles(folder);
    const base = {
      folderName,
      name: folderName,
      description: '',
      version: null,
      maxPlayers: null,
      widthPx: null,
      heightPx: null,
      author: null,
      uiOnly: null,
      previewDataUrl: null,
      warnings: [],
    };
    const modInfo = files.find((name) => name.toLowerCase() === 'mod_info.lua');
    if (!modInfo) {
      return { ...base, problems: [t('main.vault.uploads.noModInfo')] };
    }
    let info: ModInfo;
    try {
      info = readModInfo(await readTextFile(path.join(folder, modInfo)));
    } catch (error) {
      const reason = error instanceof LuaParseError ? error.message : describeError(error);
      return { ...base, problems: [t('main.vault.uploads.modInfoUnreadable', { reason })] };
    }
    return {
      ...base,
      name: info.name,
      description: info.description,
      version: info.version,
      author: info.author || null,
      uiOnly: info.uiOnly,
      ...checkModInfo(info),
    };
  }
}
