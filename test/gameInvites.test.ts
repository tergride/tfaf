import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { InviteAnswer } from '../src/main/chat/tfafPresence.ts';
import { GameInvites } from '../src/main/game/gameInvites.ts';
import type { LobbyPlayer, RawGame } from '../src/main/lobby/lobbyProtocol.ts';
import { NotificationCenter } from '../src/main/notifications.ts';
import type { GameSessionState, JoinOutcome, NavigationTarget } from '../src/shared/contract.ts';

function player(id: number, login: string): LobbyPlayer {
  return { id, login, clan: null, country: null, ratings: new Map(), numberOfGames: 0, avatar: null };
}

function game(id: number, host: string, logins: string[], state = 'open'): RawGame {
  return { id, title: '[TFAF] Friday', host, state, teamLogins: [{ team: 1, logins }], teamIds: [] } as unknown as RawGame;
}

const SELF = player(1, 'Me');
const ALICE = player(2, 'Alice');
const BOB = player(3, 'Bob');

/** Us, Alice and Bob online; Alice is a friend and runs TFAF, Bob runs another client. */
function fakeInvites(options: { access?: { gameId: number; password: string | null } | null; answer?: InviteAnswer | null; outcome?: JoinOutcome } = {}) {
  const players = [SELF, ALICE, BOB];
  const games = new Map<number, RawGame>();
  const gameListeners: ((gameId: number) => void)[] = [];
  const sent: { login: string; gameId: number; password: string | null }[] = [];
  const joined: { gameId: number; password: string | null }[] = [];
  const navigated: NavigationTarget[] = [];
  const notifications = new NotificationCenter({ onChanged: () => undefined, onAdded: () => undefined });
  const invites = new GameInvites({
    lobby: {
      getSelf: () => SELF,
      getPlayer: (id) => players.find((one) => one.id === id) ?? null,
      getPlayerByLogin: (login) => players.find((one) => one.login.toLowerCase() === login.toLowerCase()) ?? null,
      getSocial: () => ({ channels: [], friends: new Set([ALICE.id]), foes: new Set() }),
      getRawGame: (gameId) => games.get(gameId) ?? null,
      findPlayers: (query) => players.filter((one) => one.login.toLowerCase().includes(query)),
      onGameChanged: (listener) => {
        gameListeners.push(listener);
        return () => undefined;
      },
    },
    games: {
      getState: () => ({ phase: 'idle' }) as GameSessionState,
      inviteAccess: () => options.access ?? null,
      joinInvited: (gameId, password) => {
        joined.push({ gameId, password });
        return Promise.resolve(options.outcome ?? 'joining');
      },
    },
    chat: {
      sendGameInvite: (login, gameId, password) => {
        sent.push({ login, gameId, password });
        return Promise.resolve(options.answer === undefined ? 'ok' : options.answer);
      },
      tfafVersion: (login) => (login === 'Alice' ? '0.18.0' : login === 'Bob' ? null : undefined),
    },
    notifications,
    notifier: { show: () => true },
    sounds: { play: () => undefined },
    navigate: (target) => navigated.push(target),
  });
  return {
    invites,
    notifications,
    sent,
    joined,
    navigated,
    setGame(value: RawGame): void {
      games.set(value.id, value);
      gameListeners.forEach((listener) => listener(value.id));
    },
  };
}

describe('game invitations', () => {
  it('shows an invitation from a friend in that open game and joins with its password', async () => {
    const fake = fakeInvites();
    fake.setGame(game(42, 'Alice', ['Alice']));
    assert.equal(fake.invites.receive('alice', 42, 'hash'), 'ok');
    const [shown] = fake.notifications.list();
    assert.ok(shown);
    assert.equal(shown.actions.length, 2);

    await fake.notifications.act(shown.id, shown.actions[0]!.id);
    assert.deepEqual(fake.joined, [{ gameId: 42, password: 'hash' }]);
    assert.equal(fake.notifications.list().length, 0);
  });

  it('refuses invitations from players who are not friends or into games that cannot be joined', () => {
    const fake = fakeInvites();
    fake.setGame(game(42, 'Bob', ['Bob', 'Alice']));
    fake.setGame(game(43, 'Bob', ['Bob']));
    fake.setGame(game(44, 'Alice', ['Alice', 'Me']));
    assert.equal(fake.invites.receive('Bob', 42, null), 'notFriend');
    assert.equal(fake.invites.receive('Alice', 43, null), 'unavailable');
    assert.equal(fake.invites.receive('Alice', 44, null), 'unavailable');
    assert.equal(fake.invites.receive('Alice', 45, null), 'unavailable');
    assert.equal(fake.notifications.list().length, 0);
  });

  it('takes the invitation away when its game starts', async () => {
    const fake = fakeInvites();
    fake.setGame(game(42, 'Alice', ['Alice']));
    fake.invites.receive('Alice', 42, null);
    fake.setGame(game(42, 'Alice', ['Alice'], 'playing'));
    assert.equal(fake.notifications.list().length, 0);
    await assert.rejects(fake.invites.accept(42));
    assert.deepEqual(fake.joined, []);
  });

  it('asks for the password when the invitation did not bring the one the game needs', async () => {
    const fake = fakeInvites({ outcome: 'passwordRequired' });
    fake.setGame(game(42, 'Alice', ['Alice']));
    fake.invites.receive('Alice', 42, null);
    await fake.invites.accept(42);
    assert.deepEqual(fake.navigated, [{ view: 'joinPassword', gameId: 42 }]);
  });

  it('invites a TFAF player with the password the server checks and reports a refusal or silence', async () => {
    const access = { gameId: 7, password: 'secret' };
    const fake = fakeInvites({ access });
    fake.setGame(game(7, 'Me', ['Me']));
    await fake.invites.invite(ALICE.id);
    assert.deepEqual(fake.sent, [{ login: 'Alice', gameId: 7, password: 'secret' }]);
    // A player of another client is not even asked.
    await assert.rejects(fake.invites.invite(BOB.id));
    assert.equal(fake.sent.length, 1);

    await assert.rejects(fakeInvites({ access, answer: null }).invites.invite(ALICE.id));
    await assert.rejects(fakeInvites({ access, answer: 'notFriend' }).invites.invite(ALICE.id));
    await assert.rejects(fakeInvites().invites.invite(ALICE.id));
  });

  it('offers the online friends first and marks who is in the game or not on TFAF', () => {
    const fake = fakeInvites({ access: { gameId: 7, password: null } });
    fake.setGame(game(7, 'Me', ['Me', 'Alice']));
    assert.deepEqual(
      fake.invites.invitees('').map(({ login, friend, tfaf, inGame }) => ({ login, friend, tfaf, inGame })),
      [{ login: 'Alice', friend: true, tfaf: true, inGame: true }],
    );
    assert.deepEqual(
      fake.invites.invitees('b').map(({ login, friend, tfaf }) => ({ login, friend, tfaf })),
      [{ login: 'Bob', friend: false, tfaf: false }],
    );
  });
});
