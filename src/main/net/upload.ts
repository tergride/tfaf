// Request bodies sent from disk: map and mod uploads. They report byte progress, can be cancelled, and their deadline
// measures stalls rather than the whole transfer, so a large map on a slow connection still goes through.

import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { CancelledError } from '../errors.ts';
import { TimeoutError } from './http.ts';

const STALL_TIMEOUT_MS = 60_000;
// The API unpacks and checks an uploaded map before it answers.
const RESPONSE_TIMEOUT_MS = 300_000;
const CRLF = '\r\n';

/** A body whose length is known up front: S3 rejects chunked uploads. */
export interface UploadBody {
  contentType: string;
  length: number;
  /** A fresh stream for every attempt, since a sent one is used up. */
  open(): AsyncIterable<Uint8Array>;
}

/** Byte progress and cancel of an upload, as a task passes them on. */
export interface TransferOptions {
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  /** Stops the upload at once; it then fails with CancelledError. */
  signal?: AbortSignal;
}

export interface UploadTiming {
  stallTimeoutMs: number;
  /** From the last byte sent until the answer has been read. */
  responseTimeoutMs: number;
}

export interface UploadResponse {
  status: number;
  headers: Headers;
  text: string;
}

export type MultipartPart =
  | { name: string; value: string; contentType?: string }
  | { name: string; file: string; fileName: string; contentType: string };

export async function fileBody(file: string, contentType: string): Promise<UploadBody> {
  const { size } = await stat(file);
  return { contentType, length: size, open: () => createReadStream(file) };
}

/** Header parameters are escaped the way browsers escape form data names. */
function quoted(value: string): string {
  return `"${value.replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}"`;
}

/** `multipart/form-data` with files streamed from disk; the boundary is random unless a test fixes it. */
export async function multipartBody(
  parts: readonly MultipartPart[],
  boundary = `tfaf-${randomBytes(16).toString('hex')}`,
): Promise<UploadBody> {
  const prepared = await Promise.all(
    parts.map(async (part) => {
      const fileName = 'file' in part ? `; filename=${quoted(part.fileName)}` : '';
      const type = part.contentType ? `Content-Type: ${part.contentType}${CRLF}` : '';
      const head = Buffer.from(
        `--${boundary}${CRLF}Content-Disposition: form-data; name=${quoted(part.name)}${fileName}${CRLF}${type}${CRLF}`,
      );
      if ('file' in part) {
        return { head, file: part.file, value: null, length: (await stat(part.file)).size };
      }
      const value = Buffer.from(part.value);
      return { head, file: null, value, length: value.length };
    }),
  );
  const tail = Buffer.from(`--${boundary}--${CRLF}`);
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    length: prepared.reduce((sum, part) => sum + part.head.length + part.length + CRLF.length, tail.length),
    async *open() {
      for (const part of prepared) {
        yield part.head;
        if (part.file !== null) {
          yield* createReadStream(part.file);
        } else {
          yield part.value;
        }
        yield Buffer.from(CRLF);
      }
      yield tail;
    },
  };
}

/** Sends the body and reads the whole answer. Nothing is retried: the caller knows whether a repeat is safe. */
export async function sendUpload(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: UploadBody,
  options: TransferOptions = {},
  timing: UploadTiming = { stallTimeoutMs: STALL_TIMEOUT_MS, responseTimeoutMs: RESPONSE_TIMEOUT_MS },
): Promise<UploadResponse> {
  const { signal, onProgress } = options;
  if (signal?.aborted) {
    throw new CancelledError();
  }
  const controller = new AbortController();
  let timedOutAfterMs: number | null = null;
  let timer: NodeJS.Timeout | undefined;
  // The connection may pull the end of the body only after the answer has arrived.
  let settled = false;
  const arm = (ms: number): void => {
    clearTimeout(timer);
    if (settled) {
      return;
    }
    timer = setTimeout(() => {
      timedOutAfterMs = ms;
      controller.abort();
    }, ms);
  };
  const timeoutError = (error: unknown): unknown =>
    timedOutAfterMs === null ? error : new TimeoutError(Math.max(1, Math.round(timedOutAfterMs / 1000)));
  let sent = 0;
  // The connection pulls the next chunk once it has taken the previous one, so the count follows the socket.
  async function* counted(): AsyncGenerator<Uint8Array> {
    for await (const chunk of body.open()) {
      arm(timing.stallTimeoutMs);
      yield chunk;
      sent += chunk.length;
      if (!settled) {
        onProgress?.(sent, body.length);
      }
    }
    arm(timing.responseTimeoutMs);
  }

  arm(timing.stallTimeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: { ...headers, 'Content-Type': body.contentType, 'Content-Length': String(body.length) },
      body: counted(),
      duplex: 'half',
      signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
    });
    return { status: response.status, headers: response.headers, text: await response.text() };
  } catch (error) {
    if (signal?.aborted) {
      throw new CancelledError();
    }
    throw timeoutError(error);
  } finally {
    settled = true;
    clearTimeout(timer);
  }
}
