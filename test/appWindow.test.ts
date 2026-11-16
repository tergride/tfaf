import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { minimumWindowSize, windowCloseAction } from '../src/main/appWindow.ts';

describe('windowCloseAction', () => {
  const chosen = { quitting: false, closeToTrayChosen: true, interfaceReady: true };

  it('hides the window to the tray when the setting is on, a running game included', () => {
    assert.equal(windowCloseAction({ ...chosen, closeToTray: true, gameIdle: true }), 'hide');
    assert.equal(windowCloseAction({ ...chosen, closeToTray: true, gameIdle: false }), 'hide');
  });

  it('closes without the setting and asks first during a game', () => {
    assert.equal(windowCloseAction({ ...chosen, closeToTray: false, gameIdle: true }), 'close');
    assert.equal(windowCloseAction({ ...chosen, closeToTray: false, gameIdle: false }), 'askAboutGame');
  });

  it('asks what closing does until the player chooses, whatever the default and the game', () => {
    const unchosen = { quitting: false, closeToTrayChosen: false, interfaceReady: true };
    assert.equal(windowCloseAction({ ...unchosen, closeToTray: true, gameIdle: true }), 'askCloseToTray');
    assert.equal(windowCloseAction({ ...unchosen, closeToTray: false, gameIdle: false }), 'askCloseToTray');
  });

  it('keeps to the setting while a crashed or loading page cannot ask', () => {
    const unready = { quitting: false, closeToTrayChosen: false, interfaceReady: false };
    assert.equal(windowCloseAction({ ...unready, closeToTray: true, gameIdle: true }), 'hide');
    assert.equal(windowCloseAction({ ...unready, closeToTray: false, gameIdle: true }), 'close');
    assert.equal(windowCloseAction({ ...unready, closeToTray: false, gameIdle: false }), 'askAboutGame');
  });

  it('never stands in the way of a quit, such as an update install', () => {
    assert.equal(windowCloseAction({ ...chosen, quitting: true, closeToTray: true, gameIdle: true }), 'close');
    assert.equal(windowCloseAction({ ...chosen, quitting: true, closeToTray: false, gameIdle: false }), 'close');
    assert.equal(windowCloseAction({ ...chosen, quitting: true, closeToTrayChosen: false, closeToTray: true, gameIdle: true }), 'close');
  });
});

describe('minimumWindowSize', () => {
  const screen = { width: 1920, height: 1040 };

  it('grows and shrinks the 800×600 minimum with the interface scale', () => {
    assert.deepEqual(minimumWindowSize(100, screen), { width: 800, height: 600 });
    assert.deepEqual(minimumWindowSize(125, screen), { width: 1000, height: 750 });
    assert.deepEqual(minimumWindowSize(80, screen), { width: 640, height: 480 });
  });

  it('never asks for more than the screen has', () => {
    assert.deepEqual(minimumWindowSize(150, { width: 1366, height: 728 }), { width: 1200, height: 728 });
  });
});
