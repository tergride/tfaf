import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chatUserGroup, DEFAULT_GROUP_COLORS, nickColor, nickColorFor } from '../src/renderer/src/lib/nickColors.ts';
import type { ChatPrefs, ChatUser } from '../src/shared/contract.ts';

type ColorPrefs = Pick<ChatPrefs, 'colorMode' | 'groupColors' | 'userColors'>;

function user(overrides: Partial<ChatUser>): ChatUser {
  return { nick: 'alpha', away: false, moderator: false, relation: null, player: null, ...overrides };
}

describe('nick colors', () => {
  it('puts users in the groups of the official client', () => {
    const player = { id: 1, clan: null, country: null, rating: null, avatar: null };
    assert.equal(chatUserGroup(user({ relation: 'self', away: true })), 'self');
    assert.equal(chatUserGroup(user({ relation: 'friend', away: true })), 'away');
    assert.equal(chatUserGroup(user({ relation: 'friend', moderator: true })), 'moderators');
    assert.equal(chatUserGroup(user({ relation: 'foe', player })), 'foes');
    assert.equal(chatUserGroup(user({ player })), 'players');
    assert.equal(chatUserGroup(user({})), 'chat');
  });

  it('prefers the color picked for the player over the mode', () => {
    const prefs: ColorPrefs = { colorMode: 'default', groupColors: {}, userColors: { alpha: '#123456' } };
    assert.equal(nickColorFor('Alpha', 'players', prefs), '#123456');
    assert.equal(nickColorFor('beta', 'players', prefs), null);
  });

  it('colors by mode', () => {
    const random: ColorPrefs = { colorMode: 'random', groupColors: {}, userColors: {} };
    assert.equal(nickColorFor('Beta', null, random), nickColor('beta'));

    const groups: ColorPrefs = { colorMode: 'groups', groupColors: { friends: '#abcdef' }, userColors: {} };
    assert.equal(nickColorFor('beta', 'friends', groups), '#abcdef');
    assert.equal(nickColorFor('beta', 'foes', groups), DEFAULT_GROUP_COLORS.foes);
    // A nick outside the user list has no group to color it by.
    assert.equal(nickColorFor('beta', null, groups), null);
  });
});
