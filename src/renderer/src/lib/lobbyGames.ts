import type { LobbyGame, LobbyGamePlayer } from '../../../shared/contract.ts';
import { t } from './i18n.ts';

/** Friends of the signed-in player in a game, the host first. */
export function friendsIn(game: LobbyGame): LobbyGamePlayer[] {
  return game.teams
    .flatMap((team) => team.players)
    .filter((player) => player.friend)
    .sort((a, b) => Number(b.login === game.host) - Number(a.login === game.host));
}

/** `Хостит друг Alice`, `Друг: Alice`, `Друзья: Alice, Bob`; null without friends in the game. */
export function friendsLabel(game: LobbyGame): string | null {
  const friends = friendsIn(game);
  const [first] = friends;
  if (!first) {
    return null;
  }
  if (first.login === game.host) {
    return friends.length > 1
      ? t('games.friends.hostAndOthers', { login: first.login, count: friends.length - 1 })
      : t('games.friends.host', { login: first.login });
  }
  return friends.length > 1
    ? t('games.friends.many', { logins: friends.map((friend) => friend.login).join(', ') })
    : t('games.friends.one', { login: first.login });
}
