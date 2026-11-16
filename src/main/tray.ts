import {
  type BrowserWindow,
  dialog,
  Menu,
  type MenuItemConstructorOptions,
  type MessageBoxOptions,
  nativeImage,
  type NativeImage,
  Tray,
} from 'electron';
import {
  APP_FOLDERS,
  type AppFolder,
  type AppUpdateState,
  type AuthState,
  type GameSessionState,
  type MatchmakerState,
  type NavigationTarget,
} from '../shared/contract.ts';
import { describeError } from './errors.ts';
import { t } from './i18n.ts';
import type { SettingsStore } from './settings.ts';
import { withBadge } from './taskbar.ts';

// Windows draws tray icons at 16 px times the display scale; each scale gets its own sharp copy.
const ICON_SIZE = 16;
const ICON_SCALES = [1, 1.25, 1.5, 2] as const;
const BADGE_SHARE = 0.625;
const HINT_ICON_SIZE = 32;
const MAX_TITLE_LENGTH = 40;
// Windows cuts tray tooltips at 127 characters.
const MAX_TOOLTIP_LENGTH = 127;

export interface AppTrayDeps {
  iconPath: string;
  window(): BrowserWindow | null;
  showWindow(): void;
  navigate(target: NavigationTarget): void;
  settings: Pick<SettingsStore, 'get' | 'markTrayHintShown'>;
  authState(): AuthState;
  logout(): Promise<void>;
  gameState(): GameSessionState;
  updateState(): AppUpdateState;
  installUpdate(): void;
  matchmakerState(): MatchmakerState | null;
  openFolder(folder: AppFolder): Promise<void>;
  /** Quits the launcher at once, closing a running game first; `requestQuit` asks before. */
  quit(): void;
}

interface ConfirmOptions {
  type: 'question' | 'warning';
  message: string;
  detail: string;
  confirm: string;
}

/**
 * The launcher's icon in the notification area. A click brings the window back; the menu is built anew on every
 * right click, so it always shows the current game, update and session.
 */
export class AppTray {
  private readonly deps: AppTrayDeps;
  private readonly tray: Tray;
  private readonly icons: { scaleFactor: number; size: number; image: NativeImage }[];
  private badgeCount = 0;
  private badgeImage: string | null = null;
  private tooltip = '';
  private asking = false;

  constructor(deps: AppTrayDeps) {
    this.deps = deps;
    const source = nativeImage.createFromPath(deps.iconPath);
    if (source.isEmpty()) {
      console.warn(`Tray icon ${deps.iconPath} could not be read`);
    }
    this.icons = ICON_SCALES.map((scaleFactor) => {
      const size = Math.round(ICON_SIZE * scaleFactor);
      return { scaleFactor, size, image: source.resize({ width: size, height: size, quality: 'best' }) };
    });
    this.tray = new Tray(this.trayImage(null));
    this.tray.on('click', () => deps.showWindow());
    this.tray.on('balloon-click', () => deps.showWindow());
    this.tray.on('right-click', () => this.tray.popUpContextMenu(this.menu()));
    this.refresh();
  }

  /** The tooltip follows the game, the matchmaker, the update and the unread count. */
  refresh(): void {
    const lines = ['TFAF'];
    const game = this.deps.gameState();
    const update = this.deps.updateState();
    if (game.phase !== 'idle') {
      lines.push(gameStatus(game));
    } else if (this.deps.matchmakerState()?.searching) {
      lines.push(t('app.tray.status.searching'));
    }
    if (update.status === 'ready' && update.version) {
      lines.push(t('app.tray.status.update', { version: update.version }));
    }
    if (this.badgeCount > 0) {
      lines.push(t('notifications.taskbarBadge', { count: this.badgeCount }));
    }
    const tooltip = lines.join('\n').slice(0, MAX_TOOLTIP_LENGTH);
    if (tooltip !== this.tooltip && !this.tray.isDestroyed()) {
      this.tooltip = tooltip;
      this.tray.setToolTip(tooltip);
    }
  }

  /** The same count and badge as on the taskbar button, which a window hidden in the tray does not have. */
  setBadge(count: number, image: string | null): void {
    this.badgeCount = count;
    if (image !== this.badgeImage && !this.tray.isDestroyed()) {
      this.badgeImage = image;
      this.tray.setImage(this.trayImage(image ? nativeImage.createFromDataURL(image) : null));
    }
    this.refresh();
  }

  /** The first time the window goes to the tray, a tip says where the launcher went. */
  windowHidden(): void {
    if (this.deps.settings.get().trayHintShown || this.tray.isDestroyed()) {
      return;
    }
    this.tray.displayBalloon({
      iconType: 'custom',
      icon: this.hintIcon(),
      title: t('app.tray.hint.title'),
      content: t('app.tray.hint.body'),
    });
    this.deps.settings.markTrayHintShown().catch((error: unknown) => console.warn('Tray hint could not be saved', describeError(error)));
  }

  destroy(): void {
    if (!this.tray.isDestroyed()) {
      this.tray.destroy();
    }
  }

  private menu(): Menu {
    const auth = this.deps.authState();
    const game = this.deps.gameState();
    const update = this.deps.updateState();
    const gameIdle = game.phase === 'idle';
    const items: MenuItemConstructorOptions[] = [{ label: t('app.tray.open'), click: () => this.deps.showWindow() }];
    if (game.current) {
      items.push({
        label: menuLabel(game.title ? t('app.tray.currentGame', { title: shortTitle(game.title) }) : t('app.nav.current')),
        click: () => this.open({ view: 'current' }),
      });
    }
    if (update.status === 'ready' && update.version) {
      const version = update.version;
      // Installing is refused while a game runs, as on the About page.
      items.push({ label: menuLabel(t('app.tray.update', { version })), enabled: gameIdle, click: () => void this.installUpdate(version) });
    }
    items.push({
      label: t('app.userMenu.folders'),
      submenu: APP_FOLDERS.map((folder) => ({ label: menuLabel(t(`app.folders.${folder}`)), click: () => this.openFolder(folder) })),
    });
    items.push({ type: 'separator' });
    if (auth.status === 'signedIn') {
      const login = auth.user.login;
      // The session cannot end during a game: the game still reports its results through the lobby connection.
      items.push({ label: t('app.logout'), enabled: gameIdle, click: () => void this.logout(login) });
    }
    items.push({ label: t('app.tray.quit'), click: () => void this.requestQuit() });
    return Menu.buildFromTemplate(items);
  }

