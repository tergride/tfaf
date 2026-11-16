// Timeouts and retry rules shared by the API client, the login and the downloads.

import { t } from '../i18n.ts';

/** Statuses after which the same request may succeed a little later. */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;

/** A failure that says nothing about the request itself, so the same request may succeed a little later. */
export class TransientError extends Error {}

/** The request did not complete in time; raised instead of the bare AbortError of fetch. */
export class TimeoutError extends TransientError {
  constructor(seconds: number) {
    super(t('main.net.timeout', { seconds }));
    this.name = 'TimeoutError';
  }
}

/** A response status that retrying will not change, kept so callers can tell e.g. a missing file. */
export class HttpStatusError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** A response status worth retrying, carrying its Retry-After hint. */
export class RetryableStatusError extends TransientError {
  readonly status: number;
  readonly retryAfter: string | null;

  constructor(message: string, status: number, retryAfter: string | null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** fetch with a deadline for the whole response (headers and body), still cancellable by the caller's signal. */
export async function fetchWithTimeout(url: string | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    throw timeout.aborted && !init.signal?.aborted ? new TimeoutError(Math.round(timeoutMs / 1000)) : error;
  }
}

const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** Network failures and timeouts that say nothing about the request itself, so trying again makes sense. */
export function isTransientError(error: unknown): boolean {
  if (error instanceof TransientError) {
    return true;
  }
  for (let current: unknown = error, depth = 0; current instanceof Error && depth < 4; depth++) {
    const code = (current as NodeJS.ErrnoException).code;
    if (code && TRANSIENT_CODES.has(code)) {
      return true;
    }
    // undici reports every network failure as `TypeError: fetch failed` with the details in `cause`.
    if (current instanceof TypeError && current.message === 'fetch failed') {
      return true;
    }
    current = current.cause;
  }
  return false;
}

/** Seconds or an HTTP date, as servers send it; null when absent or unreadable. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** Runs `work` again after transient failures, up to `retries` more times with backoff. */
export async function retrying<T>(work: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= retries || !isTransientError(error)) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelayMs(attempt, error instanceof RetryableStatusError ? error.retryAfter : null)),
      );
    }
  }
}

/** Exponential backoff with ±20% jitter, so many clients that failed together do not retry together. */
export function retryDelayMs(attempt: number, retryAfter: string | null = null, random = Math.random): number {
  const hinted = parseRetryAfter(retryAfter);
  const base = hinted ?? BASE_RETRY_DELAY_MS * 2 ** attempt;
  return Math.min(MAX_RETRY_DELAY_MS, Math.round(base * (0.8 + random() * 0.4)));
}
