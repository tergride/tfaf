// Traffic of one peer connection, written to the adapter log as a summary line once a minute.

interface Counter {
  packets: number;
  bytes: number;
}

function percent(permille: number | null): string {
  return permille === null ? '?' : `${(permille / 10).toFixed(1)}%`;
}

function kilobytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export class PeerStats {
  private readonly startedAt: number;
  private readonly sent: Counter = { packets: 0, bytes: 0 };
  private readonly received: Counter = { packets: 0, bytes: 0 };
  private duplicated = 0;
  private duplicatesDropped = 0;
  private rtt: { min: number; max: number; sum: number; count: number } | null = null;

  constructor(now = Date.now()) {
    this.startedAt = now;
  }

  get isEmpty(): boolean {
    return this.sent.packets === 0 && this.received.packets === 0 && this.rtt === null;
  }

  gameSent(bytes: number, duplicated: boolean): void {
    this.sent.packets++;
    this.sent.bytes += bytes;
    if (duplicated) {
      this.duplicated++;
    }
  }

  gameReceived(bytes: number): void {
    this.received.packets++;
    this.received.bytes += bytes;
  }

  duplicateDropped(): void {
    this.duplicatesDropped++;
  }

  roundTrip(ms: number): void {
    this.rtt = this.rtt
      ? { min: Math.min(this.rtt.min, ms), max: Math.max(this.rtt.max, ms), sum: this.rtt.sum + ms, count: this.rtt.count + 1 }
      : { min: ms, max: ms, sum: ms, count: 1 };
  }

  /**
   * Loss is in permille over the last 20 seconds: outgoing as reported by the peer, incoming as measured here; null
   * when the peer does not run the TFAF adapter.
   */
  summary(now: number, lossOutPermille: number | null, lossInPermille: number | null): string {
    const rtt = this.rtt
      ? `${Math.round(this.rtt.sum / this.rtt.count)} ms (${Math.round(this.rtt.min)}-${Math.round(this.rtt.max)})`
      : '?';
    const parts = [
      `${Math.round((now - this.startedAt) / 1000)} s`,
      `rtt ${rtt}`,
      `loss out ${percent(lossOutPermille)} in ${percent(lossInPermille)}`,
      `game packets out ${this.sent.packets} (${kilobytes(this.sent.bytes)}) in ${this.received.packets} (${kilobytes(this.received.bytes)})`,
    ];
    if (this.duplicated > 0 || this.duplicatesDropped > 0) {
      parts.push(`sent twice ${this.duplicated}, duplicates dropped ${this.duplicatesDropped}`);
    }
    return parts.join(', ');
  }
}
