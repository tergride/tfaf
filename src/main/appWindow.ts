import type { BrowserWindow, Rectangle, Size } from 'electron';
import type { WindowBounds, WindowState } from '../shared/contract.ts';

/** The smallest window the pages are laid out for, at 100 % interface scale. */
const MIN_WINDOW_SIZE: Size = { width: 800, height: 600 };
/** How much of the title bar must be on a screen for the window to come back where it was: enough to grab it. */
const GRABBABLE: Size = { width: 160, height: 32 };
const MAX_COORDINATE = 100_000;

/**
 * A larger interface needs a larger window to keep the room the pages are laid out for, as far as the screen allows;
 * a smaller one lets the window shrink further.
 */
export function minimumWindowSize(scalePercent: number, workArea: Size): Size {
  const factor = scalePercent / 100;
  return {
    width: Math.min(Math.round(MIN_WINDOW_SIZE.width * factor), workArea.width),
    height: Math.min(Math.round(MIN_WINDOW_SIZE.height * factor), workArea.height),
  };
}

/** Zooms the pages to the interface scale and fits the minimum window size to it. */
export function applyInterfaceScale(window: BrowserWindow, scalePercent: number, workArea: Size): void {
  window.webContents.setZoomFactor(scalePercent / 100);
  const minimum = minimumWindowSize(scalePercent, workArea);
  window.setMinimumSize(minimum.width, minimum.height);
}

export type WindowCloseAction = 'close' | 'hide' | 'askCloseToTray' | 'askAboutGame';

export interface WindowCloseState {
  quitting: boolean;
  closeToTray: boolean;
  closeToTrayChosen: boolean;
  /** The page can show the question: it has not crashed and is not loading. */
  interfaceReady: boolean;
  gameIdle: boolean;
}

/**
 * What closing the main window does. A quit already under way (from the tray, an update install or the end of the
 * Windows session) always closes it. The first close asks in the window whether closing should hide it to the tray or
 * quit; a page that cannot show the question leaves the setting as it is. After that the window goes to the tray when
 * the setting says so, which leaves a running game alone, and without it closing during a game first asks.
 */
export function windowCloseAction(state: WindowCloseState): WindowCloseAction {
  if (state.quitting) {
    return 'close';
  }
  if (!state.closeToTrayChosen && state.interfaceReady) {
    return 'askCloseToTray';
  }
  if (state.closeToTray) {
    return 'hide';
  }
  return state.gameIdle ? 'close' : 'askAboutGame';
}

export function windowState(window: BrowserWindow): WindowState {
  return { maximized: window.isMaximized(), focused: window.isFocused() };
}

/** The custom title bar swaps the maximize icon and dims while another window has the focus, like a native one. */
export function watchWindowState(window: BrowserWindow, onChange: (state: WindowState) => void): void {
  const report = (): void => onChange(windowState(window));
  window.on('maximize', report);
  window.on('unmaximize', report);
  window.on('restore', report);
  window.on('focus', report);
  window.on('blur', report);
}

/** Window bounds from settings.json, or null when they are not a usable rectangle. */
export function parseWindowBounds(value: unknown): WindowBounds | null {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  const coordinate = (entry: unknown): entry is number => Number.isInteger(entry) && Math.abs(entry as number) <= MAX_COORDINATE;
  if (!raw || !coordinate(raw.x) || !coordinate(raw.y) || !coordinate(raw.width) || !coordinate(raw.height)) {
    return null;
  }
  if (raw.width <= 0 || raw.height <= 0) {
    return null;
  }
  return { x: raw.x, y: raw.y, width: raw.width, height: raw.height, maximized: raw.maximized === true };
}

/**
 * Where the window opens: where it was left, at least the minimum size, if its title bar is still on one of the
 * screens; otherwise null, and it opens at the default place (a screen was unplugged or the resolution changed).
 */
export function restoredBounds(saved: WindowBounds | null, workAreas: readonly Rectangle[], minimum: Size): Rectangle | null {
  if (!saved) {
    return null;
  }
  const width = Math.max(saved.width, minimum.width);
  const height = Math.max(saved.height, minimum.height);
  const onScreen = workAreas.some((area) => {
    const visibleWidth = Math.min(saved.x + width, area.x + area.width) - Math.max(saved.x, area.x);
    const visibleHeight = Math.min(saved.y + GRABBABLE.height, area.y + area.height) - Math.max(saved.y, area.y);
    return visibleWidth >= GRABBABLE.width && visibleHeight >= GRABBABLE.height;
  });
  return onScreen ? { x: saved.x, y: saved.y, width, height } : null;
}
