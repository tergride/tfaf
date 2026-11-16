// Invitations into the lobby of a game, between TFAF launchers. Any player of the game invites with the password the
// server checks for it, sent privately through the chat (tfafPresence.ts), so the invited player joins without being
// asked for it. The invited player's launcher takes invitations only from its friends who are in that open game.

import type { GameInvitee, NavigationTarget } from '../../shared/contract.ts';
import type { ChatService } from '../chat/chatService.ts';
import type { InviteAnswer } from '../chat/tfafPresence.ts';
import type { DesktopNotifier } from '../desktopNotifier.ts';
import { t } from '../i18n.ts';
import type { RawGame } from '../lobby/lobbyProtocol.ts';
import type { LobbyService } from '../lobby/lobbyService.ts';
import type { NotificationCenter } from '../notifications.ts';
import type { SoundPlayer } from '../sounds.ts';
import type { GameRunner } from './gameRunner.ts';
import { lobbyTitle } from './tfafLobby/lobbyAccess.ts';

export interface GameInvitesDependencies {
  lobby: Pick<LobbyService, 'getSelf' | 'getPlayer' | 'getPlayerByLogin' | 'getSocial' | 'getRawGame' | 'findPlayers' | 'onGameChanged'>;
  games: Pick<GameRunner, 'getState' | 'inviteAccess' | 'joinInvited'>;
  chat: Pick<ChatService, 'sendGameInvite' | 'tfafVersion'>;
  notifications: Pick<NotificationCenter, 'add' | 'dismiss'>;
  notifier: Pick<DesktopNotifier, 'show'>;
  sounds: Pick<SoundPlayer, 'play'>;
  navigate(target: NavigationTarget): void;
}

interface ReceivedInvite {
  /** What the server checks for the game; null for a game without a password. */
  password: string | null;
  notificationId: string;
  timer: NodeJS.Timeout;
}

const INVITE_LIFETIME_MS = 10 * 60 * 1000;
// Only friends invite, so a few games at a time; the oldest goes first.
const MAX_INVITES = 20;
const LISTED_FRIENDS = 50;
const FOUND_PLAYERS = 20;

/** The player is the host of the game or has a place in it, as the server lists them. */
function isInGame(game: RawGame, login: string): boolean {
  const key = login.toLowerCase();
  return game.host.toLowerCase() === key || game.teamLogins.some((team) => team.logins.some((name) => name.toLowerCase() === key));
}

export class GameInvites {
  private readonly deps: GameInvitesDependencies;
  private readonly invites = new Map<number, ReceivedInvite>();

  constructor(deps: GameInvitesDependencies) {
    this.deps = deps;
    // An invitation lasts while its game can be joined: one that closed or started takes its notification away.
    deps.lobby.onGameChanged((gameId) => {
      if (this.invites.has(gameId) && deps.lobby.getRawGame(gameId)?.state !== 'open') {
        this.drop(gameId);
      }
    });
  }

  /** Online players to invite: the friends while the query is empty, otherwise the matching logins, friends first. */
  invitees(query: string): GameInvitee[] {
    const { lobby, chat } = this.deps;
    const text = query.trim().toLowerCase();
    const { friends } = lobby.getSocial();
    const selfId = lobby.getSelf()?.id;
    const access = this.deps.games.inviteAccess();
    const game = access ? lobby.getRawGame(access.gameId) : null;
    const tfafOf = (login: string): boolean | null => {
      const version = chat.tfafVersion(login);
      return version === undefined ? null : version !== null;
    };
    const onlineFriends = [...friends]
      .flatMap((id) => lobby.getPlayer(id) ?? [])
      .filter((player) => player.id !== selfId && player.login.toLowerCase().includes(text))
      // The friends who can take an invitation come first.
      .sort((a, b) => Number(tfafOf(b.login) === true) - Number(tfafOf(a.login) === true) || a.login.localeCompare(b.login));
    const others = text
      ? lobby.findPlayers(text, FOUND_PLAYERS + onlineFriends.length + 1).filter((player) => player.id !== selfId && !friends.has(player.id))
      : [];
    return [...onlineFriends, ...others].slice(0, text ? FOUND_PLAYERS : LISTED_FRIENDS).map(({ id, login, clan, country }) => ({
      id,
      login,
      clan,
      country,
      friend: friends.has(id),
      tfaf: tfafOf(login),
      inGame: game !== null && isInGame(game, login),
    }));
  }

