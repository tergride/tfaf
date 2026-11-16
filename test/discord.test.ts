import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWindowBounds, restoredBounds } from '../src/main/appWindow.ts';
import { DISCORD_OPCODES, DiscordFrameError, encodeFrame, FrameDecoder } from '../src/main/discord/discordIpc.ts';
import { DiscordJoins } from '../src/main/discord/discordJoin.ts';
import type { RawGame } from '../src/main/lobby/lobbyProtocol.ts';
import type { JoinOutcome, LobbyState } from '../src/shared/contract.ts';
import { buildActivity, gameSecret, parseGameSecret, type PresenceGame, type PresenceSnapshot } from '../src/main/discord/presence.ts';
import { parseIceSession, parseTurnServers } from '../src/main/game/iceSession.ts';

const IDLE_GAME: PresenceSnapshot['game'] = { phase: 'idle', kind: 'online', title: null, gameId: null };

function snapshot(overrides: Partial<PresenceSnapshot> = {}): PresenceSnapshot {
  return { game: IDLE_GAME, lobbyGame: null, search: null, allowJoin: true, access: null, ...overrides };
}

function lobbyGame(overrides: Partial<PresenceGame> = {}): PresenceGame {
  return {
    id: 42,
    title: 'Friday 2v2',
    state: 'open',
    gameType: 'custom',
    ratingType: 'global',
    mapFolderName: "seton's_clutch.v0003",
    numPlayers: 2,
    maxPlayers: 4,
    launchedAt: null,
    ...overrides,
  };
}

describe('Discord IPC frames', () => {
  it('encodes and decodes frames split across chunks', () => {
    const first = encodeFrame(DISCORD_OPCODES.handshake, { v: 1, client_id: '123' });
    const second = encodeFrame(DISCORD_OPCODES.frame, { cmd: 'DISPATCH', evt: 'READY', data: { name: 'ё' } });
    assert.equal(first.readInt32LE(0), 0);
    assert.equal(first.readInt32LE(4), first.length - 8);
    const bytes = Buffer.concat([first, second]);
    const decoder = new FrameDecoder();

    const frames = [...decoder.push(bytes.subarray(0, 5)), ...decoder.push(bytes.subarray(5, first.length + 3)), ...decoder.push(bytes.subarray(first.length + 3))];

    assert.deepEqual(frames, [
      { op: 0, payload: { v: 1, client_id: '123' } },
      { op: 1, payload: { cmd: 'DISPATCH', evt: 'READY', data: { name: 'ё' } } },
    ]);
  });

  it('refuses a length that is not of this protocol', () => {
    const header = Buffer.alloc(8);
    header.writeInt32LE(1, 0);
    header.writeInt32LE(-5, 4);
    assert.throws(() => new FrameDecoder().push(header), DiscordFrameError);
  });
});

