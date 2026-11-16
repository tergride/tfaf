import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findRehostedGame } from '../src/main/game/rehost.ts';
import type { RawGame } from '../src/main/lobby/lobbyProtocol.ts';

describe('rehost', () => {
  it("finds the host's open game created after the one it closed", () => {
    const game = (id: number, host: string, state = 'open') => ({ id, host, state }) as RawGame;
    const games = [game(100, 'Host'), game(101, 'Other'), game(102, 'host', 'playing'), game(103, 'HOST'), game(99, 'Host')];
    assert.equal(findRehostedGame(games, 'host', 100)?.id, 103);
    assert.equal(findRehostedGame(games.slice(0, 3), 'host', 100), null);
  });
});
