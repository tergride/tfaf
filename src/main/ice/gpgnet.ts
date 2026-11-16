// GPGNet: the binary protocol Forged Alliance speaks with its network adapter over TCP. A message is a header string and
// up to 10 typed arguments; numbers are little-endian int32, strings are prefixed with their byte length.

import net from 'node:net';

export type GpgNetArg = string | number;

export interface GpgNetMessage {
  header: string;
  args: GpgNetArg[];
}

const FIELD_INT = 0;
const FIELD_STRING = 1;
const MAX_ARGS = 10;
const MAX_STRING_BYTES = 16 * 1024 * 1024;

export class GpgNetProtocolError extends Error {}

function stringBytes(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeInt32LE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

export function encodeGpgNetMessage(header: string, args: readonly GpgNetArg[]): Buffer {
  const parts = [stringBytes(header), Buffer.alloc(4)];
  parts[1]!.writeInt32LE(args.length, 0);
  for (const arg of args) {
    if (typeof arg === 'number') {
      const field = Buffer.alloc(5);
      field.writeUInt8(FIELD_INT, 0);
      field.writeInt32LE(Math.trunc(arg) | 0, 1);
      parts.push(field);
    } else {
      parts.push(Buffer.from([FIELD_STRING]), stringBytes(arg));
    }
  }
  return Buffer.concat(parts);
}

class Reader {
  private readonly data: Buffer;
  offset = 0;

  constructor(data: Buffer) {
    this.data = data;
  }

  int(): number | null {
    if (this.offset + 4 > this.data.length) {
      return null;
    }
    const value = this.data.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  byte(): number | null {
    if (this.offset + 1 > this.data.length) {
      return null;
    }
    return this.data[this.offset++]!;
  }

  string(): string | null {
    const length = this.int();
    if (length === null) {
      return null;
    }
    if (length < 0 || length > MAX_STRING_BYTES) {
      throw new GpgNetProtocolError(`Invalid string length ${length}`);
    }
    if (this.offset + length > this.data.length) {
      return null;
    }
    const value = this.data.toString('utf8', this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
}

/** Splits the TCP stream from the game into messages. */
export class GpgNetDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): GpgNetMessage[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const messages: GpgNetMessage[] = [];
    for (;;) {
      const reader = new Reader(this.buffer);
      const message = readMessage(reader);
      if (!message) {
        return messages;
      }
      messages.push(message);
      this.buffer = this.buffer.subarray(reader.offset);
    }
  }
}

function readMessage(reader: Reader): GpgNetMessage | null {
  const header = reader.string();
  const count = header === null ? null : reader.int();
  if (header === null || count === null) {
    return null;
  }
  if (count < 0 || count > MAX_ARGS) {
    throw new GpgNetProtocolError(`Too many arguments: ${count}`);
  }
  const args: GpgNetArg[] = [];
  for (let index = 0; index < count; index++) {
    const type = reader.byte();
    if (type === null) {
      return null;
    }
    const value = type === FIELD_INT ? reader.int() : reader.string();
    if (value === null) {
      return null;
    }
    // The game escapes tabs and newlines in strings.
    args.push(typeof value === 'string' ? value.replaceAll('/t', '\t').replaceAll('/n', '\n') : value);
  }
  return { header, args };
}

export interface GpgNetServerEvents {
  onConnected(): void;
  onMessage(message: GpgNetMessage): void;
  onDisconnected(reason: string): void;
}

/** Local TCP server the game connects to (`/gpgnet 127.0.0.1:<port>`). Only one game connection is active. */
export class GpgNetServer {
  readonly port: number;
  private readonly server: net.Server;
  private client: net.Socket | null = null;

  private constructor(server: net.Server, port: number) {
    this.server = server;
    this.port = port;
  }

  static async listen(events: GpgNetServerEvents): Promise<GpgNetServer> {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('GPGNet server has no port');
    }
    const instance = new GpgNetServer(server, address.port);
    server.on('connection', (socket) => instance.accept(socket, events));
    return instance;
  }

  get connected(): boolean {
    return this.client !== null;
  }

  send(header: string, args: readonly GpgNetArg[]): boolean {
    if (!this.client) {
      return false;
    }
    this.client.write(encodeGpgNetMessage(header, args));
    return true;
  }

  close(): void {
    this.client?.destroy();
    this.client = null;
    this.server.close();
  }

  private accept(socket: net.Socket, events: GpgNetServerEvents): void {
    if (this.client) {
      this.client.destroy();
    }
    this.client = socket;
    socket.setNoDelay(true);
    const decoder = new GpgNetDecoder();
    let finished = false;
    const finish = (reason: string): void => {
      if (finished) {
        return;
      }
      finished = true;
      socket.destroy();
      if (this.client === socket) {
        this.client = null;
        events.onDisconnected(reason);
      }
    };
    socket.on('data', (chunk: Buffer) => {
      let messages: GpgNetMessage[];
      try {
        messages = decoder.push(chunk);
      } catch (error) {
        finish(`invalid GPGNet data: ${String(error)}`);
        return;
      }
      for (const message of messages) {
        if (this.client === socket) {
          events.onMessage(message);
        }
      }
    });
    socket.on('close', () => finish('connection closed'));
    socket.on('error', (error) => finish(error.message));
    events.onConnected();
  }
}
