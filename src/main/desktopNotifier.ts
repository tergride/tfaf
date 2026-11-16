import { type BrowserWindow, Notification } from 'electron';
import type { SettingsStore } from './settings.ts';

export interface DesktopNotice {
  title: string;
  body: string;
  /** Runs after the click brought the launcher window forward. */
  onClick?: () => void;
  /** The taskbar button flashes until the window is in front; off for news that wants no attention. */
  flash?: boolean;
}

/** Windows notifications for what happens while the launcher window is in the background. */
export class DesktopNotifier {
  private readonly getWindow: () => BrowserWindow | null;
  private readonly settings: Pick<SettingsStore, 'get'>;
  // Kept so that a click on the notification still reaches its handler.
  private readonly shown = new Set<Notification>();

  constructor(getWindow: () => BrowserWindow | null, settings: Pick<SettingsStore, 'get'>) {
    this.getWindow = getWindow;
    this.settings = settings;
  }

  /**
   * False when the window is in front (the launcher shows the event itself), or Windows notifications are switched off
   * or unavailable. The taskbar button flashes either way while the window is in the background.
   */
  show(notice: DesktopNotice): boolean {
    const window = this.getWindow();
    if (!window || window.isDestroyed() || window.isFocused()) {
      return false;
    }
    const enabled = this.settings.get().notifications.desktop && Notification.isSupported();
    if (enabled) {
      const notification = new Notification({ title: notice.title, body: notice.body });
      this.shown.add(notification);
      notification.on('click', () => {
        if (!window.isDestroyed()) {
          if (window.isMinimized()) {
            window.restore();
          }
          window.show();
          window.focus();
          notice.onClick?.();
        }
      });
      notification.on('close', () => this.shown.delete(notification));
      notification.show();
    }
    if (notice.flash !== false) {
      window.flashFrame(true);
      window.once('focus', () => window.flashFrame(false));
    }
    return enabled;
  }
}
