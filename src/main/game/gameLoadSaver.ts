import os from 'node:os';
import type { GameSessionState } from '../../shared/contract.ts';
import { describeError } from '../errors.ts';

export interface ProcessPriorities {
  getPriority: (pid: number) => number;
  setPriority: (pid: number, priority: number) => void;
}

export interface GameLoadSaverDependencies {
  enabled(): boolean;
  /** The game has left its lobby and plays. */
  playing(): boolean;
  /** The user looks at the launcher, so what it shows has to be current. */
  focused(): boolean;
  /** The processes that only draw the interface: never the main one, which carries the game's traffic. */
  interfaceProcesses(): number[];
  setPaused(paused: boolean): void;
  priorities?: ProcessPriorities;
}

/** Whether a new game state changes more than the details of the current game tab, such as the players' round trips. */
export function sessionChanged(previous: GameSessionState | null, next: GameSessionState): boolean {
  return (
    previous === null ||
    previous.phase !== next.phase ||
    previous.kind !== next.kind ||
    previous.gameId !== next.gameId ||
    previous.title !== next.title ||
    previous.current?.launched !== next.current?.launched
  );
}

/**
 * The setting that reduces the launcher's load during a game: while a game plays and the window has no focus, the
 * interface gets no updates and its processes run at a lower priority. The page lets go of its hidden views by itself.
 */
export class GameLoadSaver {
  private readonly deps: GameLoadSaverDependencies;
  private paused = false;
  private lowered: { pid: number; priority: number }[] = [];

  constructor(deps: GameLoadSaverDependencies) {
    this.deps = deps;
  }

  /** Updates for the interface are held back. */
  get holding(): boolean {
    return this.paused;
  }

  private get priorities(): ProcessPriorities {
    return this.deps.priorities ?? os;
  }

  /** Looks again at what decides it: the game, the window's focus or the setting has changed. */
  update(): void {
    const paused = this.deps.enabled() && this.deps.playing() && !this.deps.focused();
    if (paused === this.paused) {
      return;
    }
    this.paused = paused;
    if (paused) {
      this.lowerPriorities();
    } else {
      this.restorePriorities();
    }
    this.deps.setPaused(paused);
  }

  /** Chromium has its own priorities: above normal for the GPU process, the lowest for a page that is not visible. */
  private lowerPriorities(): void {
    const { getPriority, setPriority } = this.priorities;
    const { PRIORITY_BELOW_NORMAL } = os.constants.priority;
    for (const pid of this.deps.interfaceProcesses()) {
      this.tryOn(pid, () => {
        const priority = getPriority(pid);
        // A larger number is a lower priority.
        if (priority < PRIORITY_BELOW_NORMAL) {
          setPriority(pid, PRIORITY_BELOW_NORMAL);
          this.lowered.push({ pid, priority });
        }
      });
    }
  }

  private restorePriorities(): void {
    const { setPriority } = this.priorities;
    for (const { pid, priority } of this.lowered) {
      this.tryOn(pid, () => setPriority(pid, priority));
    }
    this.lowered = [];
  }

  /** A process may have ended, such as a page that crashed. */
  private tryOn(pid: number, change: () => void): void {
    try {
      change();
    } catch (error) {
      console.warn(`Priority of process ${pid} could not be changed`, describeError(error));
    }
  }
}
