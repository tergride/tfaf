import { shell } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';
import type { AuthState, ServerId, UserInfo } from '../../shared/contract.ts';
import { describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import { fetchWithTimeout, isTransientError, RETRYABLE_STATUSES, RetryableStatusError, retryDelayMs } from '../net/http.ts';
import { getServerProfile, type ServerProfile } from '../servers.ts';
import type { SettingsStore } from '../settings.ts';
import { decodeJwtPayload, extractHmac } from './jwt.ts';
import type { TokenStore } from './tokenStore.ts';

export interface AccessToken {
  value: string;
  hmac: string | null;
  expiresAt: number;
}

/** The authorization server rejected the refresh token; the user has to log in again. */
export class InvalidGrantError extends Error {}

export class NotSignedInError extends Error {
  constructor() {
    super(t('main.auth.signInRequired'));
  }
}

interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const TOKEN_EXPIRY_MARGIN_MS = 30_000;
const REQUEST_TIMEOUT_MS = 20_000;

function readObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function parseDeviceCode(body: unknown): DeviceCode {
  const raw = readObject(body);
  const verificationUri = raw.verification_uri_complete ?? raw.verification_uri;
  if (
    typeof raw.device_code !== 'string' ||
    typeof raw.user_code !== 'string' ||
    typeof verificationUri !== 'string' ||
    typeof raw.expires_in !== 'number'
  ) {
    throw new Error(t('main.auth.invalidResponse'));
  }
  const interval = typeof raw.interval === 'number' && raw.interval > 0 ? raw.interval : DEFAULT_POLL_INTERVAL_SECONDS;
  return {
    deviceCode: raw.device_code,
    userCode: raw.user_code,
    verificationUri,
    expiresIn: raw.expires_in,
    interval,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** OAuth 2.0 device authorization flow (RFC 8628) against FAF Hydra, mirroring the official client's TokenRetriever. */
export class AuthService {
  private readonly settings: SettingsStore;
  private readonly tokenStore: TokenStore;
  private readonly userAgent: string;
  private readonly listeners = new Set<(state: AuthState) => void>();

  private state: AuthState;
  private accessToken: AccessToken | null = null;
  private refreshToken: string | null = null;
  private refreshInFlight: Promise<AccessToken> | null = null;
  private loginAbort: AbortController | null = null;
  // Bumped whenever the tokens are dropped, so a refresh that was in flight during a logout cannot bring them back.
  private tokenGeneration = 0;

  constructor(settings: SettingsStore, tokenStore: TokenStore, userAgent: string) {
    this.settings = settings;
    this.tokenStore = tokenStore;
    this.userAgent = userAgent;
    this.state = { status: 'signedOut', server: settings.get().server };
  }

  getState(): AuthState {
    return this.state;
  }

  getServer(): ServerProfile {
    return getServerProfile(this.settings.get().server);
  }

  getUser(): UserInfo | null {
    return this.state.status === 'signedIn' ? this.state.user : null;
  }

  onStateChanged(listener: (state: AuthState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Signs in with the remembered refresh token of the selected server, if there is one. */
  async restore(): Promise<void> {
    const signal = this.beginFlow();
    const server = this.settings.get().server;
    for (let attempt = 0; ; attempt++) {
      try {
        await this.tryStoredSession(server, signal);
        return;
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        if (!isTransientError(error)) {
          this.setState({ status: 'signedOut', server, error: t('main.auth.restoreFailed', { error: describeError(error) }) });
          return;
        }
        // Without a network the remembered session is still good, so it is tried again instead of asking to log in.
        const waitMs = retryDelayMs(attempt);
        console.warn(`Session restore failed, retrying in ${Math.round(waitMs / 1000)} s: ${describeError(error)}`);
        this.setState({ status: 'restoring', server, error: describeError(error), retryAt: Date.now() + waitMs });
        try {
          await delay(waitMs, undefined, { signal });
        } catch {
          return;
        }
      }
    }
  }

  /** Starts the login flow in the background; progress is reported through state changes. */
  login(server: ServerId): void {
    const signal = this.beginFlow();
    void this.runLogin(server, signal).catch((error: unknown) => {
      if (signal.aborted || isAbortError(error)) {
        return;
      }
      console.warn('Login failed', describeError(error));
      this.resetTokens();
      this.setState({ status: 'signedOut', server, error: describeError(error) });
    });
  }

  cancelLogin(): void {
    this.loginAbort?.abort();
    this.loginAbort = null;
    if (this.state.status !== 'signedIn') {
      this.setState({ status: 'signedOut', server: this.settings.get().server });
    }
  }

  async logout(): Promise<void> {
    this.loginAbort?.abort();
    const server = this.settings.get().server;
    const refreshToken = this.refreshToken;
    this.resetTokens();
    await this.tokenStore.clear(server);
    this.setState({ status: 'signedOut', server });
    if (refreshToken) {
      await this.revoke(refreshToken).catch((error: unknown) => console.warn('Token revocation failed', describeError(error)));
    }
  }

  /** Re-applies the "remember me" setting to the current session. */
  async applyRememberMe(): Promise<void> {
    await this.persistRefreshToken(this.settings.get().server);
  }

  async getAccessToken(): Promise<AccessToken> {
    if (this.accessToken && this.accessToken.expiresAt - TOKEN_EXPIRY_MARGIN_MS > Date.now()) {
      return this.accessToken;
    }
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refreshAccessToken().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  invalidateAccessToken(): void {
    this.accessToken = null;
  }

  /** Called when the API keeps rejecting a freshly refreshed token. */
  async expireSession(): Promise<void> {
    const server = this.settings.get().server;
    this.resetTokens();
    await this.tokenStore.clear(server);
    this.setState({ status: 'signedOut', server, error: t('main.auth.sessionExpired') });
  }

  private beginFlow(): AbortSignal {
    this.loginAbort?.abort();
    this.loginAbort = new AbortController();
    return this.loginAbort.signal;
  }

  private async runLogin(server: ServerId, signal: AbortSignal): Promise<void> {
    await this.settings.setServer(server);
    if (await this.tryStoredSession(server, signal)) {
      return;
    }
    await this.runDeviceFlow(server, signal);
  }

  /** Returns false when there is no usable stored session and an interactive login is required. */
  private async tryStoredSession(server: ServerId, signal: AbortSignal): Promise<boolean> {
    this.resetTokens();
    const stored = await this.tokenStore.load(server);
    if (!stored) {
      this.setState({ status: 'signedOut', server });
      return false;
    }
    this.refreshToken = stored;
    this.setState({ status: 'restoring', server });
    try {
      await this.getAccessToken();
    } catch (error) {
      if (error instanceof InvalidGrantError) {
        this.resetTokens();
        await this.tokenStore.clear(server);
        this.setState({ status: 'signedOut', server });
        return false;
      }
      throw error;
    }
    const user = await this.fetchUser();
    signal.throwIfAborted();
    this.setState({ status: 'signedIn', server, user });
    return true;
  }

  private async runDeviceFlow(server: ServerId, signal: AbortSignal): Promise<void> {
    const profile = getServerProfile(server);
    const response = await this.postForm(
      `${profile.oauthBaseUrl}/oauth2/device/auth`,
      { client_id: profile.oauthClientId, scope: profile.oauthScopes },
      signal,
    );
    if (!response.ok) {
      throw new Error(t('main.auth.serverStatus', { status: response.status }));
    }
    const deviceCode = parseDeviceCode(await response.json());
    const deadline = Date.now() + deviceCode.expiresIn * 1000;
    this.setState({
      status: 'awaitingApproval',
      server,
      userCode: deviceCode.userCode,
      verificationUri: deviceCode.verificationUri,
      expiresAt: deadline,
    });
    await this.openVerificationPage(profile, deviceCode.verificationUri);

    let intervalSeconds = deviceCode.interval;
    for (;;) {
      await delay(intervalSeconds * 1000, undefined, { signal });
      if (Date.now() > deadline) {
        throw new Error(t('main.auth.codeExpired'));
      }
      let tokenResponse: Response;
      try {
        tokenResponse = await this.postForm(
          `${profile.oauthBaseUrl}/oauth2/token`,
          { grant_type: DEVICE_GRANT_TYPE, device_code: deviceCode.deviceCode, client_id: profile.oauthClientId },
          signal,
        );
      } catch (error) {
        // A network hiccup while the user is still confirming in the browser must not end the login.
        if (!signal.aborted && isTransientError(error)) {
          console.warn('Login polling failed, trying again', describeError(error));
          continue;
        }
        throw error;
      }
      if (RETRYABLE_STATUSES.has(tokenResponse.status)) {
        await tokenResponse.body?.cancel();
        continue;
      }
      const body = readObject(await tokenResponse.json().catch(() => null));
      if (tokenResponse.ok) {
        this.acceptTokenResponse(body);
        break;
      }
      switch (body.error) {
        case 'authorization_pending':
          continue;
        case 'slow_down':
          intervalSeconds += 5;
          continue;
        case 'access_denied':
          throw new Error(t('main.auth.denied'));
        case 'expired_token':
          throw new Error(t('main.auth.codeExpired'));
        default:
          throw new Error(
            typeof body.error_description === 'string'
              ? body.error_description
              : t('main.auth.failedStatus', { status: tokenResponse.status }),
          );
      }
    }

    await this.persistRefreshToken(server);
    const user = await this.fetchUser();
    signal.throwIfAborted();
    this.setState({ status: 'signedIn', server, user });
  }

  private async openVerificationPage(profile: ServerProfile, uri: string): Promise<void> {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'https:' || parsed.hostname !== new URL(profile.oauthBaseUrl).hostname) {
      throw new Error(t('main.auth.untrustedLink'));
    }
    await shell.openExternal(parsed.toString());
  }

  private async refreshAccessToken(): Promise<AccessToken> {
    const refreshToken = this.refreshToken;
    if (!refreshToken) {
      throw new NotSignedInError();
    }
    const profile = this.getServer();
    const generation = this.tokenGeneration;
    const response = await this.postForm(`${profile.oauthBaseUrl}/oauth2/token`, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: profile.oauthClientId,
    });
    const body = readObject(await response.json().catch(() => null));
    if (generation !== this.tokenGeneration) {
      throw new NotSignedInError();
    }
    if (!response.ok) {
      if (body.error === 'invalid_grant' || response.status === 401) {
        throw new InvalidGrantError(t('main.auth.sessionExpired'));
      }
      const message = t('main.auth.serverStatus', { status: response.status });
      if (RETRYABLE_STATUSES.has(response.status)) {
        throw new RetryableStatusError(message, response.status, response.headers.get('retry-after'));
      }
      throw new Error(message);
    }
    const token = this.acceptTokenResponse(body);
    // Hydra rotates refresh tokens, so the stored one has to be replaced after every refresh.
    await this.persistRefreshToken(profile.id);
    return token;
  }

  private acceptTokenResponse(body: Record<string, unknown>): AccessToken {
    if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
      throw new Error(t('main.auth.invalidToken'));
    }
    if (typeof body.refresh_token === 'string') {
      this.refreshToken = body.refresh_token;
    }
    this.accessToken = {
      value: body.access_token,
      hmac: extractHmac(body.access_token),
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    return this.accessToken;
  }

  private async persistRefreshToken(server: ServerId): Promise<void> {
    if (this.refreshToken && this.settings.get().rememberMe) {
      await this.tokenStore.save(server, this.refreshToken);
    } else {
      await this.tokenStore.clear(server);
    }
  }

  private async fetchUser(): Promise<UserInfo> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token.value}`,
      Accept: 'application/vnd.api+json',
      'User-Agent': this.userAgent,
    };
    if (token.hmac) {
      headers['X-HMAC'] = token.hmac;
    }
    try {
      const response = await fetchWithTimeout(`${this.getServer().apiBaseUrl}/me`, { headers }, REQUEST_TIMEOUT_MS);
      if (response.ok) {
        const attributes = readObject(readObject(readObject(await response.json()).data).attributes);
        if (typeof attributes.userId === 'number' && typeof attributes.userName === 'string') {
          return { id: attributes.userId, login: attributes.userName };
        }
      }
      console.warn(`/me responded with ${response.status}`);
    } catch (error) {
      console.warn('Could not load the user profile', describeError(error));
    }
    const subject = Number(decodeJwtPayload(token.value)?.sub);
    if (!Number.isInteger(subject)) {
      throw new Error(t('main.auth.unknownUser'));
    }
    return { id: subject, login: `#${subject}` };
  }

  private async revoke(refreshToken: string): Promise<void> {
    const profile = this.getServer();
    await this.postForm(`${profile.oauthBaseUrl}/oauth2/revoke`, {
      token: refreshToken,
      token_type_hint: 'refresh_token',
      client_id: profile.oauthClientId,
    });
  }

  private postForm(url: string, form: Record<string, string>, signal?: AbortSignal): Promise<Response> {
    return fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': this.userAgent,
        },
        body: new URLSearchParams(form),
        signal,
      },
      REQUEST_TIMEOUT_MS,
    );
  }

  private resetTokens(): void {
    this.tokenGeneration++;
    this.accessToken = null;
    this.refreshToken = null;
  }

  private setState(state: AuthState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
