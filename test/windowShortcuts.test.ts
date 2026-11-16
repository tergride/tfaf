import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import type { BrowserWindow, Input } from 'electron';
import { registerWindowShortcuts, windowShortcut } from '../src/main/windowShortcuts.ts';

function input(code: string, patch: Partial<Input> = {}): Input {
  return {
    type: 'keyDown', key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code, code,
    control: true, shift: false, alt: false, meta: false, isAutoRepeat: false, isComposing: false, location: 0, modifiers: [],
    ...patch,
  };
}

describe('window shortcuts without a menu', () => {
  it('reloads by the physical key in any layout', () => {
    assert.equal(windowShortcut(input('KeyR')), 'reload');
    assert.equal(windowShortcut(input('KeyR', { shift: true })), 'forceReload');
    assert.equal(windowShortcut(input('KeyR', { key: 'к' })), 'reload');
    assert.equal(windowShortcut(input('', { key: 'R' })), 'reload');
  });

  it('drops the rest of the default menu and leaves other keys to the page', () => {
    for (const [code, patch] of [
      ['F11', { control: false }], ['KeyI', { shift: true }], ['KeyW', {}], ['KeyM', {}],
      ['Equal', {}], ['Minus', {}], ['Digit0', {}], ['Numpad0', {}], ['KeyC', {}], ['KeyV', {}],
      ['KeyR', { control: false }], ['KeyR', { alt: true }], ['KeyR', { meta: true }], ['KeyR', { isComposing: true }],
      ['KeyR', { type: 'keyUp' }],
    ] as const) {
      assert.equal(windowShortcut(input(code, patch)), null, `${code} ${JSON.stringify(patch)}`);
    }
  });

  it('consumes the reload keys and reloads once while they are held', () => {
    const contents = new EventEmitter();
    const calls: string[] = [];
    Object.assign(contents, {
      reload: () => calls.push('reload'),
      reloadIgnoringCache: () => calls.push('forceReload'),
    });
    registerWindowShortcuts({ webContents: contents } as unknown as BrowserWindow);
    const dispatch = (key: Input): boolean => {
      let prevented = false;
      contents.emit('before-input-event', { preventDefault: () => { prevented = true; } }, key);
      return prevented;
    };
    assert.equal(dispatch(input('KeyW')), false);
    assert.equal(dispatch(input('KeyR')), true);
    assert.equal(dispatch(input('KeyR', { isAutoRepeat: true })), true);
    dispatch(input('KeyR', { shift: true }));
    assert.deepEqual(calls, ['reload', 'forceReload']);
  });
});