  /** Sends the invitation and waits for the player's launcher to take it; a refusal or silence is an error. */
  async invite(playerId: number): Promise<void> {
    const { lobby, chat } = this.deps;
    const access = this.deps.games.inviteAccess();
    if (!access) {
      throw new Error(t('main.gameInvites.notInLobby'));
    }
    const player = lobby.getPlayer(playerId);
    if (!player) {
      throw new Error(t('main.gameInvites.playerOffline'));
    }
    if (player.id === lobby.getSelf()?.id) {
      throw new Error(t('main.gameInvites.inviteSelf'));
    }
    const { login } = player;
    const game = lobby.getRawGame(access.gameId);
    if (game && isInGame(game, login)) {
      throw new Error(t('main.gameInvites.alreadyInGame', { login }));
    }
    if (chat.tfafVersion(login) === null) {
      throw new Error(t('main.gameInvites.notTfaf', { login }));
    }
    const answer = await chat.sendGameInvite(login, access.gameId, access.password);
    console.info(`Invitation to game ${access.gameId} for ${login}: ${answer ?? 'no answer'}`);
    switch (answer) {
      case 'ok':
        // Feedback on the user's own click: a toast, not an entry of the list.
        this.deps.notifications.add({ severity: 'info', title: t('main.gameInvites.title'), body: t('main.gameInvites.sent', { login }), transient: true });
        return;
      case 'notFriend':
        throw new Error(t('main.gameInvites.notFriend', { login }));
      case 'unavailable':
        throw new Error(t('main.gameInvites.unavailable', { login }));
      default:
        throw new Error(t('main.gameInvites.noAnswer', { login }));
    }
  }

  /** An invitation from another launcher: shown when it comes from a friend in that open game; the answer goes back. */
  receive(sender: string, gameId: number, password: string | null): InviteAnswer {
    const { lobby } = this.deps;
    const inviter = lobby.getPlayerByLogin(sender);
    if (!inviter || !lobby.getSocial().friends.has(inviter.id)) {
      console.info(`Invitation to game ${gameId} from ${sender} refused: not a friend`);
      return 'notFriend';
    }
    const game = lobby.getRawGame(gameId);
    const self = lobby.getSelf();
    if (!game || game.state !== 'open' || !isInGame(game, inviter.login) || (self !== null && isInGame(game, self.login))) {
      console.info(`Invitation to game ${gameId} from ${sender} refused: the game cannot be joined`);
      return 'unavailable';
    }
    this.drop(gameId);
    if (this.invites.size >= MAX_INVITES) {
      this.drop(this.invites.keys().next().value!);
    }
    const login = inviter.login;
    const title = t('main.gameInvites.title');
    const body = t('main.gameInvites.body', { login, title: lobbyTitle(game.title) || t('main.gameInvites.untitled') });
    const show = (): void => this.deps.navigate({ view: 'game', gameId });
    const notification = this.deps.notifications.add({
      severity: 'info',
      title,
      body,
      actions: [
        { label: t('main.gameInvites.join'), run: () => this.accept(gameId) },
        { label: t('main.gameInvites.decline'), run: () => this.drop(gameId) },
      ],
      onClick: show,
    });
    const timer = setTimeout(() => this.drop(gameId), INVITE_LIFETIME_MS).unref();
    this.invites.set(gameId, { password, notificationId: notification.id, timer });
    console.info(`Invitation to game ${gameId} from ${login}`);
    // A running game is not interrupted: the invitation waits in the list.
    if (this.deps.games.getState().phase !== 'running') {
      this.deps.sounds.play('notification');
      this.deps.notifier.show({ title, body, onClick: show });
    }
    return 'ok';
  }

  /** Joins with the invitation's password; a failed start keeps the invitation for another try. */
  async accept(gameId: number): Promise<void> {
    const invite = this.invites.get(gameId);
    if (!invite || this.deps.lobby.getRawGame(gameId)?.state !== 'open') {
      this.drop(gameId);
      throw new Error(t('main.gameInvites.expired'));
    }
    const outcome = await this.deps.games.joinInvited(gameId, invite.password);
    this.drop(gameId);
    if (outcome === 'passwordRequired') {
      this.deps.navigate({ view: 'joinPassword', gameId });
    }
  }

  private drop(gameId: number): void {
    const invite = this.invites.get(gameId);
    if (invite) {
      clearTimeout(invite.timer);
      this.invites.delete(gameId);
      this.deps.notifications.dismiss(invite.notificationId);
    }
  }
}
