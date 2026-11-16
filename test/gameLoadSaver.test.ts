import assert from 'node:assert/strict';
import os from 'node:os';
import { describe, it } from 'node:test';
import type { GamePeer, GameSessionState } from '../src/shared/contract.ts';
import { GameLoadSaver, sessionChanged } from '../src/main/game/gameLoadSaver.ts';
import { PeerNumbers } from '../src/main/game/peerNumbers.ts';

const { PRIORITY_ABOVE_NORMAL, PRIORITY_BELOW_NORMAL, PRIORITY_LOW, PRIORITY_NORMAL } = os.constants.priority;

function setup(start: { enabled?: boolean; playing?: boolean; focused?: boolean } = {}) {
  const world = { enabled: true, playing: true, focused: false, ...start };
  const pauses: boolean[] = [];
  const priorities = new Map<number, number>([
    [11, PRIORITY_NORMAL],
    [22, PRIORITY_ABOVE_NORMAL],
    [33, PRIORITY_LOW],
  ]);
  const saver = new GameLoadSaver({
    enabled: () => world.enabled,
    playing: () => world.playing,
    focused: () => world.focused,
    interfaceProcesses: () => [...priorities.keys()],
    setPaused: (paused) => pauses.push(paused),
    priorities: {
      getPriority: (pid) => priorities.get(pid) ?? PRIORITY_NORMAL,
      setPriority: (pid, priority) => {
        priorities.set(pid, priority);
      },
    },
  });
  return { world, saver, pauses, priorities };
}

describe('game load saver', () => {
  it('holds updates back while a game plays and the window has no focus', () => {
    const { world, saver, pauses } = setup({ playing: false });
    saver.update();
    assert.equal(saver.holding, false);
    world.playing = true;
    saver.update();
    assert.equal(saver.holding, true);
    assert.deepEqual(pauses, [true]);
  });

  it('does nothing with the setting off', () => {
    const { saver, pauses, priorities } = setup({ enabled: false });
    saver.update();
    assert.equal(saver.holding, false);
    assert.deepEqual(pauses, []);
    assert.equal(priorities.get(11), PRIORITY_NORMAL);
  });

  it('resumes when the window gets the focus, the game ends or the setting goes off', () => {
    for (const change of ['focused', 'playing', 'enabled'] as const) {
      const { world, saver, pauses } = setup();
      saver.update();
      if (change === 'focused') {
        world.focused = true;
      } else {
        world[change] = false;
      }
      saver.update();
      assert.equal(saver.holding, false, change);
      assert.deepEqual(pauses, [true, false], change);
    }
  });

  it('reports a change once', () => {
    const { saver, pauses } = setup();
    saver.update();
    saver.update();
    assert.deepEqual(pauses, [true]);
  });

  it('lowers the interface processes, never raises one, and gives each its own priority back', () => {
    const { world, saver, priorities } = setup();
    saver.update();
    assert.equal(priorities.get(11), PRIORITY_BELOW_NORMAL);
    assert.equal(priorities.get(22), PRIORITY_BELOW_NORMAL);
    assert.equal(priorities.get(33), PRIORITY_LOW);

    world.focused = true;
    saver.update();
    assert.equal(priorities.get(11), PRIORITY_NORMAL);
    assert.equal(priorities.get(22), PRIORITY_ABOVE_NORMAL);
    assert.equal(priorities.get(33), PRIORITY_LOW);
  });

  it('survives a process that is gone', (t) => {
    t.mock.method(console, 'warn', () => undefined);
    const saver = new GameLoadSaver({
      enabled: () => true,
      playing: () => true,
      focused: () => false,
      interfaceProcesses: () => [11],
      setPaused: () => undefined,
      priorities: {
        getPriority: () => {
          throw new Error('no such process');
        },
        setPriority: () => undefined,
      },
    });
    saver.update();
    assert.equal(saver.holding, true);
  });
});

function session(patch: Partial<GameSessionState> = {}): GameSessionState {
  return {
    phase: 'running',
    kind: 'online',
    gameId: 1,
    title: 'Game',
    message: null,
    error: null,
    peers: [],
    files: null,
    featureIssues: [],
    stages: [],
    cancellable: false,
    current: null,
    tfafLobby: null,
    ...patch,
  };
}

describe('session changes', () => {
  it('leaves out what only the current game tab shows', () => {
    const peer: GamePeer = { playerId: 2, login: 'b', state: 'connected', route: 'direct', rttMs: 20, tfaf: true, duplication: false, loss: null };
    assert.equal(sessionChanged(session(), session({ peers: [peer] })), false);
  });

  it('tells the start, the end and the leaving of the lobby', () => {
    const current = { launched: false } as GameSessionState['current'];
    assert.equal(sessionChanged(null, session()), true);
    assert.equal(sessionChanged(session(), session({ phase: 'idle' })), true);
    assert.equal(sessionChanged(session({ current }), session({ current: { ...current!, launched: true } })), true);
  });
});

describe('peer numbers', () => {
  const peer = (rttMs: number, state: GamePeer['state'] = 'connected'): GamePeer => ({
    playerId: 2,
    login: 'b',
    state,
    route: 'direct',
    rttMs,
    tfaf: true,
    duplication: false,
    loss: null,
  });

  it('sends changes of the numbers together', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const flushed: number[] = [];
    const numbers = new PeerNumbers((held) => flushed.push(held.size));
    const other = { ...peer(30), playerId: 3 };
    assert.equal(numbers.hold(peer(10), peer(20)), true);
    assert.equal(numbers.hold(other, { ...other, rttMs: 40 }), true);
    assert.equal(numbers.hold(peer(20), peer(25)), true);
    assert.deepEqual(flushed, []);
    t.mock.timers.tick(2_000);
    assert.deepEqual(flushed, [2]);
    t.mock.timers.tick(2_000);
    assert.deepEqual(flushed, [2]);
  });

  it('leaves a new player or a change of the connection to the caller', () => {
    const numbers = new PeerNumbers(() => assert.fail('nothing is held'));
    assert.equal(numbers.hold(undefined, peer(10)), false);
    assert.equal(numbers.hold(peer(10), peer(10, 'reconnecting')), false);
  });

  it('drops the numbers of a player who left and of a game that ended', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const flushed: number[] = [];
    const numbers = new PeerNumbers((held) => flushed.push(held.size));
    numbers.hold(peer(10), peer(20));
    numbers.forget(2);
    t.mock.timers.tick(2_000);
    assert.deepEqual(flushed, [0]);
    numbers.hold(peer(10), peer(20));
    numbers.clear();
    t.mock.timers.tick(2_000);
    assert.deepEqual(flushed, [0]);
  });
});
