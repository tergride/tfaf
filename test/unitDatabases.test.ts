import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { UnitDatabases, unitDatabaseSiteUrl } from '../src/main/info/unitDatabases.ts';

interface Page {
  body: string;
  etag?: string;
}

let server: http.Server;
let origin = '';
let directory = '';
let site: Map<string, Page>;
let requests: string[];
let reachable: boolean;

function serve(request: http.IncomingMessage, response: http.ServerResponse): void {
  const url = request.url ?? '';
  if (!reachable) {
    request.socket.destroy();
    return;
  }
  const page = site.get(url);
  if (!page) {
    requests.push(`404 ${url}`);
    response.writeHead(404).end();
  } else if (page.etag && request.headers['if-none-match'] === page.etag) {
    requests.push(`304 ${url}`);
    response.writeHead(304).end();
  } else {
    requests.push(`200 ${url}`);
    response.writeHead(200, { 'Content-Type': 'text/plain', ...(page.etag ? { ETag: page.etag } : {}) }).end(page.body);
  }
}

// A new object stands for a started launcher, which knows only what is on disk.
function launcher(): UnitDatabases {
  return new UnitDatabases(directory, 'test', { spooky: `${origin}/spooky-db`, unitdb: `${origin}/unitdb` });
}

async function open(databases: UnitDatabases, url: string): Promise<{ status: number; text: string; type: string | null }> {
  const response = await databases.handle(new Request(url));
  return { status: response.status, text: await response.text(), type: response.headers.get('content-type') };
}

describe('unit databases', () => {
  before(async () => {
    server = http.createServer(serve);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise((resolve) => server.close(resolve)));

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'tfaf-units-'));
    requests = [];
    reachable = true;
    site = new Map([
      ['/spooky-db/', { body: 'page', etag: '"page"' }],
      ['/spooky-db/js/app.js', { body: 'script', etag: '"script"' }],
      ['/unitdb/', { body: 'page', etag: '"page"' }],
      ['/unitdb/data/index.json', { body: 'units', etag: '"units"' }],
      ['/unitdb/img/units.avif', { body: 'sprites', etag: '"sprites"' }],
    ]);
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it('opens from disk after a restart and asks the site only whether the page changed', async () => {
    const first = launcher();
    assert.deepEqual(await open(first, 'tfaf-units://spooky/'), { status: 200, text: 'page', type: 'text/plain' });
    await open(first, 'tfaf-units://spooky/js/app.js');
    assert.deepEqual(requests, ['200 /spooky-db/', '200 /spooky-db/js/app.js']);

    requests = [];
    const second = launcher();
    assert.deepEqual(await open(second, 'tfaf-units://spooky/'), { status: 200, text: 'page', type: 'text/plain' });
    assert.deepEqual(await open(second, 'tfaf-units://spooky/js/app.js'), { status: 200, text: 'script', type: 'text/plain' });
    assert.deepEqual(requests, ['304 /spooky-db/']);
  });

  it('keeps the copy when a deployment changed the ETag and nothing else', async () => {
    const databases = launcher();
    await open(databases, 'tfaf-units://spooky/');
    await open(databases, 'tfaf-units://spooky/js/app.js');
    site.set('/spooky-db/', { body: 'page', etag: '"deployed-again"' });

    requests = [];
    await open(databases, 'tfaf-units://spooky/');
    await open(databases, 'tfaf-units://spooky/js/app.js');
    assert.deepEqual(requests, ['200 /spooky-db/']);

    requests = [];
    await open(databases, 'tfaf-units://spooky/');
    assert.deepEqual(requests, ['304 /spooky-db/']);
  });

  it('loads everything anew when the page changed', async () => {
    const databases = launcher();
    await open(databases, 'tfaf-units://spooky/');
    await open(databases, 'tfaf-units://spooky/js/app.js');
    site.set('/spooky-db/', { body: 'new page', etag: '"new"' });
    site.set('/spooky-db/js/app.js', { body: 'new script', etag: '"new script"' });

    assert.equal((await open(databases, 'tfaf-units://spooky/')).text, 'new page');
    assert.equal((await open(databases, 'tfaf-units://spooky/js/app.js')).text, 'new script');
  });

  it('notices new unit data of FAF Unit DB behind an unchanged page', async () => {
    const databases = launcher();
    await open(databases, 'tfaf-units://unitdb/');
    await open(databases, 'tfaf-units://unitdb/data/index.json');
    await open(databases, 'tfaf-units://unitdb/img/units.avif');
    site.set('/unitdb/data/index.json', { body: 'new units', etag: '"new units"' });
    site.set('/unitdb/img/units.avif', { body: 'new sprites', etag: '"new sprites"' });

    await open(databases, 'tfaf-units://unitdb/');
    assert.equal((await open(databases, 'tfaf-units://unitdb/data/index.json')).text, 'new units');
    assert.equal((await open(databases, 'tfaf-units://unitdb/img/units.avif')).text, 'new sprites');
  });

  it('opens the copy without a connection and says so when there is none', async () => {
    const databases = launcher();
    await open(databases, 'tfaf-units://spooky/');
    await open(databases, 'tfaf-units://spooky/js/app.js');
    reachable = false;

    assert.equal((await open(databases, 'tfaf-units://spooky/')).text, 'page');
    assert.equal((await open(databases, 'tfaf-units://spooky/js/app.js')).text, 'script');
    const missing = await open(databases, 'tfaf-units://unitdb/');
    assert.equal(missing.status, 502);
    assert.match(missing.text, /копии на диске пока нет/);
  });

  it('passes on what the site does not have and does not remember it', async () => {
    const databases = launcher();
    assert.equal((await open(databases, 'tfaf-units://spooky/js/late.js')).status, 404);
    site.set('/spooky-db/js/late.js', { body: 'late' });
    assert.equal((await open(databases, 'tfaf-units://spooky/js/late.js')).text, 'late');
  });

  it('refreshes by hand without waiting for a change', async () => {
    const databases = launcher();
    await open(databases, 'tfaf-units://spooky/');
    await open(databases, 'tfaf-units://spooky/js/app.js');
    site.set('/spooky-db/js/app.js', { body: 'fixed script', etag: '"fixed"' });

    await databases.refresh('spooky');
    assert.equal((await open(databases, 'tfaf-units://spooky/')).text, 'page');
    assert.equal((await open(databases, 'tfaf-units://spooky/js/app.js')).text, 'fixed script');
  });

  it('keeps the copy when a refresh cannot reach the site', async () => {
    const databases = launcher();
    await open(databases, 'tfaf-units://spooky/');
    await open(databases, 'tfaf-units://spooky/js/app.js');
    reachable = false;

    await assert.rejects(databases.refresh('spooky'));
    assert.equal((await open(databases, 'tfaf-units://spooky/')).text, 'page');
    assert.equal((await open(databases, 'tfaf-units://spooky/js/app.js')).text, 'script');
  });

  it('turns links of a database page into addresses on its site', () => {
    assert.equal(unitDatabaseSiteUrl('tfaf-units://spooky/#/UEL0101'), 'https://faforever.github.io/spooky-db/#/UEL0101');
    assert.equal(unitDatabaseSiteUrl('tfaf-units://unitdb/compare?a=1'), 'https://unitdb.faforever.com/compare?a=1');
    assert.equal(unitDatabaseSiteUrl('tfaf-units://other/'), 'tfaf-units://other/');
    assert.equal(unitDatabaseSiteUrl('https://github.com/FAForever/fa'), 'https://github.com/FAForever/fa');
  });
});
