import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskProgress } from '../src/shared/contract.ts';
import { CancelledError } from '../src/main/errors.ts';
import { LaunchProgress, summarizeTasks } from '../src/main/game/launchStages.ts';
import { TaskReporter } from '../src/main/tasks.ts';

function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
}

function task(id: string, progress: number | null, state: TaskProgress['state'] = 'running', detail?: string): TaskProgress {
  return { id, title: `Задача ${id}`, progress, state, detail, cancellable: false };
}

describe('task scopes', () => {
  it('keeps the tasks of a scope out of the task list and cancels them with the scope', async () => {
    const listed: TaskProgress[] = [];
    const scoped: TaskProgress[] = [];
    const tasks = new TaskReporter((progress) => listed.push(progress));
    const controller = new AbortController();
    const scope = { report: (progress: TaskProgress) => scoped.push(progress), signal: controller.signal };

    const running = tasks.within(scope, () =>
      tasks.run('Карта', async (handle) => {
        handle.progress(0.5, 'map.zip');
        await waitForAbort(handle.signal);
      }, { cancellable: true }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();

    await assert.rejects(running, CancelledError);
    assert.deepEqual(listed, []);
    assert.deepEqual(
      scoped.map((progress) => [progress.state, progress.progress, progress.cancellable]),
      [
        ['running', null, false],
        ['running', 0.5, false],
        ['cancelled', null, false],
      ],
    );
  });

  it('lists tasks started after the scope settled', async () => {
    const listed: TaskProgress[] = [];
    const tasks = new TaskReporter((progress) => listed.push(progress));
    let later: Promise<void> = Promise.resolve();
    await tasks.within({ report: () => assert.fail('the scope is over'), signal: new AbortController().signal }, async () => {
      later = new Promise((resolve) => setTimeout(resolve, 5)).then(() => tasks.run('Позже', async () => {}));
    });
    await later;
    assert.deepEqual(
      listed.map((progress) => progress.state),
      ['running', 'done'],
    );
  });
});

describe('launch steps', () => {
  const tasks = new TaskReporter(() => assert.fail('launch tasks are not listed'));
  const within = tasks.within.bind(tasks);

  it('shows the average progress of a step and what its latest task does', () => {
    assert.deepEqual(summarizeTasks([task('b', 0.2, 'running', 'b.zip · 1 / 5 МБ'), task('a', null, 'done')]), {
      progress: 0.6,
      detail: 'b.zip · 1 / 5 МБ',
    });
    assert.deepEqual(summarizeTasks([task('b', null), task('a', 0.5)]), { progress: null, detail: 'Задача b' });
  });

  it('runs steps and reports their progress', async () => {
    const snapshots: string[] = [];
    const startup: LaunchProgress = new LaunchProgress(
      [
        { id: 'files', title: 'Файлы игры' },
        { id: 'map', title: 'Карта' },
        { id: 'mods', title: 'Моды' },
      ],
      within,
      () => snapshots.push(startup.stages.map((stage) => `${stage.id}:${stage.state}:${stage.progress ?? '-'}`).join(' ')),
    );
    startup.remove('mods');
    await startup.run('files', () => tasks.run('Файлы', async (handle) => handle.progress(0.25, 'lua.nx2')));
    assert.equal(startup.stages.find((stage) => stage.id === 'files')?.state, 'done');
    assert.ok(snapshots.includes('files:running:0.25 map:pending:-'));
    assert.deepEqual(
      startup.stages.map((stage) => stage.id),
      ['files', 'map'],
    );
  });

  it('cancels until the server is asked, and stops waiting for work that ignores the cancel', async () => {
    const startup = new LaunchProgress([{ id: 'files', title: 'Файлы игры' }, { id: 'server', title: 'Сервер' }], within, () => {});
    const files = startup.run('files', () => new Promise(() => {}));
    assert.equal(startup.cancellable, true);
    assert.equal(startup.cancel(), true);
    await assert.rejects(files, CancelledError);
    assert.equal(startup.stages[0]?.state, 'pending');
    await assert.rejects(startup.run('server', async () => {}), CancelledError);

    const late = new LaunchProgress([{ id: 'server', title: 'Сервер' }], within, () => {});
    await late.run('server', async () => {});
    assert.equal(late.cancel(), false);
  });

  it('marks the failed step and shows unfinished steps as not done', async () => {
    const startup = new LaunchProgress([{ id: 'files', title: 'Файлы игры' }, { id: 'map', title: 'Карта' }], within, () => {});
    const files = startup.run('files', (signal) => waitForAbort(signal));
    await assert.rejects(
      startup.run('map', async () => {
        throw new Error('Карта не найдена');
      }),
      /Карта не найдена/,
    );
    assert.deepEqual(
      startup.failedStages().map((stage) => stage.state),
      ['pending', 'failed'],
    );
    startup.stop();
    await assert.rejects(files, CancelledError);
  });
});
