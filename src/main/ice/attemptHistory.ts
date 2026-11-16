// What earlier connection attempts to one player tell about the next one: which candidates to offer and how long to
// wait before trying again.
//
// The Java adapter, and this one before, dropped host candidates after any exchange within two minutes and offered
// only relays after two, successful connections included. A short outage soon after connecting then pushed players
// onto a relay for the rest of the game, or left two players whose only path was their local network without one.
// Now every type is offered unless the server demands relays, or a direct path keeps connecting and breaking.

import { ALL_CANDIDATES, type CandidatePolicy } from './candidates.ts';
import type { IceTimings } from './iceTimings.ts';

export const RELAY_ONLY: CandidatePolicy = { host: false, reflexive: false, relay: true };

export type Route = 'direct' | 'relay';

type HistoryTimings = Pick<
  IceTimings,
  'attemptWindowMs' | 'shortConnectionMs' | 'retryDelayMs' | 'slowRetryAfterMs' | 'slowRetryDelayMs'
>;

// Two direct connections that broke soon after they came up mean the direct path is not to be trusted for now.
const FLAPPING_CONNECTIONS = 2;

export class AttemptHistory {
  private readonly timings: HistoryTimings;
  private shortDirect: number[] = [];
  private failingSince: number | null = null;

  constructor(timings: HistoryTimings) {
    this.timings = timings;
  }

  connected(): void {
    this.failingSince = null;
  }

  /** A connection that was up ended. */
  lost(route: Route, connectedAt: number, now: number): void {
    if (route === 'direct' && now - connectedAt < this.timings.shortConnectionMs) {
      this.shortDirect.push(now);
    }
    this.trim(now);
  }

  /** An attempt ended without a connection. */
  failed(now: number): void {
    this.failingSince ??= now;
  }

  /** Our candidates for the next attempt. */
  policy(forceRelay: boolean, now: number): CandidatePolicy {
    this.trim(now);
    return forceRelay || this.shortDirect.length >= FLAPPING_CONNECTIONS ? RELAY_ONLY : ALL_CANDIDATES;
  }

  /** The peer's candidates we accept: our history says nothing about its paths, only the server's demand does. */
  remotePolicy(forceRelay: boolean): CandidatePolicy {
    return forceRelay ? RELAY_ONLY : ALL_CANDIDATES;
  }

  /** A lost connection is retried at once, a failed attempt after a pause that grows once the player stays away. */
  retryDelay(afterConnection: boolean, now: number): number {
    if (afterConnection) {
      return 0;
    }
    return this.isSlow(now) ? this.timings.slowRetryDelayMs : this.timings.retryDelayMs;
  }

  isSlow(now: number): boolean {
    return this.failingSince !== null && now - this.failingSince >= this.timings.slowRetryAfterMs;
  }

  private trim(now: number): void {
    this.shortDirect = this.shortDirect.filter((time) => time > now - this.timings.attemptWindowMs);
  }
}
