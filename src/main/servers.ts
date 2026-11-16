import type { ServerId, ServerInfo } from '../shared/contract.ts';
import type { MessageKey } from '../shared/i18n/index.ts';
import { t } from './i18n.ts';

export interface ServerProfile extends Omit<ServerInfo, 'name'> {
  nameKey: MessageKey;
  apiBaseUrl: string;
  userBaseUrl: string;
  oauthBaseUrl: string;
  contentBaseUrl: string;
  /** The FAF website: news feed. */
  websiteBaseUrl: string;
  /** Downloads of finished games: `<base>/<game id>`. */
  replayBaseUrl: string;
  /**
   * The IRC server over WebSocket, addresses tried in turn. `chat.*` is behind Cloudflare on port 443: the official
   * client takes it from `endpoints[].chat` of content.faforever.com/dfc-config.json. `irc.*:6697`, its built-in
   * default, is the server's own address, which some networks do not reach.
   */
  ircUrls: string[];
  oauthClientId: string;
  oauthScopes: string;
}

// Until the FAF team registers a client id for TFAF, the public client id of the official FAF client is used (see
// src/main/resources/application-*.yml in downlords-faf-client). TFAF_OAUTH_CLIENT_ID replaces it;
// electron.vite.config.ts bakes the value present at build time into the bundle.
const OFFICIAL_CLIENT_ID = '2e8808cf-5889-469b-b2c3-01f0cc58c4af';
const OAUTH_CLIENT_ID = process.env.TFAF_OAUTH_CLIENT_ID || OFFICIAL_CLIENT_ID;
const OAUTH_SCOPES = 'openid offline public_profile upload_map upload_mod lobby';

const PROFILES: Record<ServerId, ServerProfile> = {
  prod: {
    id: 'prod',
    nameKey: 'main.servers.prod',
    apiBaseUrl: 'https://api.faforever.com',
    userBaseUrl: 'https://user.faforever.com',
    oauthBaseUrl: 'https://hydra.faforever.com',
    contentBaseUrl: 'https://content.faforever.com',
    websiteBaseUrl: 'https://www.faforever.com',
    replayBaseUrl: 'https://replay.faforever.com',
    ircUrls: ['wss://chat.faforever.com', 'wss://irc.faforever.com:6697'],
    oauthClientId: OAUTH_CLIENT_ID,
    oauthScopes: OAUTH_SCOPES,
  },
  test: {
    id: 'test',
    nameKey: 'main.servers.test',
    apiBaseUrl: 'https://api.faforever.xyz',
    userBaseUrl: 'https://user.faforever.xyz',
    oauthBaseUrl: 'https://hydra.faforever.xyz',
    contentBaseUrl: 'https://content.faforever.xyz',
    websiteBaseUrl: 'https://www.faforever.xyz',
    replayBaseUrl: 'https://replay.faforever.xyz',
    ircUrls: ['wss://chat.faforever.xyz', 'wss://irc.faforever.xyz:6697'],
    oauthClientId: OAUTH_CLIENT_ID,
    oauthScopes: OAUTH_SCOPES,
  },
};

export function getServerProfile(id: ServerId): ServerProfile {
  return PROFILES[id];
}

export function listServers(): ServerInfo[] {
  return Object.values(PROFILES).map(({ id, nameKey }) => ({ id, name: t(nameKey) }));
}

export function isServerId(value: unknown): value is ServerId {
  return value === 'prod' || value === 'test';
}

const FAF_HOST_SUFFIXES = ['.faforever.com', '.faforever.xyz'];

function isFafUrl(url: string, protocol: 'https:' | 'wss:'): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === protocol && FAF_HOST_SUFFIXES.some((suffix) => parsed.hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

/** Download URLs and external links are only followed when they point to FAF-hosted https resources. */
export function isFafHttpsUrl(url: string): boolean {
  return isFafUrl(url, 'https:');
}

/**
 * Links that pages inside the launcher may open in the system browser: FAF pages, and the unit blueprints on GitHub
 * that the embedded unit databases link to.
 */
export function isOpenableLink(url: string): boolean {
  if (isFafHttpsUrl(url)) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'github.com' || parsed.hostname.endsWith('.github.io'));
  } catch {
    return false;
  }
}

/** The lobby address comes from the user service and must be a FAF-hosted secure WebSocket. */
export function isFafWebSocketUrl(url: string): boolean {
  return isFafUrl(url, 'wss:');
}
