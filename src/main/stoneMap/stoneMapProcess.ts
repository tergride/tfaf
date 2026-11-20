// The running StoneMap API: a process listening on 127.0.0.1 with a session token that never leaves the main process.
// Its first line of output names the address and the token; every request carries the token.

import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type { ApiError, Job } from '../../shared/stoneMap/contracts.ts';
import { describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import { LineDecoder } from '../lineDecoder.ts';

const STARTUP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 120_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const API_VERSION = '1.0';
const MAX_EVENT_BYTES = 4 * 1024 * 1024;
/** Reconnections of a job's event stream in a row before the watch gives up. */
const MAX_STREAM_FAILURES = 3;

export interface StoneMapHandshake {
  /** `http://127.0.0.1:<port>` */
  origin: string;
  token: string;
  pid: number;
}

/** The first line of the API's output; anything but a local address of the expected API version is refused. */
export function parseHandshake(line: string): StoneMapHandshake {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error(t('main.stoneMap.badHandshake'));
  }
  const ready = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const { type, apiVersion, url, token, pid } = ready;
  if (type !== 'ready' || apiVersion !== API_VERSION || typeof url !== 'string' || typeof token !== 'string' || token.length < 16) {
    throw new Error(t('main.stoneMap.badHandshake'));
  }
  let address: URL;
  try {
    address = new URL(url);
  } catch {
    throw new Error(t('main.stoneMap.badHandshake'));
  }
  if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port || address.pathname !== '/') {
    throw new Error(t('main.stoneMap.badHandshake'));
  }
  return { origin: address.origin, token, pid: typeof pid === 'number' && Number.isSafeInteger(pid) ? pid : 0 };
}

export interface ServerSentEvent {
  id: string;
  event: string;
  data: string;
}

/** Events of a `text/event-stream` body; comments and events without data are skipped. */
export async function* readServerSentEvents(body: AsyncIterable<Uint8Array>): AsyncGenerator<ServerSentEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    for (let separator = /\r?\n\r?\n/.exec(buffer); separator; separator = /\r?\n\r?\n/.exec(buffer)) {
      const block = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      let id = '';
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith(':')) {
          continue;
        }
        const colon = line.indexOf(':');
        const key = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (key === 'id') {
          id = value;
        } else if (key === 'event') {
          event = value;
        } else if (key === 'data') {
          data.push(value);
        }
      }
      if (data.length > 0) {
        yield { id, event, data: data.join('\n') };
      }
    }
    if (buffer.length > MAX_EVENT_BYTES) {
      throw new Error(t('main.stoneMap.badResponse'));
    }
  }
}

/** A refusal of the API, with its code (`invalid_settings`, `destination_exists`, ...) and HTTP status. */
export class StoneMapApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'StoneMapApiError';
    this.code = code;
    this.status = status;
  }
}

