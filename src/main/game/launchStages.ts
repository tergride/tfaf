import type { LaunchStage, LaunchStageId, TaskProgress } from '../../shared/contract.ts';
import { CancelledError } from '../errors.ts';
import type { TaskScope } from '../tasks.ts';

export interface StagePlan {
  id: LaunchStageId;
  title: string;
}

type RunWithin = <T>(scope: TaskScope, work: () => Promise<T>) => Promise<T>;

// Once the server has been asked, it creates the game whatever the launcher does next.
const UNCANCELLABLE = new Set<LaunchStageId>(['server', 'start']);

/** Progress of a step from its tasks, latest first: the average once every task knows its own, and what the latest one does. */
export function summarizeTasks(tasks: TaskProgress[]): Pick<LaunchStage, 'progress' | 'detail'> {
  const fractions = tasks.map((task) => (task.state === 'running' ? task.progress : 1));
  const known = fractions.filter((fraction) => fraction !== null);
  const latest = tasks.find((task) => task.state === 'running');
  return {
    progress: known.length > 0 && known.length === fractions.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null,
    detail: latest ? (latest.detail ?? latest.title) : null,
  };
}

function untilAborted(signal: AbortSignal): { promise: Promise<never>; dispose(): void } {
  let listener = (): void => {};
  const promise = new Promise<never>((_, reject) => {
    listener = () => reject(new CancelledError());
    signal.addEventListener('abort', listener, { once: true });
  });
  // The promise only matters while a step races it.
  promise.catch(() => undefined);
  return { promise, dispose: () => signal.removeEventListener('abort', listener) };
}

/**
 * The steps of a game start and their progress, which comes from the tasks (downloads, checks) a step's work starts.
 * Cancelling stops the waiting at once and cancels the tasks; work that is not a task finishes on its own.
 */
export class LaunchProgress {
  private current: LaunchStage[];
  /** Tasks of each running step, the latest reported first. */
  private readonly tasks = new Map<LaunchStageId, TaskProgress[]>();
  private readonly controller = new AbortController();
  private readonly within: RunWithin;
  private readonly onChange: () => void;
  private committed = false;

  constructor(plan: StagePlan[], within: RunWithin, onChange: () => void) {
    this.current = plan.map(({ id, title }) => ({ id, title, state: 'pending', progress: null, detail: null }));
    this.within = within;
    this.onChange = onChange;
  }

  get stages(): LaunchStage[] {
    return this.current;
  }

  get cancellable(): boolean {
    return !this.committed && !this.controller.signal.aborted;
  }

  get cancelled(): boolean {
    return this.controller.signal.aborted;
  }

  /** False once the server has been asked. */
  cancel(): boolean {
    if (!this.cancellable) {
      return false;
    }
    this.controller.abort();
    return true;
  }

  /** Makes the start impossible to cancel from the outset: the server has created the game already. */
  commit(): void {
    this.committed = true;
  }

  /** Stops the steps still running after another one failed. */
  stop(): void {
    this.controller.abort();
  }

  /** The steps as a failed start shows them: those still running when it failed did not finish. */
  failedStages(): LaunchStage[] {
    return this.current.map((stage) => (stage.state === 'running' ? { ...stage, state: 'pending', progress: null, detail: null } : stage));
  }

  /** Takes out a step that turned out to have nothing to do. */
  remove(id: LaunchStageId): void {
    this.current = this.current.filter((stage) => stage.id !== id);
    this.onChange();
  }

  async run<T>(id: LaunchStageId, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = this.controller.signal;
    if (signal.aborted) {
      throw new CancelledError();
    }
    if (UNCANCELLABLE.has(id)) {
      this.committed = true;
    }
    this.update(id, { state: 'running', progress: null, detail: null });
    const aborted = untilAborted(signal);
    const scope: TaskScope = { report: (task) => this.onTask(id, task), signal };
    try {
      const result = await Promise.race([this.within(scope, () => work(signal)), aborted.promise]);
      this.update(id, { state: 'done', progress: null, detail: null });
      return result;
    } catch (error) {
      this.update(id, { state: signal.aborted ? 'pending' : 'failed', progress: null, detail: null });
      throw signal.aborted ? new CancelledError() : error;
    } finally {
      aborted.dispose();
      this.tasks.delete(id);
    }
  }

  private onTask(id: LaunchStageId, task: TaskProgress): void {
    if (this.current.find((stage) => stage.id === id)?.state !== 'running') {
      return;
    }
    const tasks = [task, ...(this.tasks.get(id) ?? []).filter((other) => other.id !== task.id)];
    this.tasks.set(id, tasks);
    this.update(id, summarizeTasks(tasks));
  }

  private update(id: LaunchStageId, patch: Partial<LaunchStage>): void {
    this.current = this.current.map((stage) => (stage.id === id ? { ...stage, ...patch } : stage));
    this.onChange();
  }
}
