import { createHash, type Hash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { setTimeout as delay } from 'node:timers/promises';
import { CancelledError } from '../errors.ts';
import { t } from '../i18n.ts';
import {
  HttpStatusError,
  isTransientError,
  RETRYABLE_STATUSES,
  RetryableStatusError,
  retryDelayMs,
  TimeoutError,
  TransientError,
} from '../net/http.ts';

const MAX_DOWNLOAD_BYTES = 2 * 1024 ** 3;
const MAX_ATTEMPTS = 4;
const RESPONSE_TIMEOUT_MS = 30_000;
// Measured between chunks rather than for the whole file, so a slow but steady connection never times out.
const STALL_TIMEOUT_MS = 30_000;

export interface DownloadedFile {
  path: string;
  cleanup(): Promise<void>;
}

export interface DownloadTiming {
  responseTimeoutMs: number;
  stallTimeoutMs: number;
  retryDelayMs(attempt: number, retryAfter: string | null): number;
}

export interface DownloadOptions {
  headers?: Record<string, string>;
  /** The download is rejected unless its digest matches; hex, case-insensitive. */
  checksum?: { algorithm: 'md5' | 'sha256'; digest: string };
  /** Where the temporary file is created; the same volume as the destination allows an atomic rename. */
  tempDirectory?: string;
  /** Timeouts and backoff; only tests change them. */
  timing?: Partial<DownloadTiming>;
  /** Stops the download at once, without retries; it then fails with CancelledError. */
  signal?: AbortSignal;
}

const TEMP_DIRECTORY = /^tfaf-[A-Za-z0-9]{6}$/;
const STALE_TEMP_MS = 60 * 60 * 1000;

/** Temporary downloads in the system temp folder that a launcher closed or crashed mid-download left behind. */
export async function removeStaleTempDownloads(): Promise<void> {
  const directory = os.tmpdir();
  const now = Date.now();
  for (const name of await readdir(directory).catch(() => [])) {
    if (!TEMP_DIRECTORY.test(name)) {
      continue;
    }
    const entry = path.join(directory, name);
    const info = await stat(entry).catch(() => null);
    if (info?.isDirectory() && now - info.mtimeMs > STALE_TEMP_MS) {
      await rm(entry, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Byte progress of a download; `total` is null when the server does not send a length. */
export type DownloadProgress = (receivedBytes: number, totalBytes: number | null) => void;

export function progressFraction(receivedBytes: number, totalBytes: number | null): number | null {
  return totalBytes ? Math.min(receivedBytes / totalBytes, 1) : null;
}

/** `bytes 100-999/1000` → 1000. */
function contentRangeTotal(header: string | null): number | null {
  const total = Number(header?.match(/\/(\d+)\s*$/)?.[1]);
  return Number.isFinite(total) && total > 0 ? total : null;
}

async function hashFile(file: string, hash: Hash): Promise<void> {
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
  }
}

interface Progress {
  received: number;
  total: number | null;
  hash: Hash | null;
}

/**
 * Downloads into a temporary file. A dropped or stalled connection is retried and continues where it stopped when the
 * server supports ranges; the checksum always covers the whole file.
 */
export async function downloadToTempFile(
  url: string,
  userAgent: string,
  onProgress: DownloadProgress,
  options: DownloadOptions = {},
): Promise<DownloadedFile> {
  const timing: DownloadTiming = {
    responseTimeoutMs: RESPONSE_TIMEOUT_MS,
    stallTimeoutMs: STALL_TIMEOUT_MS,
    retryDelayMs,
    ...options.timing,
  };
  const { signal } = options;
  if (signal?.aborted) {
    throw new CancelledError();
  }
  const directory = await mkdtemp(path.join(options.tempDirectory ?? os.tmpdir(), options.tempDirectory ? '.tfaf-download-' : 'tfaf-'));
  const cleanup = (): Promise<void> => rm(directory, { recursive: true, force: true });
  const file = path.join(directory, 'download');
  const progress: Progress = { received: 0, total: null, hash: null };
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await downloadAttempt(url, userAgent, file, progress, onProgress, options, timing);
        break;
      } catch (error) {
        if (signal?.aborted || attempt + 1 >= MAX_ATTEMPTS || !isTransientError(error)) {
          throw error;
        }
        console.warn(`Download of ${new URL(url).pathname} interrupted, retrying: ${(error as Error).message}`);
        await delay(timing.retryDelayMs(attempt, error instanceof RetryableStatusError ? error.retryAfter : null), undefined, {
          signal,
        });
        // Whatever reached the disk is kept; the digest is rebuilt from it because the last chunks may not have.
        progress.received = (await stat(file).catch(() => null))?.size ?? 0;
        progress.hash = null;
        if (options.checksum && progress.received > 0) {
          progress.hash = createHash(options.checksum.algorithm);
          await hashFile(file, progress.hash);
        }
      }
    }
    if (progress.hash && options.checksum && progress.hash.digest('hex') !== options.checksum.digest.toLowerCase()) {
      throw new Error(t('main.download.checksumMismatch', { file: path.basename(new URL(url).pathname) }));
    }
    return { path: file, cleanup };
  } catch (error) {
    await cleanup();
    throw signal?.aborted ? new CancelledError() : error;
  }
}

async function downloadAttempt(
  url: string,
  userAgent: string,
  file: string,
  progress: Progress,
  onProgress: DownloadProgress,
  options: DownloadOptions,
  timing: DownloadTiming,
): Promise<void> {
  const controller = new AbortController();
  let timedOutAfterMs: number | null = null;
  let timer: NodeJS.Timeout | undefined;
  const arm = (ms: number): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOutAfterMs = ms;
      controller.abort();
    }, ms);
  };
  const timeoutError = (error: unknown): unknown =>
    timedOutAfterMs === null ? error : new TimeoutError(Math.max(1, Math.round(timedOutAfterMs / 1000)));

  arm(timing.responseTimeoutMs);
  try {
    const headers: Record<string, string> = { ...options.headers, 'User-Agent': userAgent };
    const resuming = progress.received > 0;
    if (resuming) {
      headers.Range = `bytes=${progress.received}-`;
    }
    let response: Response;
    try {
      const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
      response = await fetch(url, { headers, signal });
    } catch (error) {
      throw timeoutError(error);
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      const message = t('main.download.serverStatus', { status: response.status });
      if (RETRYABLE_STATUSES.has(response.status)) {
        throw new RetryableStatusError(message, response.status, response.headers.get('retry-after'));
      }
      throw new HttpStatusError(message, response.status);
    }
    // A server that ignores the range sends the whole file again, so the download starts over.
    const append = resuming && response.status === 206;
    if (append) {
      progress.total = contentRangeTotal(response.headers.get('content-range')) ?? progress.total;
    } else {
      progress.received = 0;
      progress.total = Number(response.headers.get('content-length')) || null;
      progress.hash = options.checksum ? createHash(options.checksum.algorithm) : null;
    }

    arm(timing.stallTimeoutMs);
    const counter = new Transform({
      transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
        arm(timing.stallTimeoutMs);
        progress.received += chunk.length;
        if (progress.received > MAX_DOWNLOAD_BYTES) {
          callback(new Error(t('main.download.tooLarge')));
          return;
        }
        progress.hash?.update(chunk);
        onProgress(progress.received, progress.total);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
        counter,
        createWriteStream(file, { flags: append ? 'a' : 'w' }),
      );
    } catch (error) {
      throw timeoutError(error);
    }
    if (progress.total !== null && progress.received < progress.total) {
      throw new TransientError(t('main.download.interrupted', { received: progress.received, total: progress.total }));
    }
  } finally {
    clearTimeout(timer);
  }
}