function apiError(status: number, payload: unknown): StoneMapApiError {
  const error = typeof payload === 'object' && payload !== null ? (payload as { error?: Partial<ApiError> }).error : undefined;
  const message = typeof error?.message === 'string' && error.message ? error.message : t('main.stoneMap.httpStatus', { status });
  return new StoneMapApiError(message, typeof error?.code === 'string' ? error.code : 'api_error', status);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

type ApiChild = ChildProcessByStdio<null, Readable, Readable>;

export class StoneMapProcess {
  private readonly child: ApiChild;
  private readonly handshake: StoneMapHandshake;
  private readonly exited: Promise<void>;
  private stopping: Promise<void> | null = null;

  private constructor(child: ApiChild, handshake: StoneMapHandshake, exited: Promise<void>) {
    this.child = child;
    this.handshake = handshake;
    this.exited = exited;
  }

  /**
   * Starts the API with its data in `dataDirectory`; `--parent-pid` stops it, and the generation it runs, when the
   * launcher goes away without stopping it. Its own messages are appended to `logPath`.
   */
  static async start(executable: string, dataDirectory: string, logPath: string, onExit: (code: number | null) => void): Promise<StoneMapProcess> {
    await Promise.all([mkdir(dataDirectory, { recursive: true }), mkdir(path.dirname(logPath), { recursive: true })]);
    const log = createWriteStream(logPath, { flags: 'a' });
    log.on('error', (error) => console.warn('StoneMap log could not be written', describeError(error)));
    log.write(`\n${new Date().toISOString()} ${executable}\n`);
    const child = spawn(
      executable,
      ['--port', '0', '--data-directory', dataDirectory, '--max-queued', '8', '--parent-pid', String(process.pid)],
      { cwd: path.dirname(executable), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    child.stderr.pipe(log, { end: false });
    const exited = new Promise<void>((resolve) => {
      child.once('close', (code) => {
        log.end(`${new Date().toISOString()} exited with ${code ?? 'no code'}\n`);
        onExit(code);
        resolve();
      });
    });
    try {
      const handshake = await StoneMapProcess.readHandshake(child, log, logPath);
      return new StoneMapProcess(child, handshake, exited);
    } catch (error) {
      child.kill();
      throw error;
    }
  }

  private static readHandshake(child: ApiChild, log: WriteStream, logPath: string): Promise<StoneMapHandshake> {
    return new Promise((resolve, reject) => {
      const lines = new LineDecoder();
      let settled = false;
      const finish = (outcome: { handshake: StoneMapHandshake } | { error: Error }): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        child.off('error', failed);
        child.off('close', closed);
        if ('error' in outcome) {
          reject(outcome.error);
        } else {
          resolve(outcome.handshake);
        }
      };
      const failed = (error: Error): void => finish({ error: new Error(t('main.stoneMap.spawnFailed', { error: error.message })) });
      const closed = (code: number | null): void => finish({ error: new Error(t('main.stoneMap.exitedOnStart', { code: code ?? '?', log: logPath })) });
      const timer = setTimeout(() => finish({ error: new Error(t('main.stoneMap.startTimeout')) }), STARTUP_TIMEOUT_MS);
      child.once('error', failed);
      child.once('close', closed);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        for (const line of lines.push(chunk)) {
          if (settled) {
            // The token is only on the first line; whatever follows is ordinary output.
            log.write(`${line}\n`);
            continue;
          }
          try {
            finish({ handshake: parseHandshake(line) });
          } catch (error) {
            finish({ error: error instanceof Error ? error : new Error(String(error)) });
          }
        }
      });
    });
  }

  get running(): boolean {
    return this.child.exitCode === null && this.child.signalCode === null;
  }

  async json<T>(route: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.request(route, options);
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  async bytes(route: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    const response = await this.request(route, { signal });
    return new Uint8Array(await response.arrayBuffer());
  }

  /** The body of a download; the caller reads it to the end or cancels it. */
  async stream(route: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const response = await this.request(route, { signal, timeout: false });
    if (!response.body) {
      throw new Error(t('main.stoneMap.badResponse'));
    }
    return response.body;
  }

  /**
   * Snapshots of a job until it ends, read from its event stream. A dropped stream is opened again from the last
   * event it delivered; the API then sends what was missed or the current snapshot.
   */
  async *watch(jobId: string, signal: AbortSignal): AsyncGenerator<Job> {
    let lastEventId = 0;
    let failures = 0;
    while (!signal.aborted) {
      try {
        const response = await this.request(`jobs/${encodeURIComponent(jobId)}/events`, {
          headers: { 'Last-Event-ID': String(lastEventId), Accept: 'text/event-stream' },
          signal,
          timeout: false,
        });
        if (!response.body) {
          throw new Error(t('main.stoneMap.badResponse'));
        }
        for await (const event of readServerSentEvents(response.body)) {
          lastEventId = Math.max(lastEventId, Number(event.id) || 0);
          failures = 0;
          const job = JSON.parse(event.data) as Job;
          yield job;
          if (job.terminal) {
            return;
          }
        }
        failures++;
      } catch (error) {
        if (signal.aborted || (error instanceof StoneMapApiError && (error.status === 401 || error.status === 404))) {
          throw error;
        }
        failures++;
        if (failures > MAX_STREAM_FAILURES) {
          throw error;
        }
      }
      if (failures > MAX_STREAM_FAILURES) {
        throw new Error(t('main.stoneMap.streamEnded'));
      }
      await delay(500, undefined, { signal });
    }
  }

  /** Asks the API to stop, which also stops a running generation; kills it if it does not stop in time. */
  stop(): Promise<void> {
    this.stopping ??= (async () => {
      if (!this.running) {
        return;
      }
      try {
        await this.request('shutdown', { method: 'POST', body: {}, signal: AbortSignal.timeout(SHUTDOWN_TIMEOUT_MS) });
        await Promise.race([this.exited, delay(SHUTDOWN_TIMEOUT_MS, undefined, { ref: false }).then(() => Promise.reject(new Error('timeout')))]);
      } catch {
        this.child.kill();
        await this.exited;
      }
    })();
    return this.stopping;
  }

  /** Ends the process at once, for a quit that cannot wait. */
  kill(): void {
    if (this.running) {
      this.child.kill();
    }
  }

  private async request(route: string, options: RequestOptions & { timeout?: boolean }): Promise<Response> {
    if (!this.running) {
      throw new Error(t('main.stoneMap.notRunning'));
    }
    const { method = 'GET', body, headers = {}, signal, timeout = true } = options;
    const signals = [signal, timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined].filter((value) => value !== undefined);
    const response = await fetch(`${this.handshake.origin}/api/v1/${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.handshake.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signals.length > 0 ? AbortSignal.any(signals) : undefined,
    });
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      throw apiError(response.status, payload);
    }
    return response;
  }
}
