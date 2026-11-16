import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { TaskProgress } from '../shared/contract.ts';
import { CancelledError, describeError } from './errors.ts';

export interface TaskHandle {
  progress(fraction: number | null, detail?: string): void;
  /** Aborted when the user cancels the task; the work passes it on to its downloads. */
  readonly signal: AbortSignal;
}

export interface TaskOptions {
  /** The progress toast offers to cancel the task. */
  cancellable?: boolean;
}

/** Work that the tasks started inside it belong to, such as a step of a game start. */
export interface TaskScope {
  /** Gets the progress of the scope's tasks, which then stay out of the task list. */
  report: (task: TaskProgress) => void;
  /** Cancels the scope's tasks. */
  readonly signal: AbortSignal;
}

interface OpenScope {
  scope: TaskScope;
  open: boolean;
}

const PROGRESS_THROTTLE_MS = 150;

/** Reports long running work (downloads, installs) to the renderer. */
export class TaskReporter {
  private readonly emit: (task: TaskProgress) => void;
  private readonly cancellable = new Map<string, AbortController>();
  private readonly scopes = new AsyncLocalStorage<OpenScope>();

  constructor(emit: (task: TaskProgress) => void) {
    this.emit = emit;
  }

  /**
   * Runs work whose tasks report to `scope`, including tasks started deeper down its call chain. A task started from
   * a timer the work left behind after it settled is an ordinary task again.
   */
  async within<T>(scope: TaskScope, work: () => Promise<T>): Promise<T> {
    const current: OpenScope = { scope, open: true };
    try {
      return await this.scopes.run(current, work);
    } finally {
      current.open = false;
    }
  }

  /** Whatever the work throws after a cancel becomes a CancelledError, so callers can tell a cancel from a failure. */
  async run<T>(title: string, work: (task: TaskHandle) => Promise<T>, { cancellable = false }: TaskOptions = {}): Promise<T> {
    const id = randomUUID();
    const controller = new AbortController();
    const current = this.scopes.getStore();
    const scope = current?.open ? current.scope : null;
    const emit = scope ? scope.report : this.emit;
    const abort = (): void => controller.abort();
    if (scope) {
      if (scope.signal.aborted) {
        abort();
      } else {
        scope.signal.addEventListener('abort', abort, { once: true });
      }
    } else if (cancellable) {
      this.cancellable.set(id, controller);
    }
    // Inside a scope the scope is what gets cancelled, so its tasks offer no cancel of their own.
    const offersCancel = cancellable && !scope;
    let lastEmit = 0;
    emit({ id, title, progress: null, state: 'running', cancellable: offersCancel });
    const handle: TaskHandle = {
      progress: (fraction, detail) => {
        const now = Date.now();
        if (now - lastEmit >= PROGRESS_THROTTLE_MS && !controller.signal.aborted) {
          lastEmit = now;
          emit({ id, title, progress: fraction, detail, state: 'running', cancellable: offersCancel });
        }
      },
      signal: controller.signal,
    };
    try {
      const result = await work(handle);
      emit({ id, title, progress: 1, state: 'done', cancellable: false });
      return result;
    } catch (error) {
      if (controller.signal.aborted) {
        emit({ id, title, progress: null, state: 'cancelled', cancellable: false });
        throw new CancelledError();
      }
      emit({ id, title, progress: null, state: 'failed', cancellable: false, error: describeError(error) });
      throw error;
    } finally {
      this.cancellable.delete(id);
      scope?.signal.removeEventListener('abort', abort);
    }
  }

  /** Ignores tasks that already finished or cannot be cancelled. */
  cancel(id: string): void {
    this.cancellable.get(id)?.abort();
  }
}