describe('Discord status', () => {
  it('shows the menu and a matchmaker search', () => {
    assert.equal(buildActivity(snapshot()).secrets, undefined);
    const search = buildActivity(snapshot({ search: { queues: ['1v1', '2v2'], since: 1000 } }));
    assert.equal(search.state, 'Очереди: 1v1, 2v2');
    assert.deepEqual(search.timestamps, { start: 1000 });
  });

  it('lets friends join an open lobby with room at once, with the password the server checks for it', () => {
    const game = { phase: 'running', kind: 'online', title: 'Friday 2v2', gameId: 42 } as const;
    const access = { gameId: 42, password: 'секрет' };
    const open = buildActivity(snapshot({ game, lobbyGame: lobbyGame(), access }));
    assert.equal(open.details, 'Ждёт начала игры «Friday 2v2»');
    assert.equal(open.state, "Карта: seton's clutch");
    assert.deepEqual(open.party, { id: 'tfaf-game-42', size: [2, 4], privacy: 1 });
    assert.deepEqual(parseGameSecret(open.secrets?.join ?? ''), access);
    assert.deepEqual(JSON.parse(buildActivity(snapshot({ game, lobbyGame: lobbyGame() })).secrets?.join ?? 'null'), { gameId: 42 });
    const otherGame = buildActivity(snapshot({ game, lobbyGame: lobbyGame(), access: { gameId: 7, password: 'x' } }));
    assert.equal(otherGame.secrets?.join, gameSecret(42));
    const full = buildActivity(snapshot({ game, lobbyGame: lobbyGame({ numPlayers: 4 }), access }));
    assert.equal(full.secrets, undefined);
    assert.deepEqual(full.party, { id: 'tfaf-game-42', size: [4, 4] });
    assert.equal(buildActivity(snapshot({ game, lobbyGame: lobbyGame(), allowJoin: false, access })).secrets, undefined);
  });

  it('leaves out a password too long for a Discord secret', () => {
    const secret = gameSecret(1_234_567_890, 'ж'.repeat(64));
    assert.deepEqual(JSON.parse(secret), { gameId: 1_234_567_890 });
    const ascii = gameSecret(1_234_567_890, 'p'.repeat(64));
    assert.ok(Buffer.byteLength(ascii) <= 128);
    assert.deepEqual(parseGameSecret(ascii), { gameId: 1_234_567_890, password: 'p'.repeat(64) });
  });

  it('shows a running game with its time and offers nothing to press', () => {
    const game = { phase: 'running', kind: 'online', title: 'Friday 2v2', gameId: 42 } as const;
    const access = { gameId: 42, password: 'secret' };
    const playing = buildActivity(snapshot({ game, access, lobbyGame: lobbyGame({ state: 'playing', launchedAt: '2026-10-24T11:50:00Z' }) }));
    assert.equal(playing.secrets, undefined);
    assert.deepEqual(playing.party, { id: 'tfaf-game-42', size: [2, 4] });
    assert.deepEqual(playing.timestamps, { start: Date.parse('2026-10-24T11:50:00Z') });
    assert.equal(playing.details, 'Играет в «Friday 2v2»');
    const ranked = buildActivity(
      snapshot({ game, lobbyGame: lobbyGame({ state: 'playing', gameType: 'matchmaker', ratingType: 'ladder_1v1', mapFolderName: 'neroxis_map_generator_1.12.0_abc' }) }),
    );
    assert.equal(ranked.details, 'Играет рейтинговый матч 1v1');
    assert.equal(ranked.state, 'Карта: сгенерированная');
  });

  it('reads back only well-formed game secrets', () => {
    assert.deepEqual(parseGameSecret(gameSecret(7)), { gameId: 7, password: null });
    assert.equal(parseGameSecret('{"gameId":-1}'), null);
    assert.equal(parseGameSecret('not json'), null);
    assert.equal(parseGameSecret('null'), null);
    assert.deepEqual(parseGameSecret('{"gameId":7,"password":42}'), { gameId: 7, password: null });
    assert.deepEqual(parseGameSecret(`{"gameId":7,"password":"${'p'.repeat(65)}"}`), { gameId: 7, password: null });
  });
});

