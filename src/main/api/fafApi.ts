import { setTimeout as delay } from 'node:timers/promises';
import { type AuthService, InvalidGrantError } from '../auth/authService.ts';
import { t } from '../i18n.ts';
import { fetchWithTimeout, isTransientError, RETRYABLE_STATUSES, RetryableStatusError, retryDelayMs } from '../net/http.ts';
import {
  fileBody,
  type MultipartPart,
  multipartBody,
  sendUpload,
  type TransferOptions,
  type UploadBody,
} from '../net/upload.ts';
import { asObject, asString, readAllPages } from './jsonApi.ts';

const MAX_PAGE_SIZE = '100';
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_CACHED_RESPONSES = 50;
const JSON_API_MEDIA_TYPE = 'application/vnd.api+json';
const JSON_MEDIA_TYPE = 'application/json';

/** The API refused the access token; one retry with a freshly refreshed token decides whether the session is gone. */
class SessionTokenRejected extends Error {}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface ApiRequest {
  method: Method;
  accept: string;
  /** JSON text, or a body from disk that is sent with progress. */
  body?: { contentType: string; text: string } | UploadBody;
  transfer?: TransferOptions;
}

interface ApiResponse {
  status: number;
  retryAfter: string | null;
  body: unknown;
}

function extractApiError(body: unknown): string | null {
  const errors = asObject(body)?.errors;
  if (!Array.isArray(errors)) {
    return null;
  }
  const first = asObject(errors[0]);
  return asString(first?.detail) ?? asString(first?.title);
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** Authenticated access to the FAF JSON:API (`Authorization` + `X-HMAC`, like the official client's apiWebClient). */
export class FafApi {
  private readonly auth: AuthService;
  private readonly userAgent: string;
  private readonly cache = new Map<string, { at: number; body: unknown }>();

  constructor(auth: AuthService, userAgent: string) {
    this.auth = auth;
    this.userAgent = userAgent;
  }

  /**
   * `fields[type]` in `params` leaves only the id of every type it does not name, the requested one included, so a
   * narrowed request names all the types it reads.
   */
  async get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    return this.request(this.apiUrl(path, params), { method: 'GET', accept: JSON_API_MEDIA_TYPE });
  }

  /**
   * For vault listings the user flips between: the same page within `maxAgeMs` comes from memory. Only successful
   * answers are kept, and the cache is per server because the URL includes it.
   */
  async getCached(path: string, params: Record<string, string>, maxAgeMs: number): Promise<unknown> {
    const url = this.apiUrl(path, params);
    const key = url.toString();
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < maxAgeMs) {
      return cached.body;
    }
    const body = await this.request(url, { method: 'GET', accept: JSON_API_MEDIA_TYPE });
    this.cache.set(key, { at: Date.now(), body });
    if (this.cache.size > MAX_CACHED_RESPONSES) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
    return body;
  }

  /** A list that may not fit a page; with `maxAgeMs` its pages come through the cache of `getCached`. */
  getAll(path: string, params: Record<string, string>, maxAgeMs = 0): Promise<unknown> {
    return readAllPages((number) => {
      const page = { ...params, 'page[size]': MAX_PAGE_SIZE, 'page[number]': String(number), 'page[totals]': '' };
      return maxAgeMs > 0 ? this.getCached(path, page, maxAgeMs) : this.get(path, page);
    });
  }

  private apiUrl(path: string, params: Record<string, string>): URL {
    const url = new URL(path, this.auth.getServer().apiBaseUrl);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, value);
    }
    return url;
  }

  /** Non JSON:API endpoints of the API such as `/ice/session/game/{id}`. */
  getJson(path: string): Promise<unknown> {
    return this.request(new URL(path, this.auth.getServer().apiBaseUrl), { method: 'GET', accept: JSON_MEDIA_TYPE });
  }

  /** The user service (lobby access) accepts the same credentials as the API. */
  getFromUserService(path: string): Promise<unknown> {
    return this.request(new URL(path, this.auth.getServer().userBaseUrl), { method: 'GET', accept: JSON_MEDIA_TYPE });
  }

  /** Creates a JSON:API resource; the answer is the document of the created one. */
  post(path: string, document: unknown): Promise<unknown> {
    return this.write('POST', path, document, JSON_API_MEDIA_TYPE);
  }

  patch(path: string, document: unknown): Promise<unknown> {
    return this.write('PATCH', path, document, JSON_API_MEDIA_TYPE);
  }

  async delete(path: string): Promise<void> {
    await this.write('DELETE', path, undefined, JSON_API_MEDIA_TYPE);
  }

  /** Endpoints outside JSON:API that take plain JSON, such as `/mods/upload/complete`. */
  postJson(path: string, body: unknown): Promise<unknown> {
    return this.write('POST', path, body, JSON_MEDIA_TYPE);
  }

  /** A form with files to the API, such as a map to `/maps/upload`. */
  async uploadMultipart(path: string, parts: readonly MultipartPart[], transfer: TransferOptions = {}): Promise<unknown> {
    const body = await multipartBody(parts);
    const answer = await this.request(this.apiUrl(path, {}), { method: 'POST', accept: JSON_MEDIA_TYPE, body, transfer });
    this.cache.clear();
    return answer;
  }

  /**
   * A file to the S3 address the API handed out for it (mod uploads). The signature in the address is the only
   * credential, so the API token is not sent along.
   */
  async putPresigned(url: string, file: string, contentType: string, transfer: TransferOptions = {}): Promise<void> {
    const target = new URL(url);
    if (target.protocol !== 'https:') {
      throw new Error(t('main.api.unsafeUploadUrl'));
    }
    const body = await fileBody(file, contentType);
    const response = await sendUpload(target, 'PUT', { 'User-Agent': this.userAgent }, body, transfer);
    if (response.status < 200 || response.status >= 300) {
      const detail = /<Message>([^<]*)<\/Message>/.exec(response.text)?.[1]?.trim();
      throw new Error(
        detail
          ? t('main.api.storageStatusDetail', { status: response.status, detail })
          : t('main.api.storageStatus', { status: response.status }),
      );
    }
  }

  private async write(method: Method, path: string, payload: unknown, mediaType: string): Promise<unknown> {
    const body = payload === undefined ? undefined : { contentType: mediaType, text: JSON.stringify(payload) };
    const answer = await this.request(this.apiUrl(path, {}), { method, accept: mediaType, body });
    // Cached listings may show what the write has just changed.
    this.cache.clear();
    return answer;
  }

  /**
   * Network failures, timeouts and 5xx answers are retried with backoff for GETs only: a write may have gone through
   * before the failure. A refused token is refreshed and the request repeated once, writes included.
   */
  private async request(url: URL, request: ApiRequest): Promise<unknown> {
    const maxRetries = request.method === 'GET' ? MAX_RETRIES : 0;
    let authRetried = false;
    let retries = 0;
    for (;;) {
      try {
        return await this.attempt(url, request);
      } catch (error) {
        if (error instanceof SessionTokenRejected) {
          if (authRetried) {
            await this.auth.expireSession();
            throw new Error(t('main.auth.sessionExpired'), { cause: error });
          }
          authRetried = true;
          this.auth.invalidateAccessToken();
          continue;
        }
        if (retries >= maxRetries || !isTransientError(error)) {
          throw error;
        }
        await delay(retryDelayMs(retries++, error instanceof RetryableStatusError ? error.retryAfter : null));
      }
    }
  }

  private async attempt(url: URL, request: ApiRequest): Promise<unknown> {
    const response = await this.send(url, request, await this.headers(request.accept));
    if (response.status === 401) {
      throw new SessionTokenRejected();
    }
    if (response.status >= 200 && response.status < 300) {
      return response.body;
    }
    const detail = extractApiError(response.body);
    const message = detail ? `API: ${detail}` : t('main.api.hostStatus', { host: url.hostname, status: response.status });
    if (RETRYABLE_STATUSES.has(response.status)) {
      throw new RetryableStatusError(message, response.status, response.retryAfter);
    }
    throw new Error(message);
  }

  private async send(url: URL, request: ApiRequest, headers: Record<string, string>): Promise<ApiResponse> {
    const { body } = request;
    if (body && 'open' in body) {
      const response = await sendUpload(url, request.method, headers, body, request.transfer);
      return { status: response.status, retryAfter: response.headers.get('retry-after'), body: parseJson(response.text) };
    }
    if (body) {
      headers['Content-Type'] = body.contentType;
    }
    const response = await fetchWithTimeout(url, { method: request.method, headers, body: body?.text }, REQUEST_TIMEOUT_MS);
    if (response.status === 401) {
      await response.body?.cancel();
      return { status: response.status, retryAfter: null, body: null };
    }
    const answer: unknown = await response.json().catch(() => null);
    return { status: response.status, retryAfter: response.headers.get('retry-after'), body: answer };
  }

  private async headers(accept: string): Promise<Record<string, string>> {
    let token;
    try {
      token = await this.auth.getAccessToken();
    } catch (error) {
      if (error instanceof InvalidGrantError) {
        await this.auth.expireSession();
      }
      throw error;
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token.value}`,
      Accept: accept,
      'User-Agent': this.userAgent,
    };
    if (token.hmac) {
      headers['X-HMAC'] = token.hmac;
    }
    return headers;
  }
}
