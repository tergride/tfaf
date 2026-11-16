import type { GamePeer } from '../../shared/contract.ts';

const FLUSH_MS = 2_000;

function sameConnection(a: GamePeer, b: GamePeer): boolean {
  return a.state === b.state && a.route === b.route && a.tfaf === b.tfaf && a.duplication === b.duplication;
}

/**
 * Round trips and loss of the players. Every connection reports them on its own every 2 seconds, and each report would
 * send out the whole game state, so they wait here and go together; a change of the connection itself goes at once.
 */
export class PeerNumbers {
  private readonly flush: (numbers: ReadonlyMap<number, GamePeer>) => void;
  private readonly pending = new Map<number, GamePeer>();
  private timer: NodeJS.Timeout | null = null;

  constructor(flush: (numbers: ReadonlyMap<number, GamePeer>) => void) {
    this.flush = flush;
  }

  /** Keeps a report that changes only the numbers of `known`; false leaves it to the caller. */
  hold(known: GamePeer | undefined, status: GamePeer): boolean {
    if (!known || !sameConnection(known, status)) {
      this.pending.delete(status.playerId);
      return false;
    }
    this.pending.set(status.playerId, status);
    this.timer ??= setTimeout(() => {
      this.timer = null;
      const numbers = new Map(this.pending);
      this.pending.clear();
      this.flush(numbers);
    }, FLUSH_MS);
    return true;
  }

  forget(playerId: number): void {
    this.pending.delete(playerId);
  }

  clear(): void {
    this.pending.clear();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
