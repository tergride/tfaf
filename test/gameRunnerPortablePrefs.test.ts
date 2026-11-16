import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { GameSessionState, LobbyNotice } from '../src/shared/contract.ts';
import type { GameDetails, GameRunnerDependencies, GameRunnerEvents, NextGame } from '../src/main/game/gameRunnerTypes.ts';
import { updateGamePrefs } from '../src/main/vault/gamePrefs.ts';

class FakeGame extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  pid = 42;
  end(code = 0): void {
    this.exitCode = code;
    this.emit('exit', code);
  }
  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.end());
    return true;
  }
}

function gate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  return { wait: new Promise<void>((resolve) => { release = resolve; }), release: () => release() };
}

const state = {
  mode: 'running' as 'running' | 'fast' | 'error' | 'throw',
  calls: [] as string[][],
  child: null as FakeGame | null,
  prepareGate: Promise.resolve(),
  finishGate: Promise.resolve(),
  prepared: () => {},
  spawn(_file: string, args: string[]) {
    this.calls.push(args);
    if (this.mode === 'throw') throw new Error('mock spawn failure');
    const child = new FakeGame();
    this.child = child;
    queueMicrotask(() => {
      if (this.mode === 'error') child.emit('error', new Error('mock missing executable'));
      else {
        child.emit('spawn');
        if (this.mode === 'fast') child.end();
      }
    });
    return child;
  },
};
Object.assign(globalThis, { __tfafGamePrefsTest: state });
const bridgeUrl = new URL('../src/main/game/portablePrefs.ts', import.meta.url).href;

