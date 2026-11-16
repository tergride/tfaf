import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { UNIT_DATABASE_IDS, UNIT_DATABASE_SCHEME, UNIT_DATABASE_SITES, type UnitDatabaseId } from '../../shared/contract.ts';
import { asObject, asString } from '../api/jsonApi.ts';
import { describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import { fetchWithTimeout, HttpStatusError } from '../net/http.ts';

const CHECK_TIMEOUT_MS = 3_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const UNKNOWN_CONTENT_TYPE = 'application/octet-stream';
// FAF Unit DB registers a service worker from this file for offline use. The scheme does not allow one, and the copy on
// disk already does that job, so the page gets an empty script instead of an error on every start.
const SERVICE_WORKER_LOADER = '/registerSW.js';

// Both sites name their scripts and styles by content, and Spooky DB its unit data too, so a new release changes the
// page. FAF Unit DB keeps its unit data under a fixed name, and a release may change nothing else.
const CHECKED_FILES: Record<UnitDatabaseId, readonly string[]> = {
  spooky: ['/'],
  unitdb: ['/', '/data/index.json'],
};

interface FileInfo {
  contentType: string;
  etag: string | null;
  sha256: string;
}

interface SiteFile extends FileInfo {
  body: Uint8Array<ArrayBuffer>;
}

function databaseId(host: string): UnitDatabaseId | null {
  return UNIT_DATABASE_IDS.find((id) => id === host) ?? null;
}

async function writeThroughTemp(target: string, content: string | Uint8Array): Promise<void> {
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, content);
  await rename(temp, target);
}

async function siteFile(response: Response): Promise<SiteFile> {
  const body = new Uint8Array(await response.arrayBuffer());
  return {
    body,
    contentType: response.headers.get('content-type') ?? UNKNOWN_CONTENT_TYPE,
    etag: response.headers.get('etag'),
    sha256: createHash('sha256').update(body).digest('hex'),
  };
}

function unavailablePage(status: number): Response {
  const html = `<!doctype html><html style="background:#0b1017"><body style="padding-top:64px;font:14px sans-serif;color:#8b95a1;text-align:center">${t('units.unavailable')}`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/** The address on the site behind a link of a database page; any other link stays as it is. */
export function unitDatabaseSiteUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const id = databaseId(parsed.hostname);
    return parsed.protocol === `${UNIT_DATABASE_SCHEME}:` && id
      ? `${UNIT_DATABASE_SITES[id]}${parsed.pathname}${parsed.search}${parsed.hash}`
      : url;
  } catch {
    return url;
  }
}

/**
 * Copies of the unit databases on disk, which the pages inside the launcher load from. Files are saved as the page asks
 * for them. Opening a page compares the site with its copy once, and without a connection the copy opens as it is.
 */
export class UnitDatabases {
  private readonly directory: string;
  private readonly userAgent: string;
  private readonly sites: Record<UnitDatabaseId, string>;
  private readonly queues = new Map<UnitDatabaseId, Promise<unknown>>();
  // Grows when a copy goes, so that a download started before that does not put an old file into the new copy.
  private readonly generations: Record<UnitDatabaseId, number> = { spooky: 0, unitdb: 0 };

