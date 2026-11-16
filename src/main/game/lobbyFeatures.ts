// TFAF features of a lobby game and how launchers tell each other about them. The host's launcher announces the
// features its game uses: to TFAF players before they join, over the chat (tfafPresence.ts), and in the lobby, over the
// adapter (tfafProtocol.ts `launcher`), where every player also announces what its own game was started with. A feature
// names the first TFAF version that has it and whether a player without it can still play, so a launcher that does not
// know a feature of a newer version can still tell its player what is missing.

import { type Locale, LOCALES, type MessageKey, translate } from '../../shared/i18n/index.ts';
import { asObject, asString } from '../api/jsonApi.ts';
import { currentLocale, t } from '../i18n.ts';

export type LobbyFeatureId = 'modIsolation' | 'launcherLobby' | 'roomLaunch';

interface LobbyFeatureSpec {
  /** The first TFAF version with the feature. */
  minVersion: string;
  /** The game does not work without it: a player without it does not join, and the host disconnects such players. */
  required: boolean;
  /** TFAF 0.6.0, which announces no features, always plays this way. */
  legacy: boolean;
  name: MessageKey;
}

export const LOBBY_FEATURES: Readonly<Record<LobbyFeatureId, LobbyFeatureSpec>> = {
  // The game mounts its own mods only (gameVault.ts), so a stray mod folder cannot desync a player.
  modIsolation: { minVersion: '0.7.0', required: false, legacy: true, name: 'main.lobbyFeatures.modIsolation' },
  // The room lives in the launchers, so a game without it has nothing to join.
  launcherLobby: { minVersion: '0.10.0', required: true, legacy: false, name: 'main.lobbyFeatures.launcherLobby' },
  // The games of a room launch the match the host's launcher settled, without the game's lobby (roomLaunchScript.ts).
  roomLaunch: { minVersion: '0.13.0', required: true, legacy: false, name: 'main.lobbyFeatures.roomLaunch' },
};

export interface AnnouncedFeature {
  id: string;
  minVersion: string;
  required: boolean;
  /** For launchers that do not know the feature; empty when it did not fit into the message. */
  names: Partial<Record<Locale, string>>;
}

/** What a launcher's game was started with: its TFAF version and the lobby features in use. */
export interface FeatureAnnouncement {
  version: string;
  features: AnnouncedFeature[];
  /**
   * The host's TFAF lobby asks for a password of the host's. Only the host's launcher knows it, since the server sees a
   * password for every TFAF lobby (lobbyAccess.ts), so it tells it in the answer to a player about to join; unset in
   * any other announcement and from older launchers.
   */
  password?: boolean;
}

const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const FEATURE_ID = /^[a-z][a-zA-Z0-9]{0,31}$/;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const MAX_FEATURES = 8;
const MAX_NAME_LENGTH = 60;

/** The x.y.z part of a launcher version; a version without one counts as the oldest. */
export function releaseVersion(version: string): string {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\d)/.exec(version);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : '0.0.0';
}

export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

export function isKnownFeature(id: string): id is LobbyFeatureId {
  return Object.hasOwn(LOBBY_FEATURES, id);
}

export function announceFeatures(active: readonly LobbyFeatureId[], version: string): FeatureAnnouncement {
  return {
    version: releaseVersion(version),
    features: [...new Set(active)].map((id) => {
      const spec = LOBBY_FEATURES[id];
      const names = Object.fromEntries(LOCALES.map((locale) => [locale, translate(locale, spec.name)]));
      return { id, minVersion: spec.minVersion, required: spec.required, names };
    }),
  };
}

export function hasFeature(announcement: FeatureAnnouncement | null, id: LobbyFeatureId): boolean {
  return announcement?.features.some((feature) => feature.id === id) ?? false;
}

/**
 * Whether this launcher can play a feature another one announced: it knows the feature, and the announcement does not
 * need a later version of it than the one this launcher has.
 */
export function supportsFeature(feature: AnnouncedFeature): boolean {
  return isKnownFeature(feature.id) && compareVersions(feature.minVersion, LOBBY_FEATURES[feature.id].minVersion) <= 0;
}

export function featureName(feature: AnnouncedFeature): string {
  if (isKnownFeature(feature.id)) {
    return t(LOBBY_FEATURES[feature.id].name);
  }
  return feature.names[currentLocale()] ?? feature.names.en ?? feature.id;
}

/** The features as a message lists them; `withVersions` adds the TFAF version each one needs. */
export function describeFeatures(features: readonly AnnouncedFeature[], withVersions: boolean): string {
  return features
    .map((feature) =>
      withVersions
        ? t('main.lobbyFeatures.withVersion', { name: featureName(feature), version: feature.minVersion })
        : t('main.lobbyFeatures.quoted', { name: featureName(feature) }),
    )
    .join(', ');
}

/**
 * The announcement as compact JSON, at most `maxBytes` long: without the names when they do not fit, null when even
 * that is too long.
 */
export function serializeAnnouncement(announcement: FeatureAnnouncement, maxBytes: number): string | null {
  for (const withNames of [true, false]) {
    const text = JSON.stringify({
      v: announcement.version,
      f: announcement.features.map((feature) => ({
        id: feature.id,
        min: feature.minVersion,
        req: feature.required,
        ...(withNames ? feature.names : {}),
      })),
      ...(announcement.password === undefined ? {} : { pw: announcement.password }),
    });
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
      return text;
    }
  }
  return null;
}

/** Null for anything but a well-formed announcement: it comes from another player's launcher. */
export function parseAnnouncement(text: string): FeatureAnnouncement | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const value = asObject(raw);
  const version = asString(value?.v);
  if (!value || !version || !VERSION.test(version) || !Array.isArray(value.f) || value.f.length > MAX_FEATURES) {
    return null;
  }
  const features: AnnouncedFeature[] = [];
  for (const entry of value.f) {
    const feature = parseFeature(entry);
    if (!feature || features.some((other) => other.id === feature.id)) {
      return null;
    }
    features.push(feature);
  }
  return { version, features, ...(typeof value.pw === 'boolean' ? { password: value.pw } : {}) };
}

function parseFeature(entry: unknown): AnnouncedFeature | null {
  const value = asObject(entry);
  const id = asString(value?.id);
  const minVersion = asString(value?.min);
  if (!value || !id || !FEATURE_ID.test(id) || !minVersion || !VERSION.test(minVersion) || typeof value.req !== 'boolean') {
    return null;
  }
  const names: Partial<Record<Locale, string>> = {};
  for (const locale of LOCALES) {
    const name = value[locale];
    if (name === undefined) {
      continue;
    }
    if (typeof name !== 'string' || !name || name.length > MAX_NAME_LENGTH || CONTROL_CHARS.test(name)) {
      return null;
    }
    names[locale] = name;
  }
  return { id, minVersion, required: value.req, names };
}
