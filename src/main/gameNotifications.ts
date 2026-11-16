import { shell } from 'electron';
import type { DesktopNotifier } from './desktopNotifier.ts';
import { describeError } from './errors.ts';
import { flashGameWindow } from './game/flashWindow.ts';
import { analyzeGameLog, readLogTail, SOUND_ISSUES_URL } from './game/logAnalysis.ts';
import { t } from './i18n.ts';
import type { NotificationCenter } from './notifications.ts';
import type { SoundPlayer } from './sounds.ts';

export interface GameNotificationDependencies {
  notifications: Pick<NotificationCenter, 'add'>;
  notifier: Pick<DesktopNotifier, 'show'>;
  sounds: Pick<SoundPlayer, 'play'>;
}

/**
 * The lobby of the hosted game is full: the player is likely in another window, so everything that can call does. Only
 * as a toast in the launcher: a bell entry would mean nothing once the game has started.
 */
export function notifyGameFull(deps: GameNotificationDependencies, gameTitle: string | null, pid: number | null): void {
  const title = t('notifications.gameFull.title');
  const body = gameTitle ? t('notifications.gameTitle', { title: gameTitle }) : t('notifications.gameFull.body');
  deps.notifications.add({ severity: 'info', title, body, transient: true });
  deps.notifier.show({ title, body });
  deps.sounds.play('notification');
  if (pid !== null && process.platform === 'win32') {
    flashGameWindow(pid).catch((error: unknown) => console.warn('Game window could not be flashed', describeError(error)));
  }
}

/**
 * An online game ended normally: as the official client does, the player is asked to review it. Only as a toast: a
 * bell entry after every game would pile up.
 */
export function notifyGameEnded(
  deps: Pick<GameNotificationDependencies, 'notifications'>,
  gameTitle: string | null,
  openReplay: () => void,
): void {
  deps.notifications.add({
    severity: 'info',
    title: t('notifications.gameEnded.title'),
    body: gameTitle ? t('notifications.gameTitle', { title: gameTitle }) : t('notifications.gameEnded.body'),
    actions: [{ label: t('notifications.gameEnded.review'), run: openReplay }],
    transient: true,
  });
}

/** A failed game, with what its log tells about the cause, like the official client's LogAnalyzerService. */
export async function notifyGameFailed(deps: GameNotificationDependencies, error: string, logFile: string): Promise<void> {
  const issues = analyzeGameLog(await readLogTail(logFile));
  const hints = issues.map((issue) => t(issue === 'minimized' ? 'notifications.gameFailed.minimized' : 'notifications.gameFailed.sound'));
  const title = t('notifications.gameFailed.title');
  deps.notifications.add({
    severity: 'error',
    title,
    body: [error, ...hints].join('\n'),
    actions: [
      { label: t('notifications.gameFailed.openLog'), run: () => shell.showItemInFolder(logFile), keep: true },
      ...(issues.includes('sound')
        ? [{ label: t('notifications.gameFailed.moreInfo'), run: () => shell.openExternal(SOUND_ISSUES_URL), keep: true }]
        : []),
    ],
  });
  deps.notifier.show({ title, body: error });
  deps.sounds.play('notification');
}