  constructor(directory: string, userAgent: string, sites = UNIT_DATABASE_SITES) {
    this.directory = directory;
    this.userAgent = userAgent;
    this.sites = sites;
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const id = databaseId(url.hostname);
    if (!id || request.method !== 'GET') {
      return new Response(null, { status: 404 });
    }
    if (url.pathname === SERVICE_WORKER_LOADER) {
      return new Response('', { headers: { 'Content-Type': 'text/javascript' } });
    }
    if (url.pathname === '/') {
      await this.check(id);
    }
    const file = `${url.pathname}${url.search}`;
    try {
      const { body, contentType } = (await this.read(id, file)) ?? (await this.load(id, file));
      // Chromium would otherwise keep files in memory for the next frame, past a refresh or a new release.
      return new Response(body, { headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' } });
    } catch (error) {
      console.warn(`Unit database ${id}: ${file} failed: ${describeError(error)}`);
      const status = error instanceof HttpStatusError ? error.status : 502;
      return url.pathname === '/' ? unavailablePage(status) : new Response(null, { status });
    }
  }

  /** Loads the site anew whatever a check would say. The copy goes only after the site answered, so an error keeps it. */
  refresh(id: UnitDatabaseId): Promise<void> {
    return this.exclusive(id, async () => {
      const files = await Promise.all(CHECKED_FILES[id].map(async (file) => ({ file, fresh: await this.download(id, file) })));
      await this.drop(id);
      await Promise.all(files.map(({ file, fresh }) => this.save(id, file, fresh)));
    });
  }

  /**
   * GitHub Pages gives every file a new ETag with each deployment, also when nothing in it changed, so a file that
   * arrives again is compared by content before the copy goes.
   */
  private check(id: UnitDatabaseId): Promise<void> {
    return this.exclusive(id, async () => {
      const results = await Promise.all(CHECKED_FILES[id].map((file) => this.compare(id, file)));
      if (results.some((result) => result.changed)) {
        await this.drop(id);
      }
      await Promise.all(results.flatMap(({ file, fresh }) => (fresh ? [this.save(id, file, fresh)] : [])));
    }).catch((error: unknown) => console.warn(`Unit database ${id}: check failed: ${describeError(error)}`));
  }

  private async compare(id: UnitDatabaseId, file: string): Promise<{ file: string; fresh: SiteFile | null; changed: boolean }> {
    const stored = await this.info(id, file);
    try {
      const response = await this.request(id, file, CHECK_TIMEOUT_MS, stored?.etag ?? null);
      const fresh = response.status === 304 ? null : await siteFile(response);
      return { file, fresh, changed: fresh !== null && stored !== null && fresh.sha256 !== stored.sha256 };
    } catch (error) {
      console.warn(`Unit database ${id}: ${file} not checked: ${describeError(error)}`);
      return { file, fresh: null, changed: false };
    }
  }

  private async load(id: UnitDatabaseId, file: string): Promise<SiteFile> {
    const generation = this.generations[id];
    const fresh = await this.download(id, file);
    if (generation === this.generations[id]) {
      await this.save(id, file, fresh);
    }
    return fresh;
  }

  private async download(id: UnitDatabaseId, file: string): Promise<SiteFile> {
    return siteFile(await this.request(id, file, DOWNLOAD_TIMEOUT_MS, null));
  }

  private async request(id: UnitDatabaseId, file: string, timeoutMs: number, etag: string | null): Promise<Response> {
    const headers: Record<string, string> = { 'User-Agent': this.userAgent };
    if (etag) {
      headers['If-None-Match'] = etag;
    }
    const response = await fetchWithTimeout(`${this.sites[id]}${file}`, { headers }, timeoutMs);
    if (!response.ok && response.status !== 304) {
      await response.body?.cancel();
      throw new HttpStatusError(t('main.download.serverStatus', { status: response.status }), response.status);
    }
    return response;
  }

  private async read(id: UnitDatabaseId, file: string): Promise<SiteFile | null> {
    const info = await this.info(id, file);
    if (!info) {
      return null;
    }
    try {
      return { ...info, body: new Uint8Array(await readFile(this.filePath(id, file))) };
    } catch {
      return null;
    }
  }

  private async info(id: UnitDatabaseId, file: string): Promise<FileInfo | null> {
    try {
      const stored = asObject(JSON.parse(await readFile(`${this.filePath(id, file)}.json`, 'utf8')));
      const contentType = asString(stored?.contentType);
      const sha256 = asString(stored?.sha256);
      return contentType && sha256 ? { contentType, etag: asString(stored?.etag), sha256 } : null;
    } catch {
      return null;
    }
  }

  /** A file that could not be saved is simply downloaded again next time. */
  private async save(id: UnitDatabaseId, file: string, { body, ...info }: SiteFile): Promise<void> {
    try {
      await mkdir(path.join(this.directory, id), { recursive: true });
      const target = this.filePath(id, file);
      await writeThroughTemp(target, body);
      await writeThroughTemp(`${target}.json`, JSON.stringify(info));
    } catch (error) {
      console.warn(`Unit database ${id}: ${file} not saved: ${describeError(error)}`);
    }
  }

  private async drop(id: UnitDatabaseId): Promise<void> {
    this.generations[id]++;
    await rm(path.join(this.directory, id), { recursive: true, force: true, maxRetries: 3 });
  }

  private filePath(id: UnitDatabaseId, file: string): string {
    return path.join(this.directory, id, createHash('sha256').update(file).digest('hex'));
  }

  /** Checks and refreshes of a database replace its copy, so they run one at a time. */
  private exclusive<T>(id: UnitDatabaseId, work: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(id) ?? Promise.resolve()).then(work);
    this.queues.set(id, result.catch(() => undefined));
    return result;
  }
}
