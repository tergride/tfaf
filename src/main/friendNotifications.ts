import type { NavigationTarget, NotificationPrefs, SoundId } from '../shared/contract.ts';
import type { ChatService } from './chat/chatService.ts';
import type { DesktopNotifier } from './desktopNotifier.ts';
import type { GameRunner } from './game/gameRunner.ts';
import { t } from './i18n.ts';
import type { FriendEvent } from './lobby/friendActivity.ts';
import type { LobbyService } from './lobby/lobbyService.ts';
import type { NotificationCenter } from './notifications.ts';
import type { SettingsStore } from './settings.ts';
import type { SoundPlayer } from './sounds.ts';

export interface FriendNotificationDependencies {
  lobby: Pick<LobbyService, 'onFriendActivity'>;
  settings: Pick<SettingsStore, 'get'>;
  notifications: Pick<NotificationCenter, 'add'>;
  notifier: Pick<DesktopNotifier, 'show'>;
  sounds: Pick<SoundPlayer, 'play'>;
  games: Pick<GameRunner, 'getState'>;
  chat: Pick<ChatService, 'openPrivate'>;
  navigate(target: NavigationTarget): void;
}

const SOUNDS: Record<FriendEvent['type'], SoundId> = {
  online: 'friendOnline',
  offline: 'friendOffline',
  joinedGame: 'friendJoinedGame',
  startedPlaying: 'friendStartedPlaying',
};

const PREFS: Record<FriendEvent['type'], keyof Omit<NotificationPrefs, 'toasts' | 'toastPosition' | 'toastSeconds'>> = {
  online: 'friendOnline',
  offline: 'friendOffline',
  joinedGame: 'friendJoinedGame',
  startedPlaying: 'friendStartedPlaying',
};

/** A toast, a sound and a Windows notification for each friend event, each switched on its own like the official client. */
export function watchFriendActivity(deps: FriendNotificationDependencies): () => void {
  const openChat = (login: string): void => deps.navigate({ view: 'chat', channel: deps.chat.openPrivate(login) });

  return deps.lobby.onFriendActivity((event) => {
    // A running game is not interrupted: no sound and no Windows notification then.
    const playing = deps.games.getState().phase === 'running';
    if (!playing) {
      deps.sounds.play(SOUNDS[event.type]);
    }
    if (!deps.settings.get().notifications[PREFS[event.type]]) {
      return;
    }
    const { login } = event.player;
    let title: string;
    let body = '';
    let onClick: (() => void) | undefined;
    switch (event.type) {
      case 'online':
        title = t('notifications.friends.online', { login });
        onClick = () => openChat(login);
        break;
      case 'offline':
        title = t('notifications.friends.offline', { login });
        break;
      case 'joinedGame': {
        const gameId = event.game.id;
        title = t('notifications.friends.joinedGame', { login });
        body = t('notifications.gameTitle', { title: event.game.title || t('notifications.untitledGame') });
        onClick = () => deps.navigate({ view: 'game', gameId });
        break;
      }
      case 'startedPlaying':
        title = t('notifications.friends.startedPlaying', { login });
        body = t('notifications.gameTitle', { title: event.game.title || t('notifications.untitledGame') });
        onClick = () => openChat(login);
        break;
    }
    deps.notifications.add({ severity: 'info', title, body, onClick, transient: true });
    if (!playing) {
      deps.notifier.show({ title, body, onClick, flash: false });
    }
  });
}
