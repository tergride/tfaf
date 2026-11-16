import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { CancelledError, describeError } from '../src/main/errors.ts';
import { isTransientError, parseRetryAfter, retryDelayMs, TimeoutError } from '../src/main/net/http.ts';
import { TaskReporter } from '../src/main/tasks.ts';
import { downloadToTempFile } from '../src/main/vault/download.ts';
import type { TaskProgress } from '../src/shared/contract.ts';
import { isCancelledMessage } from '../src/shared/i18n/index.ts';

const BODY = Buffer.from(Array.from({ length: 64 * 1024 }, (_, index) => index % 251));
const MD5 = createHash('md5').update(BODY).digest('hex');
const FAST = { responseTimeoutMs: 1_000, stallTimeoutMs: 200, retryDelayMs: () => 10 };

type Behaviour = 'drop' | 'stall' | 'busy' | 'ok' | 'ignoreRange' | 'missing';

let server: http.Server;
let baseUrl = '';
const plans = new Map<string, Behaviour[]>();
const requests = new Map<string, string[]>();

function serve(request: http.IncomingMessage, response: http.ServerResponse): void {
  const name = request.url ?? '';
  const plan = plans.get(name) ?? [];
  const behaviour = plan.shift() ?? 'ok';
  requests.set(name, [...(requests.get(name) ?? []), request.headers.range ?? 'full']);
  const range = /^bytes=(\d+)-$/.exec(request.headers.range ?? '');
  const start = range && behaviour !== 'ignoreRange' ? Number(range[1]) : 0;
  switch (behaviour) {
    case 'missing':
      response.writeHead(404).end();
      return;
    case 'busy':
      response.writeHead(503, { 'Retry-After': '0' }).end();
      return;
    case 'stall':
      response.writeHead(200, { 'Content-Length': BODY.length });
      response.write(BODY.subarray(0, 1000));
      return;
    case 'drop':
      response.writeHead(200, { 'Content-Length': BODY.length });
      // The pause lets the client read the first half before the connection breaks.
      response.write(BODY.subarray(0, BODY.length / 2), () => setTimeout(() => response.socket?.destroy(), 50));
      return;
    default: {
      const headers: http.OutgoingHttpHeaders = { 'Content-Length': BODY.length - start, 'Accept-Ranges': 'bytes' };
      if (start > 0) {
        headers['Content-Range'] = `bytes ${start}-${BODY.length - 1}/${BODY.length}`;
      }
      response.writeHead(start > 0 ? 206 : 200, headers).end(BODY.subarray(start));
    }
  }
}

async function fetchFile(name: string, plan: Behaviour[]): Promise<Buffer> {
  plans.set(name, plan);
  const download = await downloadToTempFile(`${baseUrl}${name}`, 'test', () => {}, {
    checksum: { algorithm: 'md5', digest: MD5 },
    timing: FAST,
  });
  try {
    return await readFile(download.path);
  } finally {
    await download.cleanup();
  }
}

describe('downloads', () => {
  before(async () => {
    server = http.createServer(serve);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('continues a dropped download from where it stopped', async () => {
    assert.deepEqual(await fetchFile('/drop', ['drop', 'ok']), BODY);
    const [first, second] = requests.get('/drop') ?? [];
    assert.equal(first, 'full');
    assert.match(second ?? '', /^bytes=\d+-$/);
    assert.notEqual(second, 'bytes=0-');
  });

  it('starts over when the server ignores the range', async () => {
    assert.deepEqual(await fetchFile('/ignore', ['drop', 'ignoreRange']), BODY);
  });

  it('retries a stalled transfer and busy answers', async () => {
    assert.deepEqual(await fetchFile('/stall', ['stall', 'busy', 'ok']), BODY);
    assert.equal(requests.get('/stall')?.length, 3);
  });

  it('gives up after a few attempts and on errors that will not go away', async () => {
    await assert.rejects(fetchFile('/down', ['busy', 'busy', 'busy', 'busy', 'ok']), /503/);
    await assert.rejects(fetchFile('/missing', ['missing']), /404/);
    assert.equal(requests.get('/missing')?.length, 1);
  });

  it('stops a cancelled download at once, without retries, and removes the temporary file', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'tfaf-test-'));
    try {
      plans.set('/cancel', ['stall', 'ok']);
      const controller = new AbortController();
      const started = Date.now();
      await assert.rejects(
        downloadToTempFile(`${baseUrl}/cancel`, 'test', () => controller.abort(), {
          tempDirectory,
          timing: { ...FAST, stallTimeoutMs: 5_000 },
          signal: controller.signal,
        }),
        CancelledError,
      );
      assert.ok(Date.now() - started < 2_000, 'the stall timeout is not waited for');
      assert.equal(requests.get('/cancel')?.length, 1);
      assert.deepEqual(await readdir(tempDirectory), []);

      await assert.rejects(
        downloadToTempFile(`${baseUrl}/never`, 'test', () => {}, { tempDirectory, signal: AbortSignal.abort() }),
        CancelledError,
      );
      assert.equal(requests.has('/never'), false);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });
});

describe('task cancellation', () => {
  it('reports a cancelled task and hands its waiters a CancelledError', async () => {
    const events: TaskProgress[] = [];
    const tasks = new TaskReporter((task) => events.push(task));
    const work = tasks.run(
      'Карта test',
      (task) =>
        new Promise<void>((_resolve, reject) => {
          task.signal.addEventListener('abort', () => reject(new Error('aborted by the signal')));
        }),
      { cancellable: true },
    );
    const id = events[0]?.id ?? '';
    assert.equal(events[0]?.cancellable, true);
    tasks.cancel(id);
    await assert.rejects(work, (error: unknown) => error instanceof CancelledError && isCancelledMessage(error.message));
    assert.deepEqual(
      events.map((event) => event.state),
      ['running', 'cancelled'],
    );
  });

  it('leaves tasks that cannot be cancelled running', async () => {
    const events: TaskProgress[] = [];
    const tasks = new TaskReporter((task) => events.push(task));
    let finish = (): void => {};
    const work = tasks.run('Проверка модов', () => new Promise<void>((resolve) => (finish = resolve)));
    tasks.cancel(events[0]?.id ?? '');
    finish();
    await work;
    assert.deepEqual(
      events.map((event) => [event.state, event.cancellable]),
      [
        ['running', false],
        ['done', false],
      ],
    );
  });
});

describe('retry rules', () => {
  it('treats network failures and timeouts as transient', () => {
    const fetchFailed = new TypeError('fetch failed', { cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) });
    assert.equal(isTransientError(fetchFailed), true);
    assert.equal(isTransientError(new TimeoutError(20)), true);
    assert.equal(isTransientError(new Error('API: not found')), false);
    assert.equal(describeError(fetchFailed), 'Нет связи с сервером (ECONNREFUSED)');
  });

  it('honours Retry-After and caps the backoff', () => {
    assert.equal(parseRetryAfter('3'), 3000);
    assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6_000);
    assert.equal(parseRetryAfter('soon'), null);
    assert.equal(retryDelayMs(0, null, () => 0.5), 1000);
    assert.equal(retryDelayMs(2, null, () => 0.5), 4000);
    assert.equal(retryDelayMs(10, null, () => 1), 30_000);
    assert.equal(retryDelayMs(0, '2', () => 0.5), 2000);
  });
});
