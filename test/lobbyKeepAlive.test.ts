import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { KEEP_ALIVE_TIMINGS, LobbyKeepAlive } from '../src/main/lobby/lobbyKeepAlive.ts';

describe('LobbyKeepAlive', () => {
  let pings = 0;
  let deaths = 0;
  let keepAlive: LobbyKeepAlive;

  beforeEach(() => {
    mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
    pings = 0;
    deaths = 0;
    keepAlive = new LobbyKeepAlive({ sendPing: () => pings++, onDead: () => deaths++ });
  });

  afterEach(() => {
    keepAlive.stop();
    mock.timers.reset();
  });

  it('pings every 15 seconds and gives up after 45 seconds of silence outside a game', () => {
    keepAlive.start();
    mock.timers.tick(KEEP_ALIVE_TIMINGS.idlePingMs * 3);
    assert.equal(pings, 3);
    assert.equal(deaths, 0);
    mock.timers.tick(KEEP_ALIVE_TIMINGS.idlePingMs);
    assert.equal(deaths, 1);
  });

  it('keeps a connection that answers', () => {
    keepAlive.start();
    for (let elapsed = 0; elapsed < 120_000; elapsed += 10_000) {
      mock.timers.tick(10_000);
      keepAlive.messageReceived();
    }
    assert.equal(deaths, 0);
  });

  it('notices a dead connection within seconds while a game is on', () => {
    keepAlive.start();
    keepAlive.setGameActive(true);
    mock.timers.tick(KEEP_ALIVE_TIMINGS.gamePingMs * 2);
    assert.equal(pings, 2);
    assert.equal(deaths, 0);
    mock.timers.tick(KEEP_ALIVE_TIMINGS.gamePingMs);
    assert.equal(deaths, 1);
    // Once dead, it stays quiet until the next connection.
    mock.timers.tick(60_000);
    assert.equal(deaths, 1);
  });

  it('ends the connection when a probe gets no answer, and keeps it when one comes', () => {
    keepAlive.start();
    keepAlive.probe();
    assert.equal(pings, 1);
    mock.timers.tick(1_000);
    keepAlive.messageReceived();
    mock.timers.tick(KEEP_ALIVE_TIMINGS.probeMs);
    assert.equal(deaths, 0);

    keepAlive.probe();
    keepAlive.probe();
    assert.equal(pings, 2, 'a probe in flight is not repeated');
    mock.timers.tick(KEEP_ALIVE_TIMINGS.probeMs);
    assert.equal(deaths, 1);
  });

  it('does nothing before the connection is up or after it stopped', () => {
    keepAlive.probe();
    mock.timers.tick(60_000);
    keepAlive.start();
    keepAlive.stop();
    keepAlive.probe();
    mock.timers.tick(60_000);
    assert.equal(pings, 0);
    assert.equal(deaths, 0);
  });
});
