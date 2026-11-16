// Picks the path game traffic to one TFAF peer takes among the pairs the ICE agent keeps checked. Each side picks its
// own sending path; data is accepted on every checked pair, so the sides do not have to agree.

import type { PathInfo } from './iceAgent.ts';
import type { IceTimings } from './iceTimings.ts';

type SelectorTimings = Pick<IceTimings, 'pathSilenceMs' | 'pathAliveMs' | 'pathSwitchHoldMs'>;

// Loss stalls the game while it waits for the packet again, so a percent of loss weighs like 15 ms of round trip.
const LOSS_WEIGHT_MS = 15;
// A better path has to win by this much: 10 ms or 15% of the current score, whichever is more.
const MIN_GAIN_MS = 10;
const MIN_GAIN_RATIO = 0.15;
// On a tie a direct path beats a relay.
const RELAY_PENALTY_MS = 0.5;

export interface PathChoice {
  id: string;
  reason: string;
}

export function pathScore(path: PathInfo): number {
  return (path.rttMs ?? Number.POSITIVE_INFINITY) + LOSS_WEIGHT_MS * path.lossPercent + (path.relay ? RELAY_PENALTY_MS : 0);
}

export class PathSelector {
  private readonly timings: SelectorTimings;
  private candidate: { id: string; since: number } | null = null;

  constructor(timings: SelectorTimings) {
    this.timings = timings;
  }

  /** The path to move to, or null to stay. */
  choose(paths: PathInfo[], activeId: string | null, now: number): PathChoice | null {
    const active = paths.find((path) => path.id === activeId);
    const activeSilent = !active || active.lastResponseAt === null || now - active.lastResponseAt > this.timings.pathSilenceMs;
    // A silent current path may still count as live by the longer limit; it is no choice then.
    const alive = paths.filter(
      (path) =>
        path.lastResponseAt !== null &&
        now - path.lastResponseAt <= this.timings.pathAliveMs &&
        !(activeSilent && path.id === activeId),
    );
    const best = [...alive].sort((a, b) => pathScore(a) - pathScore(b))[0];
    if (!best || best.id === activeId) {
      this.candidate = null;
      return null;
    }
    if (activeSilent || !active) {
      this.candidate = null;
      return { id: best.id, reason: active ? 'the current path stopped answering' : 'the current path is gone' };
    }
    const activeScore = pathScore(active);
    const gain = activeScore - pathScore(best);
    if (!(gain > Math.max(MIN_GAIN_MS, MIN_GAIN_RATIO * activeScore))) {
      this.candidate = null;
      return null;
    }
    if (this.candidate?.id !== best.id) {
      this.candidate = { id: best.id, since: now };
      return null;
    }
    if (now - this.candidate.since < this.timings.pathSwitchHoldMs) {
      return null;
    }
    this.candidate = null;
    return { id: best.id, reason: describeGain(active, best) };
  }
}

function describeGain(from: PathInfo, to: PathInfo): string {
  const figures = (path: PathInfo): string => `${path.rttMs === null ? '?' : Math.round(path.rttMs)} ms, loss ${path.lossPercent.toFixed(0)}%`;
  return `better: ${figures(to)} instead of ${figures(from)}`;
}