// Only the runner's process spawn is replaced. No actual game, executable or desktop profile is opened.
// eslint-disable-next-line @typescript-eslint/no-deprecated -- the tests' Electron stand-in loads through module.register
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    let source;
    if (specifier === 'electron') source = 'export const app = {};';
    else if (specifier === 'node:child_process' && context.parentURL.endsWith('/gameRunner.ts')) {
      source = 'export function spawn(file, args) { return globalThis.__tfafGamePrefsTest.spawn(file, args); }';
    } else if (specifier === './processes.ts' && context.parentURL.endsWith('/portablePrefs.ts')) {
      source = 'export async function isForgedAllianceRunning() { return false; }';
    } else if (specifier === './portablePrefs.ts' && context.parentURL.endsWith('/gameRunner.ts')) {
      source = \`
        import { preparePortablePrefs as prepare } from ${JSON.stringify(bridgeUrl)};
        export async function preparePortablePrefs(file) {
          const session = await prepare(file);
          const state = globalThis.__tfafGamePrefsTest;
          state.prepared();
          await state.prepareGate;
          return { ...session, async finish() { await state.finishGate; await session.finish(); } };
        }
      \`;
    }
    return source === undefined ? nextResolve(specifier, context) : {
      url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true,
    };
  }
`)}`, import.meta.url);

const { GameRunner } = await import('../src/main/game/gameRunner.ts');
const { recoverPortablePrefs } = await import('../src/main/game/portablePrefs.ts');

interface RunnerInternals {
  spawnGame(bin: string, args: string[], log: string, details: GameDetails, cleanup?: () => void): Promise<void>;
  gameExitWork: Promise<void>;
  next: NextGame | null;
  lobbySession: unknown;
}

describe('portable prefs in the game process lifecycle', () => {
  let folder: string;
  let canonical: string;
  let system: string;
  let runner: InstanceType<typeof GameRunner>;
  let internals: RunnerInternals;
  let notices: LobbyNotice[];
  let states: GameSessionState[];
  const originalLocalAppData = process.env.LOCALAPPDATA;

  beforeEach(async () => {
    folder = await mkdtemp(path.join(os.tmpdir(), 'tfaf-runner-prefs-test-'));
    canonical = path.join(folder, 'portable', 'TFAF.prefs');
    system = path.join(folder, 'windows', 'Gas Powered Games', 'Supreme Commander Forged Alliance');
    process.env.LOCALAPPDATA = path.join(folder, 'windows');
    await mkdir(path.dirname(canonical));
    await writeFile(canonical, 'initial profile');
    state.mode = 'running';
    state.calls = [];
    state.child = null;
    state.prepareGate = Promise.resolve();
    state.finishGate = Promise.resolve();
    state.prepared = () => {};
    notices = [];
    states = [];
    runner = new GameRunner({
      settings: {
        get: () => ({ gamePrefsPath: canonical }),
        pathsStatus: () => ({ portable: true }),
      },
      lobby: { onStateChanged() {}, onGameChanged() {}, getLobbyGame: () => null, setGameActive() {} },
    } as unknown as GameRunnerDependencies, {
      onState: (value: GameSessionState) => states.push(value),
      onNotice: (notice: LobbyNotice) => notices.push(notice),
      onGameFailed() {},
    } as unknown as GameRunnerEvents);
    internals = runner as unknown as RunnerInternals;
  });

  afterEach(async () => {
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
    await rm(folder, { recursive: true, force: true });
  });

  function launch(): Promise<void> {
    return internals.spawnGame(path.join(folder, 'bin'), [], path.join(folder, 'game.log'), {} as GameDetails);
  }

  function workingFile(): string {
    const args = state.calls.at(-1)!;
    return path.join(system, args[args.indexOf('/prefs') + 1]!);
  }

  it('cleans the session on asynchronous spawn failure and permits a later launch', async () => {
    state.mode = 'error';
    await assert.rejects(launch());
    assert.deepEqual(await readdir(system), []);
    await assert.rejects(readFile(`${canonical}.session.json`), { code: 'ENOENT' });
    await updateGamePrefs(canonical, () => 'retry profile');
    state.mode = 'running';
    await launch();
    assert.equal(await readFile(workingFile(), 'utf8'), 'retry profile');
    state.child!.end();
    await internals.gameExitWork;
    assert.equal(runner.getState().phase, 'idle');
  });

  it('also cleans the session if process creation throws synchronously', async () => {
    state.mode = 'throw';
    await assert.rejects(launch(), /mock spawn failure/);
    assert.deepEqual(await readdir(system), []);
    await updateGamePrefs(canonical, () => 'still editable');
  });

  it('handles immediate exit and saves preferences before starting a rehost', async () => {
    const save = gate();
    state.mode = 'fast';
    state.finishGate = save.wait;
    await launch();
    assert.equal(runner.getState().phase, 'running');
    await writeFile(workingFile(), 'saved before rehost');
    let rehosted = false;
    let rehost = Promise.resolve();
    runner.host = () => {
      rehost = (async () => {
        assert.equal(await readFile(canonical, 'utf8'), 'saved before rehost');
        rehosted = true;
      })();
      return rehost;
    };
    internals.next = { kind: 'host', options: {} } as NextGame;
    save.release();
    await internals.gameExitWork;
    await rehost;
    assert.equal(rehosted, true);
    assert.equal(runner.getState().phase, 'idle');
  });

  it('keeps shutdown pending until the killed game profile has been persisted', async () => {
    const save = gate();
    state.finishGate = save.wait;
    await launch();
    await writeFile(workingFile(), 'saved at shutdown');
    let closed = false;
    const shutdown = runner.shutdown(25).then(() => { closed = true; });
    await setImmediate();
    assert.equal(state.child!.killed, true);
    assert.equal(closed, false);
    await assert.rejects(updateGamePrefs(canonical, () => 'unsafe'));
    save.release();
    await shutdown;
    assert.equal(await readFile(canonical, 'utf8'), 'saved at shutdown');
    assert.equal(closed, true);
  });

  it('cancels a prepared session instead of spawning after shutdown began', async () => {
    const prepared = gate();
    const resume = gate();
    state.prepareGate = resume.wait;
    state.prepared = prepared.release;
    const launched = launch();
    const rejected = assert.rejects(launched);
    await prepared.wait;
    const shutdown = runner.shutdown(25);
    resume.release();
    await Promise.all([shutdown, rejected]);
    assert.equal(state.calls.length, 0);
    assert.deepEqual(await readdir(system), []);
    await assert.rejects(readFile(`${canonical}.session.json`), { code: 'ENOENT' });
    await updateGamePrefs(canonical, () => 'not left locked');
  });

  it('saves before returning an aborted TFAF game to its room', async () => {
    let returned = false;
    internals.lobbySession = {
      view: () => null,
      onGameExited() {
        assert.equal(readFileSync(canonical, 'utf8'), 'room preferences');
        returned = true;
      },
    };
    await launch();
    await writeFile(workingFile(), 'room preferences');
    state.child!.end();
    await internals.gameExitWork;
    assert.equal(returned, true);
    assert.equal(runner.getState().phase, 'lobby');
  });

  it('reports save failure, suppresses rehost and retains recoverable preferences', async () => {
    await launch();
    await writeFile(workingFile(), 'recover this profile');
    await rm(canonical);
    await mkdir(canonical);
    let rehosted = false;
    runner.host = async () => { rehosted = true; };
    internals.next = { kind: 'host', options: {} } as NextGame;
    state.child!.end();
    await internals.gameExitWork;
    assert.equal(rehosted, false);
    assert.equal(notices.length, 1);
    assert.equal(notices[0]!.style, 'error');
    assert.equal(runner.getState().phase, 'idle');
    assert.equal(await readFile(workingFile(), 'utf8'), 'recover this profile');
    await assert.rejects(updateGamePrefs(canonical, () => 'unsafe'));
    await rm(canonical, { recursive: true });
    await recoverPortablePrefs(canonical);
    assert.equal(await readFile(canonical, 'utf8'), 'recover this profile');
    await launch();
    state.child!.end();
    await internals.gameExitWork;
    assert.equal(state.calls.length, 2);
  });
});
