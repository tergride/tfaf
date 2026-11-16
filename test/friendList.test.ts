import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { FriendList } from '../src/main/lobby/friendList.ts';
import type { LobbyPlayer } from '../src/main/lobby/lobbyProtocol.ts';
import type { FriendsState, ServerId } from '../src/shared/contract.ts';

function player(id: number, login: string, clan: string | null = null): LobbyPlayer {
  return { id, login, clan, country: 'DE', ratings: new Map([['global', { mean: 1500, deviation: 100 }]]), numberOfGames: 0, avatar: null };
}

const SELF = player(1, 'Me');
const ALICE = player(2, 'Alice', 'TFA');
const BOB = player(3, 'Bob');

/** Alice (online), Bob and Carol (offline, id 4) are friends; the API knows Bob and Carol by login. */
function fakeList(options: { apiLogins?: Record<number, string>; failApi?: boolean } = {}) {
  const online = new Map([SELF, ALICE, BOB].map((one) => [one.id, one]));
  online.delete(BOB.id);
  const friends = new Set([ALICE.id, BOB.id, 4]);
  const socialListeners: (() => void)[] = [];
  const playerListeners: ((ids: ReadonlySet<number> | null) => void)[] = [];
  const requests: string[] = [];
  const states: FriendsState[] = [];
  const apiLogins = options.apiLogins ?? { 3: 'Bob', 4: 'Carol' };
  let server: ServerId = 'prod';
  const list = new FriendList({
    lobby: {
      getSocial: () => ({ channels: [], friends, foes: new Set() }),
      getPlayer: (id) => online.get(id) ?? null,
      getSelf: () => SELF,
      findPlayers: (query) => [...online.values()].filter((one) => one.login.toLowerCase().includes(query)),
      onSocialChanged: (listener) => {
        socialListeners.push(listener);
        return () => undefined;
      },
      onPlayersChanged: (listener) => {
        playerListeners.push(listener);
        return () => undefined;
      },
    },
    api: {
      getAll: (_path, params) => {
        requests.push(params.filter ?? '');
        if (options.failApi) {
          return Promise.reject(new Error('API down'));
        }
        const ids = /=in=\(([\d,]+)\)/.exec(params.filter ?? '')?.[1]?.split(',').map(Number) ?? [];
        const data = ids.filter((id) => apiLogins[id]).map((id) => ({ type: 'player', id: String(id), attributes: { login: apiLogins[id] } }));
        return Promise.resolve({ data, meta: { page: { totalPages: 1 } } });
      },
    },
    server: () => server,
    onState: (state) => states.push(state),
  });
  return {
    list,
    requests,
    states,
    friends,
    socialChanged(): void {
      socialListeners.forEach((listener) => listener());
    },
    playersChanged(ids: number[] | null): void {
      playerListeners.forEach((listener) => listener(ids && new Set(ids)));
    },
    setOnline(one: LobbyPlayer, isOnline: boolean): void {
      if (isOnline) {
        online.set(one.id, one);
      } else {
        online.delete(one.id);
      }
      playerListeners.forEach((listener) => listener(new Set([one.id])));
    },
    setServer(value: ServerId): void {
      server = value;
    },
  };
}

function loginsOf(state: FriendsState | undefined): Record<number, string | null> {
  return Object.fromEntries((state?.friends ?? []).map((friend) => [friend.id, friend.login]));
}

/** Lets the API answers and the work after them run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe('friend list', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  it('shows online friends from the lobby and fetches the logins of the others once', async () => {
    const fake = fakeList();
    fake.socialChanged();
    mock.timers.tick(250);
    const alice = fake.states[0]?.friends.find((friend) => friend.id === ALICE.id);
    assert.deepEqual(alice, { id: 2, login: 'Alice', online: true, clan: 'TFA', country: 'DE', rating: 1200, avatar: null });
    assert.deepEqual(loginsOf(fake.states[0]), { 2: 'Alice', 3: null, 4: null });
    assert.deepEqual(fake.requests, ['id=in=(3,4)']);

    await settle();
    mock.timers.tick(250);
    assert.deepEqual(loginsOf(fake.states[1]), { 2: 'Alice', 3: 'Bob', 4: 'Carol' });

    fake.socialChanged();
    mock.timers.tick(250);
    await settle();
    assert.equal(fake.states.length, 2, 'an unchanged list is not sent again');
    assert.deepEqual(fake.requests, ['id=in=(3,4)']);
  });

  it('follows friends going online and offline, and keeps the login of one who left', async () => {
    const fake = fakeList({ apiLogins: {} });
    fake.socialChanged();
    mock.timers.tick(250);
    await settle();
    fake.setOnline(BOB, true);
    mock.timers.tick(250);
    assert.deepEqual(fake.states.at(-1)?.friends.find((friend) => friend.id === BOB.id)?.online, true);

    fake.setOnline(BOB, false);
    mock.timers.tick(250);
    const bob = fake.states.at(-1)?.friends.find((friend) => friend.id === BOB.id);
    assert.deepEqual({ login: bob?.login, online: bob?.online, rating: bob?.rating }, { login: 'Bob', online: false, rating: null });
  });

  it('does not ask the API again for an account it does not know, nor react to other players', async () => {
    const fake = fakeList({ apiLogins: { 3: 'Bob' } });
    fake.socialChanged();
    mock.timers.tick(250);
    await settle();
    mock.timers.tick(250);
    await settle();
    assert.deepEqual(loginsOf(fake.states.at(-1)), { 2: 'Alice', 3: 'Bob', 4: null });

    const sent = fake.states.length;
    fake.playersChanged([SELF.id, 99]);
    mock.timers.tick(250);
    fake.socialChanged();
    mock.timers.tick(250);
    await settle();
    assert.equal(fake.states.length, sent);
    assert.deepEqual(fake.requests, ['id=in=(3,4)']);
  });

  it('waits a minute after a failed lookup before asking again', async () => {
    const fake = fakeList({ failApi: true });
    const warn = mock.method(console, 'warn', () => undefined);
    fake.socialChanged();
    mock.timers.tick(250);
    await settle();
    fake.socialChanged();
    mock.timers.tick(250);
    await settle();
    warn.mock.restore();
    assert.equal(fake.requests.length, 1);
    assert.equal(warn.mock.callCount(), 1);
  });

  it('forgets the logins when the server changes, as ids differ between servers', async () => {
    const fake = fakeList();
    fake.socialChanged();
    mock.timers.tick(250);
    await settle();
    fake.setServer('test');
    assert.deepEqual(loginsOf(fake.list.getState()), { 2: 'Alice', 3: null, 4: null });
  });

  it('finds online players by login, without ourselves, and marks friends', () => {
    const fake = fakeList();
    const carl = player(5, 'Carl');
    fake.setOnline(carl, true);
    assert.deepEqual(
      fake.list.find(' E ').map(({ login, friend }) => ({ login, friend })),
      [{ login: 'Alice', friend: true }],
    );
    assert.deepEqual(fake.list.find('car'), [{ id: 5, login: 'Carl', clan: null, country: 'DE', friend: false }]);
    assert.deepEqual(fake.list.find(''), []);
  });
});
