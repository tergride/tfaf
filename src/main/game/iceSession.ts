// The ICE session of a game (`/ice/session/game/{id}`): whether to relay only, and the TURN servers to use.

import type { TurnServer } from '../../shared/contract.ts';
import { asObject, asString } from '../api/jsonApi.ts';
import type { IceServerConfig } from './iceAdapter.ts';

function serverId(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

/**
 * The session's TURN servers, narrowed to the user's preferred ones; when none of them is in the session, all stay,
 * as the official client's CoturnService does.
 */
export function parseIceSession(value: unknown, preferredIds: readonly string[]): { forceRelay: boolean; servers: IceServerConfig[] } {
  const raw = asObject(value);
  const servers = (Array.isArray(raw?.servers) ? raw.servers : []).flatMap((entry): (IceServerConfig & { id: string | null })[] => {
    const server = asObject(entry);
    const urls = (Array.isArray(server?.urls) ? server.urls : []).filter((url): url is string => typeof url === 'string');
    if (urls.length === 0) {
      return [];
    }
    const id = serverId(server?.id);
    return [{ id, urls, username: asString(server?.username) ?? undefined, credential: asString(server?.credential) ?? undefined }];
  });
  const preferred = servers.filter((server) => server.id !== null && preferredIds.includes(server.id));
  return {
    forceRelay: raw?.forceRelay === true,
    servers: (preferred.length > 0 ? preferred : servers).map(({ urls, username, credential }) => ({ urls, username, credential })),
  };
}

/** `/ice/server`: `{"servers": [{"id", "region"}]}`. */
export function parseTurnServers(value: unknown): TurnServer[] {
  const servers = asObject(value)?.servers;
  return (Array.isArray(servers) ? servers : []).flatMap((entry) => {
    const server = asObject(entry);
    const id = serverId(server?.id);
    return id ?[{ id, region: asString(server?.region) ?? id }] : [];
  });
}
