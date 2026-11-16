// Frames of Discord's local IPC (the protocol of discord-rpc): an int32 opcode and an int32 length, both little
// endian, then that many bytes of JSON.

export const DISCORD_OPCODES = {
  handshake: 0,
  frame: 1,
  close: 2,
  ping: 3,
  pong: 4,
} as const;

export interface DiscordFrame {
  op: number;
  payload: unknown;
}

const HEADER_SIZE = 8;
// Discord's own frames are a few kilobytes; anything far larger is not a frame of this protocol.
const MAX_PAYLOAD_SIZE = 1024 * 1024;

export class DiscordFrameError extends Error {}

export function encodeFrame(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** Collects the bytes of the pipe and returns the frames that are complete. */
export class FrameDecoder {
  private pending: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): DiscordFrame[] {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    const frames: DiscordFrame[] = [];
    while (this.pending.length >= HEADER_SIZE) {
      const op = this.pending.readInt32LE(0);
      const length = this.pending.readInt32LE(4);
      if (length < 0 || length > MAX_PAYLOAD_SIZE) {
        throw new DiscordFrameError(`Invalid Discord frame length ${length}`);
      }
      if (this.pending.length < HEADER_SIZE + length) {
        break;
      }
      const body = this.pending.subarray(HEADER_SIZE, HEADER_SIZE + length).toString('utf8');
      this.pending = this.pending.subarray(HEADER_SIZE + length);
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new DiscordFrameError('Discord sent a frame that is not JSON');
      }
      frames.push({ op, payload });
    }
    return frames;
  }
}
