// StoneMap, the map generator of TFAF, runs as its own local API: StoneMap.Api.exe with the .NET runtime beside it. It
// is downloaded on first use, like Java and the Neroxis generator, and one build is pinned by checksum: every computer
// then makes the same map from the same recipe, which the TFAF lobby relies on.

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { t } from '../i18n.ts';
import { oldVersionFile, type OldVersionFile } from '../oldVersions.ts';
import type { TaskReporter } from '../tasks.ts';
import { downloadToTempFile, progressFraction } from '../vault/download.ts';
import { pathExists } from '../vault/fsUtil.ts';
import { installArchive } from '../vault/installer.ts';

export interface StoneMapBuild {
  /** The StoneMap commit the build was made from; it names the build in the TFAF lobby. */
  id: string;
  url: string;
  sha256: string;
  /** The archive's only top-level folder. */
  directory: string;
}

export const STONEMAP_BUILD: StoneMapBuild = {
  id: '073cd39',
  url: 'https://github.com/tergride/tfaf/releases/download/v1.1.0/stonemap-073cd39-win-x64.zip',
  sha256: '6a71d361d40ed7b4edd567bafc28a58b5430c66581929d18354948c719711b5a',
  directory: 'stonemap-073cd39',
};

const EXECUTABLE = 'StoneMap.Api.exe';
const BUILD_DIRECTORY = /^stonemap-([0-9a-f]{7,40})$/;

/**
 * A StoneMap.Api.exe of a local build that a development run takes instead of the pinned one (TFAF_STONEMAP_API).
 * Packaged launchers ignore it.
 */
export function developmentExecutable(packaged: boolean, environment: NodeJS.ProcessEnv = process.env): string | null {
  const value = environment.TFAF_STONEMAP_API?.trim();
  if (packaged || !value) {
    return null;
  }
  if (!path.isAbsolute(value) || path.basename(value).toLowerCase() !== EXECUTABLE.toLowerCase()) {
    console.warn(`TFAF_STONEMAP_API must be the absolute path of ${EXECUTABLE}; the pinned build is used`);
    return null;
  }
  return value;
}

export class StoneMapBuilds {
  private readonly runtimeDirectory: () => string;
  private readonly tasks: TaskReporter;
  private readonly userAgent: string;
  private readonly build: StoneMapBuild;
  private pending: Promise<string> | null = null;

  constructor(runtimeDirectory: () => string, tasks: TaskReporter, userAgent: string, build: StoneMapBuild = STONEMAP_BUILD) {
    this.runtimeDirectory = runtimeDirectory;
    this.tasks = tasks;
    this.userAgent = userAgent;
    this.build = build;
  }

  get id(): string {
    return this.build.id;
  }

  /** The pinned build is on disk. */
  isDownloaded(): boolean {
    return existsSync(this.executable);
  }

  private get executable(): string {
    return path.join(this.runtimeDirectory(), this.build.directory, EXECUTABLE);
  }

  /** Path of StoneMap.Api.exe of the pinned build, downloading it first if needed. */
  ensure(): Promise<string> {
    this.pending ??= this.install().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /** Builds that earlier launcher versions downloaded. */
  async oldVersions(): Promise<OldVersionFile[]> {
    const directory = this.runtimeDirectory();
    const old: OldVersionFile[] = [];
    for (const name of await readdir(directory).catch(() => [])) {
      const match = BUILD_DIRECTORY.exec(name);
      if (match && name !== this.build.directory) {
        old.push(await oldVersionFile(t('main.stoneMap.oldBuild', { id: match[1] ?? '' }), path.join(directory, name)));
      }
    }
    return old;
  }

  private async install(): Promise<string> {
    if (process.platform !== 'win32') {
      throw new Error(t('main.stoneMap.windowsOnly'));
    }
    const runtimeDirectory = this.runtimeDirectory();
    const executable = this.executable;
    if (await pathExists(executable)) {
      return executable;
    }
    await this.tasks.run(
      t('main.stoneMap.downloadTask'),
      async (task) => {
        const download = await downloadToTempFile(
          this.build.url,
          this.userAgent,
          (received, total) => {
            const fraction = progressFraction(received, total);
            task.progress(fraction === null ? null : fraction * 0.9);
          },
          { checksum: { algorithm: 'sha256', digest: this.build.sha256 }, signal: task.signal },
        );
        try {
          task.signal.throwIfAborted();
          await installArchive(download.path, runtimeDirectory, (fraction) => task.progress(0.9 + fraction * 0.1));
        } finally {
          await download.cleanup();
        }
      },
      { cancellable: true },
    );
    if (!(await pathExists(executable))) {
      throw new Error(t('main.stoneMap.archiveLayout'));
    }
    return executable;
  }
}