/** A lobby server that signs in and lists games when the test says so. */
function fakeJoins(outcome: JoinOutcome = 'joining') {
  let status: LobbyState['status'] = 'disconnected';
  const games = new Set<number>();
  const stateListeners: ((state: LobbyState) => void)[] = [];
  const gameListeners: ((gameId: number) => void)[] = [];
  const joined: number[] = [];
  const invited: { gameId: number; password: string | null }[] = [];
  const passwords: number[] = [];
  const failures: string[] = [];
  const joins = new DiscordJoins({
    lobby: {
      getState: () => ({ status, error: null }),
      getRawGame: (gameId) => (games.has(gameId) ? ({ id: gameId } as RawGame) : null),
      onStateChanged: (listener) => {
        stateListeners.push(listener);
        return () => undefined;
      },
      onGameChanged: (listener) => {
        gameListeners.push(listener);
        return () => undefined;
      },
    },
    games: {
      join: (gameId) => {
        joined.push(gameId);
        return Promise.resolve(outcome);
      },
      joinInvited: (gameId, password) => {
        invited.push({ gameId, password });
        return Promise.resolve('joining');
      },
    },
    askPassword: (gameId) => passwords.push(gameId),
    failed: (text) => failures.push(text),
  });
  return {
    joins,
    joined,
    invited,
    passwords,
    failures,
    connect(): void {
      status = 'connected';
      stateListeners.forEach((listener) => listener({ status, error: null }));
    },
    list(gameId: number): void {
      games.add(gameId);
      gameListeners.forEach((listener) => listener(gameId));
    },
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('joins from Discord', () => {
  it('joins with the password from the secret without asking for it', async () => {
    const fake = fakeJoins('passwordRequired');
    fake.connect();
    fake.list(42);
    fake.joins.request({ gameId: 42, password: 'secret' });
    await settle();
    assert.deepEqual(fake.invited, [{ gameId: 42, password: 'secret' }]);
    assert.deepEqual(fake.joined, []);
    assert.deepEqual(fake.passwords, []);
  });

  it('asks for the password of a game whose secret has none', async () => {
    const fake = fakeJoins('passwordRequired');
    fake.connect();
    fake.list(42);
    fake.joins.request({ gameId: 42, password: null });
    await settle();
    assert.deepEqual(fake.joined, [42]);
    assert.deepEqual(fake.invited, []);
    assert.deepEqual(fake.passwords, [42]);
  });

  it('tells at once that a signed-in launcher does not see the game', () => {
    const fake = fakeJoins();
    fake.connect();
    fake.joins.request({ gameId: 42, password: null });
    assert.deepEqual(fake.joined, []);
    assert.equal(fake.failures.length, 1);
  });

  it('waits for the sign-in and the games after Discord started the launcher', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fake = fakeJoins();
    fake.joins.request({ gameId: 42, password: 'secret' });
    t.mock.timers.tick(60_000);
    fake.connect();
    assert.deepEqual(fake.invited, []);
    fake.list(42);
    await settle();
    assert.deepEqual(fake.invited, [{ gameId: 42, password: 'secret' }]);
    t.mock.timers.tick(120_000);
    assert.deepEqual(fake.failures, []);
  });

  it('gives up when the game does not come after the sign-in', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fake = fakeJoins();
    fake.joins.request({ gameId: 42, password: null });
    fake.connect();
    t.mock.timers.tick(10_000);
    assert.deepEqual(fake.joined, []);
    assert.equal(fake.failures.length, 1);
  });
});

describe('TURN servers', () => {
  const session = {
    forceRelay: false,
    servers: [
      { id: 'eu', urls: ['turn:eu.example:3478'], username: 'u', credential: 'c' },
      { id: 'us', urls: ['turn:us.example:3478'], username: 'u', credential: 'c' },
      { id: 'empty', urls: [] },
    ],
  };

  it('keeps only the preferred servers of a session', () => {
    assert.deepEqual(
      parseIceSession(session, ['us']).servers.map((server) => server.urls[0]),
      ['turn:us.example:3478'],
    );
  });

  it('keeps all when none of the preferred ones is offered', () => {
    assert.equal(parseIceSession(session, ['asia']).servers.length, 2);
    assert.equal(parseIceSession(session, []).servers.length, 2);
  });

  it('lists the offered servers', () => {
    assert.deepEqual(parseTurnServers({ servers: [{ id: 'eu', region: 'Europe' }, { id: 7 }, { region: 'none' }] }), [
      { id: 'eu', region: 'Europe' },
      { id: '7', region: '7' },
    ]);
  });
});

describe('window bounds', () => {
  const screens = [{ x: 0, y: 0, width: 1920, height: 1040 }];
  const minimum = { width: 800, height: 600 };

  it('reads saved bounds and drops broken ones', () => {
    assert.deepEqual(parseWindowBounds({ x: 10, y: 20, width: 1200, height: 800, maximized: true }), {
      x: 10,
      y: 20,
      width: 1200,
      height: 800,
      maximized: true,
    });
    assert.equal(parseWindowBounds({ x: 10, y: 20, width: 0, height: 800 }), null);
    assert.equal(parseWindowBounds({ x: 'a', y: 20, width: 100, height: 800 }), null);
    assert.equal(parseWindowBounds(null), null);
  });

  it('opens where it was left while the title bar is on a screen', () => {
    const saved = { x: 100, y: 50, width: 700, height: 500, maximized: false };
    assert.deepEqual(restoredBounds(saved, screens, minimum), { x: 100, y: 50, width: 800, height: 600 });
  });

  it('opens at the default place when the screen it was on is gone', () => {
    assert.equal(restoredBounds({ x: 2500, y: 100, width: 1200, height: 800, maximized: false }, screens, minimum), null);
    assert.equal(restoredBounds({ x: 100, y: 1030, width: 1200, height: 800, maximized: false }, screens, minimum), null);
    assert.equal(restoredBounds(null, screens, minimum), null);
  });
});
