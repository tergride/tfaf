// Timeouts and intervals of the TFAF adapter in one place. Production uses DEFAULT_ICE_TIMINGS; tests pass shorter
// ones, so whole reconnect scenarios run in seconds over a simulated network.

import type { Retransmission } from './transactions.ts';

export interface IceTimings {
  /** Candidate gathering ends after this time at the latest. */
  gatherTimeoutMs: number;
  /** Once a relay and the server reflexive answer are in, other TURN servers get this much longer. */
  turnGraceMs: number;
  /** Same limit as the Java adapter, which gives up on a connection attempt after 15 seconds. */
  checkTimeoutMs: number;
  /** Failed checks end the attempt early only after this time, so checks from the peer can still revive failed pairs. */
  minCheckTimeMs: number;
  /** While only relayed pairs succeeded, the controlling agent waits this long for a direct one before it nominates. */
  nominationWaitMs: number;
  pacingMs: number;
  checkRetransmission: Retransmission;
  stunRetransmission: Retransmission;
  /** Consent checks on the kept pairs while paths are managed (TFAF peers only). */
  consentIntervalMs: number;
  /** Pairs that failed are tried again this often while paths are managed. */
  retryFailedPairsMs: number;
  /** Window of the round trip and loss figures of a path. */
  pathStatsWindowMs: number;
  /** Overrides the TURN refresh interval derived from the allocation lifetime. */
  turnRefreshMs: number | null;

  /** The Java adapter waits 6 seconds, but its own candidate gathering can take longer than that on the first attempt. */
  answerTimeoutMs: number;
  retryDelayMs: number;
  /** Window in which short-lived direct connections make the next attempt relay only. */
  attemptWindowMs: number;
  /** A connection that ends sooner than this counts as a failed attempt. */
  shortConnectionMs: number;
  /** After failing this long, a player is tried less often. */
  slowRetryAfterMs: number;
  slowRetryDelayMs: number;
  helloIntervalMs: number;
  pingIntervalMs: number;
  livenessTimeoutMs: number;
  echoIntervalMs: number;
  echoTimeoutMs: number;
  statsIntervalMs: number;
  /** The connection before a reconnect stays open this long at most, in case its path comes back. */
  bridgeMaxMs: number;
  /** ... and is closed once the new connection has worked for this long. */
  bridgeStableMs: number;
  /** Candidates gathered ahead of an expected offer are used only while this fresh. */
  preparedAnswerMs: number;
  /** A path whose checks stayed unanswered this long is left at once for a live one. */
  pathSilenceMs: number;
  /** A path counts as live while its last answer is this recent. */
  pathAliveMs: number;
  /** A better path has to stay better this long before traffic moves to it. */
  pathSwitchHoldMs: number;
}

export const DEFAULT_ICE_TIMINGS: IceTimings = {
  gatherTimeoutMs: 5_000,
  turnGraceMs: 1_000,
  checkTimeoutMs: 15_000,
  minCheckTimeMs: 5_000,
  nominationWaitMs: 1_500,
  pacingMs: 20,
  checkRetransmission: { initialRtoMs: 100, maxRtoMs: 1600, attempts: 7 },
  stunRetransmission: { initialRtoMs: 250, maxRtoMs: 1000, attempts: 5 },
  consentIntervalMs: 500,
  retryFailedPairsMs: 30_000,
  pathStatsWindowMs: 20_000,
  turnRefreshMs: null,

  answerTimeoutMs: 10_000,
  retryDelayMs: 5_000,
  attemptWindowMs: 2 * 60 * 1000,
  shortConnectionMs: 30_000,
  slowRetryAfterMs: 2 * 60 * 1000,
  slowRetryDelayMs: 30_000,
  helloIntervalMs: 1_000,
  pingIntervalMs: 500,
  livenessTimeoutMs: 3_000,
  echoIntervalMs: 1_000,
  echoTimeoutMs: 10_000,
  statsIntervalMs: 60_000,
  bridgeMaxMs: 60_000,
  bridgeStableMs: 5_000,
  preparedAnswerMs: 30_000,
  pathSilenceMs: 1_200,
  pathAliveMs: 2_000,
  pathSwitchHoldMs: 10_000,
};
