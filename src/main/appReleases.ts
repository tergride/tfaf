import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppRelease, AppReleaseHistory } from '../shared/contract.ts';
import { bundledReleases, mergeReleases, parseGithubReleases, visibleReleases } from './changelog.ts';
import { describeError } from './errors.ts';
import { t } from './i18n.ts';
import { fetchWithTimeout, retrying } from './net/http.ts';

const REQUEST_TIMEOUT_MS = 15_000;
// GitHub answers 60 requests an hour per address without a token.
const CACHE_MS = 10 * 60 * 1000;

/** The repository the build updates from, given at build time like the OAuth client id (see electron.vite.config.ts). */
function releasesRepository(): string | null {
  const repository = process.env.TFAF_UPDATE_GITHUB ?? '';
  return /^[\w.-]+\/[\w.-]+$/.test(repository) ? repository : null;
}

/** Versions of the launcher with their notes: the changelog the build carries, and the releases on GitHub. */
export class AppReleases {
  private readonly userAgent: string;
  private readonly betas: () => boolean;
  private readonly repository = releasesRepository();
  private bundled: Promise<AppRelease[]> | null = null;
  private remote: { at: number; releases: AppRelease[] } | null = null;

  /** `betas`: whether the player takes beta versions (Settings.betaUpdates). */
  constructor(userAgent: string, betas: () => boolean) {
    this.userAgent = userAgent;
    this.betas = betas;
  }

  /** `expected` is a version GitHub must already list, e.g. a found update; a cached list without it is read again. */
  async history(online: boolean, expected: string | null): Promise<AppReleaseHistory> {
    const bundled = await this.readBundled();
    const releasesUrl = this.repository ? `https://github.com/${this.repository}/releases` : null;
    const visible = (releases: AppRelease[]): AppRelease[] =>
      visibleReleases(releases, { betas: this.betas(), current: app.getVersion() });
    if (!online || !this.repository) {
      return { releases: visible(mergeReleases([], bundled)), error: null, releasesUrl };
    }
    try {
      return { releases: visible(mergeReleases(await this.readRemote(this.repository, expected), bundled)), error: null, releasesUrl };
    } catch (error) {
      return { releases: visible(mergeReleases([], bundled)), error: describeError(error), releasesUrl };
    }
  }

  private readBundled(): Promise<AppRelease[]> {
    // electron-builder packs CHANGELOG.md next to package.json; during development it is the file in the repository.
    this.bundled ??= readFile(path.join(app.getAppPath(), 'CHANGELOG.md'), 'utf8').then(bundledReleases, (error: unknown) => {
      console.warn('Changelog could not be read', describeError(error));
      return [];
    });
    return this.bundled;
  }

  private async readRemote(repository: string, expected: string | null): Promise<AppRelease[]> {
    const cached = this.remote;
    if (cached && Date.now() - cached.at < CACHE_MS && (!expected || cached.releases.some((release) => release.version === expected))) {
      return cached.releases;
    }
    const response = await retrying(() =>
      fetchWithTimeout(
        `https://api.github.com/repos/${repository}/releases?per_page=100`,
        { headers: { Accept: 'application/vnd.github+json', 'User-Agent': this.userAgent, 'X-GitHub-Api-Version': '2022-11-28' } },
        REQUEST_TIMEOUT_MS,
      ),
    );
    if (!response.ok) {
      const limited = response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
      throw new Error(limited ? t('main.appUpdates.releasesLimited') : t('main.appUpdates.releasesStatus', { status: response.status }));
    }
    const releases = parseGithubReleases(await response.json());
    this.remote = { at: Date.now(), releases };
    return releases;
  }
}
