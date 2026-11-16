// Text messages over the datagrams of a player's connection: split into parts small enough for one packet, each part
// confirmed and sent again until it is. A newer message of the same kind replaces one still on its way, since lobby
// messages carry the whole state. The order of delivery is not kept: every message says on its own what it is worth.

export const MAX_FRAGMENT_BYTES = 1000;
const RESEND_INTERVAL_MS = 300;
// A connection that broke comes back within this time, or the player is gone for the lobby as well.
const GIVE_UP_AFTER_MS = 20_000;
const REMEMBERED_MESSAGES = 256;
const MAX_FRAGMENTS = 256;

export interface DataFrame {
  id: number;
  index: number;
  total: number;
  payload: Buffer;
}

export interface MessageTransport {
  sendData(frame: DataFrame): void;
  sendAck(id: number, index: number): void;
  onMessage(text: string): void;
  log?(message: string): void;
}

interface Outgoing {
  frames: DataFrame[];
  pending: Set<number>;
  key: string | null;
  deadline: number;
}

interface Incoming {
  parts: (Buffer | undefined)[];
  missing: number;
  startedAt: number;
}

function splitMessage(id: number, text: string): DataFrame[] {
  const bytes = Buffer.from(text, 'utf8');
  const total = Math.max(1, Math.ceil(bytes.length / MAX_FRAGMENT_BYTES));
  return Array.from({ length: total }, (_, index) => ({
    id,
    index,
    total,
    payload: bytes.subarray(index * MAX_FRAGMENT_BYTES, (index + 1) * MAX_FRAGMENT_BYTES),
  }));
}

export class ReliableMessages {
  private readonly transport: MessageTransport;
  private readonly outgoing = new Map<number, Outgoing>();
  private readonly incoming = new Map<number, Incoming>();
  private readonly delivered = new Set<number>();
  private readonly deliveredOrder: number[] = [];
  private nextId = 1;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(transport: MessageTransport) {
    this.transport = transport;
  }

  /** `key`: messages with the same key replace each other; false when the text is too long to send. */
  send(text: string, key: string | null = null): boolean {
    const id = this.nextId++;
    const frames = splitMessage(id, text);
    if (this.closed || frames.length > MAX_FRAGMENTS) {
      return false;
    }
    if (key !== null) {
      for (const [otherId, other] of this.outgoing) {
        if (other.key === key) {
          this.outgoing.delete(otherId);
        }
      }
    }
    this.outgoing.set(id, { frames, pending: new Set(frames.map((frame) => frame.index)), key, deadline: Date.now() + GIVE_UP_AFTER_MS });
    for (const frame of frames) {
      this.transport.sendData(frame);
    }
    this.schedule();
    return true;
  }

  onData(frame: DataFrame): void {
    if (this.closed) {
      return;
    }
    this.transport.sendAck(frame.id, frame.index);
    if (this.delivered.has(frame.id) || frame.total < 1 || frame.total > MAX_FRAGMENTS || frame.index >= frame.total) {
      return;
    }
    let message = this.incoming.get(frame.id);
    if (!message) {
      message = { parts: new Array<Buffer | undefined>(frame.total).fill(undefined), missing: frame.total, startedAt: Date.now() };
      this.incoming.set(frame.id, message);
    }
    if (message.parts.length !== frame.total || message.parts[frame.index]) {
      return;
    }
    message.parts[frame.index] = Buffer.from(frame.payload);
    message.missing--;
    if (message.missing === 0) {
      this.incoming.delete(frame.id);
      this.remember(frame.id);
      this.transport.onMessage(Buffer.concat(message.parts as Buffer[]).toString('utf8'));
    }
  }

  onAck(id: number, index: number): void {
    const message = this.outgoing.get(id);
    if (message?.pending.delete(index) && message.pending.size === 0) {
      this.outgoing.delete(id);
    }
  }

  close(): void {
    this.closed = true;
    this.outgoing.clear();
    this.incoming.clear();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private remember(id: number): void {
    this.delivered.add(id);
    this.deliveredOrder.push(id);
    if (this.deliveredOrder.length > REMEMBERED_MESSAGES) {
      this.delivered.delete(this.deliveredOrder.shift()!);
    }
  }

  private schedule(): void {
    if (!this.timer && !this.closed) {
      this.timer = setTimeout(() => this.resend(), RESEND_INTERVAL_MS);
    }
  }

  private resend(): void {
    this.timer = null;
    const now = Date.now();
    for (const [id, message] of this.outgoing) {
      if (now >= message.deadline) {
        this.outgoing.delete(id);
        this.transport.log?.(`a lobby message was not confirmed, ${message.pending.size} of ${message.frames.length} parts missing`);
        continue;
      }
      for (const frame of message.frames) {
        if (message.pending.has(frame.index)) {
          this.transport.sendData(frame);
        }
      }
    }
    for (const [id, message] of this.incoming) {
      if (now - message.startedAt >= GIVE_UP_AFTER_MS) {
        this.incoming.delete(id);
      }
    }
    if (this.outgoing.size > 0 || this.incoming.size > 0) {
      this.schedule();
    }
  }
}