  /** Quits after the same question for the tray menu and the window's account menu. */
  async requestQuit(): Promise<void> {
    const gameIdle = this.deps.gameState().phase === 'idle';
    // The plain question can be turned off in the settings; the warning about a running game cannot.
    if (gameIdle && !this.deps.settings.get().confirmQuit) {
      this.deps.quit();
      return;
    }
    const confirmed = await this.confirm(
      gameIdle
        ? {
            type: 'question',
            message: t('app.tray.confirmQuit.message'),
            detail: t('app.tray.confirmQuit.detail'),
            confirm: t('app.tray.confirmQuit.confirm'),
          }
        : {
            type: 'warning',
            message: t('app.closeDuringGame.message'),
            detail: t('app.tray.quitDuringGameDetail'),
            confirm: t('app.closeDuringGame.quit'),
          },
    );
    if (!confirmed) {
      return;
    }
    // A game started while the plain question was open: closing it needs its own warning.
    if (gameIdle && this.deps.gameState().phase !== 'idle') {
      await this.requestQuit();
      return;
    }
    this.deps.quit();
  }

  private open(target: NavigationTarget): void {
    this.deps.showWindow();
    this.deps.navigate(target);
  }

  private openFolder(folder: AppFolder): void {
    this.deps.openFolder(folder).catch((error: unknown) => console.warn('Folder could not be opened from the tray', describeError(error)));
  }

  private async installUpdate(version: string): Promise<void> {
    const confirmed = await this.confirm({
      type: 'question',
      message: t('app.tray.confirmUpdate.message', { version }),
      detail: t('app.tray.confirmUpdate.detail'),
      confirm: t('app.tray.confirmUpdate.confirm'),
    });
    if (!confirmed || this.deps.gameState().phase !== 'idle') {
      return;
    }
    try {
      this.deps.installUpdate();
    } catch (error) {
      console.warn('Update could not be installed from the tray', describeError(error));
    }
  }

  private async logout(login: string): Promise<void> {
    const confirmed = await this.confirm({
      type: 'question',
      message: t('app.confirmLogout.message', { login }),
      detail: t('app.confirmLogout.detail'),
      confirm: t('app.confirmLogout.confirm'),
    });
    if (!confirmed || this.deps.gameState().phase !== 'idle' || this.deps.authState().status !== 'signedIn') {
      return;
    }
    await this.deps.logout().catch((error: unknown) => console.warn('Logout from the tray failed', describeError(error)));
  }

  /**
   * One question at a time. It belongs to the window while that is on screen, and stands alone while the window is in
   * the tray. Asynchronous, like the question on closing during a game: the game's traffic runs through this process.
   */
  private async confirm(options: ConfirmOptions): Promise<boolean> {
    if (this.asking) {
      return false;
    }
    this.asking = true;
    try {
      const box: MessageBoxOptions = {
        type: options.type,
        title: 'TFAF',
        message: options.message,
        detail: options.detail,
        buttons: [options.confirm, t('common.cancel')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      };
      const window = this.deps.window();
      const owner = window && !window.isDestroyed() && window.isVisible() && !window.isMinimized() ? window : null;
      const { response } = owner ? await dialog.showMessageBox(owner, box) : await dialog.showMessageBox(box);
      return response === 0;
    } finally {
      this.asking = false;
    }
  }

  private trayImage(badgeImage: NativeImage | null): NativeImage {
    const image = nativeImage.createEmpty();
    for (const { scaleFactor, size, image: icon } of this.icons) {
      let png = icon.toPNG();
      if (badgeImage && !icon.isEmpty()) {
        const badgeSize = Math.round(size * BADGE_SHARE);
        const badge = badgeImage.resize({ width: badgeSize, height: badgeSize, quality: 'best' });
        const pixels = withBadge(
          { width: size, height: size, data: icon.toBitmap() },
          { width: badgeSize, height: badgeSize, data: badge.toBitmap() },
        );
        png = nativeImage.createFromBitmap(pixels, { width: size, height: size }).toPNG();
      }
      image.addRepresentation({ scaleFactor, width: size, height: size, buffer: png });
    }
    return image;
  }

  private hintIcon(): NativeImage {
    return (
      this.icons.find((icon) => icon.size === HINT_ICON_SIZE)?.image ??
      nativeImage.createFromPath(this.deps.iconPath).resize({ width: HINT_ICON_SIZE, height: HINT_ICON_SIZE, quality: 'best' })
    );
  }
}

function gameStatus(game: GameSessionState): string {
  if (game.kind === 'replay') {
    return t('app.tray.status.replay');
  }
  if ((game.phase === 'lobby' || game.phase === 'running') && game.title) {
    const title = shortTitle(game.title);
    return game.phase === 'lobby' ? t('app.tray.status.lobby', { title }) : t('app.tray.status.playing', { title });
  }
  return t('app.tray.status.preparing');
}

function shortTitle(title: string): string {
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

/** Windows menus read `&` as the mark of the access key. */
function menuLabel(text: string): string {
  return text.replaceAll('&', '&&');
}
