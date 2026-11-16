// Keep-alive of the lobby connection: pings, the silence after which the connection counts as dead, and probes. While
// a game or a room is on, players reconnect through the lobby server, so a dead connection has to be noticed within
// seconds; otherwise a ping every 15 seconds is enough.

export interface KeepAliveTimings {
  idlePingMs: number;
  idleSilenceMs: number;
  gamePingMs: number;
  gameSilenceMs: number;
  /** A probe without any message from the server within this time ends the connection. */
  probeMs: number;
}

export const KEEP_ALIVE_TIMINGS: KeepAliveTimings = {
  idlePingMs: 15_000,
  idleSilenceMs: 45_000,
  gamePingMs: 5_000,
  gameSilenceMs: 12_000,
  probeMs: 4_000,
};

export interface KeepAliveHooks {
  sendPing(): void;
  /** The server stayed silent: the connection only looks alive. */
  onDead(): void;
}

export class LobbyKeepAlive {
  private readonly hooks: KeepAliveHooks;
  private readonly timings: KeepAliveTimings;
  private timer: NodeJS.Timeout | null = null;
  private probeTimer: NodeJS.Timeout | null = null;
  private lastMessageAt = 0;
  private gameActive = false;
  private running = false;

  constructor(hooks: KeepAliveHooks, timings: KeepAliveTimings = KEEP_ALIVE_TIMINGS) {
    this.hooks = hooks;
    this.timings = timings;
  }

  /** The connection is up. */
  start(): void {
    this.stop();
    this.running = true;
    this.lastMessageAt = Date.now();
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.clearProbe();
  }

  messageReceived(): void {
    this.lastMessageAt = Date.now();
    this.clearProbe();
  }

  setGameActive(active: boolean): void {
    if (active === this.gameActive) {
      return;
    }
    this.gameActive = active;
    if (this.running) {
      this.schedule();
    }
  }

  /** Asks the server for an answer now; without one within a few seconds the connection is dead. */
  probe(): void {
    if (!this.running || this.probeTimer) {
      return;
    }
    const sentAt = Date.now();
    this.hooks.sendPing();
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      if (this.running && this.lastMessageAt < sentAt) {
        this.stop();
        this.hooks.onDead();
      }
    }, this.timings.probeMs);
  }

  private schedule(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = setInterval(() => this.tick(), this.gameActive ? this.timings.gamePingMs : this.timings.idlePingMs);
  }

  private tick(): void {
    const silenceMs = this.gameActive ? this.timings.gameSilenceMs : this.timings.idleSilenceMs;
    if (Date.now() - this.lastMessageAt > silenceMs) {
      this.stop();
      this.hooks.onDead();
      return;
    }
    this.hooks.sendPing();
  }

  private clearProbe(): void {
    if (this.probeTimer) {
      clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
  }
}
