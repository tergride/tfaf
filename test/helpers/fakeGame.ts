// Plays the part of ForgedAlliance.exe towards a network adapter: connects over GPGNet, opens its lobby port and
// enters the lobby, then hands out the commands the adapter sends it.

import dgram from 'node:dgram';
import net from 'node:net';
import { encodeGpgNetMessage, type GpgNetArg, GpgNetDecoder, type GpgNetMessage } from '../../src/main/ice/gpgnet.ts';

const LOOPBACK = '127.0.0.1';

export interface FakeGame {
  lobby: dgram.Socket;
  next(header: string): Promise<GpgNetMessage>;
  close(): void;
}

function waitFor<T>(register: (resolve: (value: T) => void) => void, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), timeoutMs);
    register((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

/** An adapter that is still starting (the Java one takes seconds) refuses the connection at first, so it is retried. */
async function connectGpgNet(gpgPort: number, timeoutMs: number): Promise<net.Socket> {
  const startedAt = Date.now();
  for (;;) {
    const socket = net.connect(gpgPort, LOOPBACK);
    const connected = await new Promise<boolean>((resolve) => {
      socket.once('connect', () => resolve(true));
      socket.once('error', () => resolve(false));
    });
    if (connected) {
      return socket;
    }
    socket.destroy();
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`GPGNet port ${gpgPort} refused the connection`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * `settleMs`: the Java adapter registers a new game connection only after it started reading from it, and a state sent
 * in between kills its reader thread; the real game takes longer than that to report its first state.
 */
export async function launchFakeGame(gpgPort: number, timeoutMs = 5000, settleMs = 0): Promise<FakeGame> {
  const socket = await connectGpgNet(gpgPort, timeoutMs);
  if (settleMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }
  const decoder = new GpgNetDecoder();
  const messages: GpgNetMessage[] = [];
  let waiter: { header: string; resolve: (message: GpgNetMessage) => void } | null = null;
  socket.on('data', (chunk: Buffer) => {
    messages.push(...decoder.push(chunk));
    if (waiter) {
      const index = messages.findIndex((message) => message.header === waiter!.header);
      if (index !== -1) {
        const [message] = messages.splice(index, 1);
        const { resolve } = waiter;
        waiter = null;
        resolve(message!);
      }
    }
  });
  socket.on('error', () => {});
  const next = (header: string): Promise<GpgNetMessage> => {
    const index = messages.findIndex((message) => message.header === header);
    if (index !== -1) {
      return Promise.resolve(messages.splice(index, 1)[0]!);
    }
    return waitFor((resolve) => {
      waiter = { header, resolve };
    }, timeoutMs);
  };
  const send = (header: string, args: GpgNetArg[]): void => {
    socket.write(encodeGpgNetMessage(header, args));
  };

  send('GameState', ['Idle']);
  const createLobby = await next('CreateLobby');
  const lobby = dgram.createSocket('udp4');
  await new Promise<void>((resolve) => lobby.bind(Number(createLobby.args[1]), LOOPBACK, () => resolve()));
  send('GameState', ['Lobby']);
  return {
    lobby,
    next,
    close: () => {
      socket.destroy();
      lobby.close();
    },
  };
}

export function receiveOn(socket: dgram.Socket, timeoutMs = 5000): Promise<{ data: string; port: number }> {
  return waitFor((resolve) => socket.once('message', (data, info) => resolve({ data: data.toString(), port: info.port })), timeoutMs);
}
