import type { BrowserWindow, Input } from 'electron';

type WindowShortcut = 'reload' | 'forceReload';

/** Ctrl+R and Ctrl+Shift+R, the only shortcuts kept from the default menu; by the physical key, so any layout works. */
export function windowShortcut(input: Input): WindowShortcut | null {
  if (input.type !== 'keyDown' || input.isComposing || !input.control || input.alt || input.meta) {
    return null;
  }
  const code = input.code || (/^[a-z]$/i.test(input.key) ? `Key${input.key.toUpperCase()}` : '');
  if (code !== 'KeyR') {
    return null;
  }
  return input.shift ? 'forceReload' : 'reload';
}

export function registerWindowShortcuts(window: BrowserWindow): void {
  const contents = window.webContents;
  contents.on('before-input-event', (event, input) => {
    const shortcut = windowShortcut(input);
    if (!shortcut) {
      return;
    }
    event.preventDefault();
    // A held key reloads the page once.
    if (input.isAutoRepeat) {
      return;
    }
    if (shortcut === 'forceReload') {
      contents.reloadIgnoringCache();
    } else {
      contents.reload();
    }
  });
}
