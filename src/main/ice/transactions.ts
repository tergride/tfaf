import type { Address, DecodedStunMessage } from './stun.ts';

export interface StunResponse {
  message: DecodedStunMessage;
  from: Address;
}

export interface Retransmission {
  initialRtoMs: number;
  maxRtoMs: number;
  attempts: number;
}

interface Pending {
  resolve(response: StunResponse): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout | null;
}

/**
 * Outstanding STUN requests of one agent. Responses are matched by transaction id only, because they may arrive
 * directly on a host socket or wrapped by a TURN server.
 */
export class StunTransactions {
  private readonly pending = new Map<string, Pending>();

  request(transactionId: Buffer, transmit: () => void, retransmission: Retransmission): Promise<StunResponse> {
    const key = transactionId.toString('hex');
    return new Promise((resolve, reject) => {
      const entry: Pending = { resolve, reject, timer: null };
      this.pending.set(key, entry);
      let attempt = 0;
      let rto = retransmission.initialRtoMs;
      const send = (): void => {
        attempt++;
        try {
          transmit();
        } catch {
          // A failed send is handled like a lost packet.
        }
        entry.timer = setTimeout(() => {
          if (attempt >= retransmission.attempts) {
            this.pending.delete(key);
            reject(new Error('STUN transaction timed out'));
            return;
          }
          rto = Math.min(rto * 2, retransmission.maxRtoMs);
          send();
        }, rto);
      };
      send();
    });
  }

  /** Completes the request the response belongs to; returns false for unknown transactions. */
  resolve(message: DecodedStunMessage, from: Address): boolean {
    const key = message.transactionId.toString('hex');
    const entry = this.pending.get(key);
    if (!entry) {
      return false;
    }
    this.pending.delete(key);
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.resolve({ message, from });
    return true;
  }

  cancelAll(): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
      entry.reject(new Error('STUN transaction cancelled'));
    }
  }
}
