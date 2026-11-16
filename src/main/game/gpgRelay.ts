import type { IceAdapter } from './iceAdapter.ts';

function text(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' ? String(value) : '';
}

function playerId(value: unknown): number | null {
  const id = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(id) ? id : null;
}

/**
 * Forwards a lobby server command addressed to the game to the ICE adapter, like the subscriptions in IceAdapterImpl of
 * the official client. Returns false for commands the adapter does not handle.
 */
export function relayLobbyCommand(adapter: IceAdapter, command: string, args: unknown[]): boolean {
  switch (command) {
    case 'HostGame':
      adapter.hostGame(text(args[0]));
      return true;
    case 'JoinGame': {
      const id = playerId(args[1]);
      if (id !== null) {
        adapter.joinGame(text(args[0]), id);
      }
      return id !== null;
    }
    case 'ConnectToPeer': {
      const id = playerId(args[1]);
      if (id !== null) {
        adapter.connectToPeer(text(args[0]), id, args[2] === true);
      }
      return id !== null;
    }
    case 'DisconnectFromPeer': {
      const id = playerId(args[0]);
      if (id !== null) {
        adapter.disconnectFromPeer(id);
      }
      return id !== null;
    }
    case 'IceMsg': {
      const id = playerId(args[0]);
      if (id !== null) {
        adapter.iceMessage(id, args[1]);
      }
      return id !== null;
    }
    default:
      return false;
  }
}
