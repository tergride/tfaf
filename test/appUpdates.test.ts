import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

const calls = {
  checks: 0,
  installs: [] as boolean[][],
  loads: 0,
  portable: true,
  packaged: true,
  version: '1.2.3',
  prerelease: [] as boolean[],
  downgrade: [] as boolean[],
};
const updater = Object.assign(new EventEmitter(), {
  allowPrerelease: false,
  allowDowngrade: false,
  autoInstallOnAppQuit: true,
  async checkForUpdates() {
    calls.checks += 1;
    calls.prerelease.push(updater.allowPrerelease);
    calls.downgrade.push(updater.allowDowngrade);
  },
  quitAndInstall(...args: boolean[]) { calls.installs.push(args); },
});
Object.assign(globalThis, { __tfafUpdateTest: { calls, updater } });

// The main-process module is exercised with Electron and the updater replaced, so tests cannot update the real app.
// eslint-disable-next-line @typescript-eslint/no-deprecated -- the tests' Electron stand-in loads through module.register
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    let source;
    if (specifier === 'electron') {
      source = "export const app = { get isPackaged() { return globalThis.__tfafUpdateTest.calls.packaged; }, getVersion: () => globalThis.__tfafUpdateTest.calls.version };";
    } else if (specifier === 'electron-updater') {
      source = "globalThis.__tfafUpdateTest.calls.loads += 1; export default { autoUpdater: globalThis.__tfafUpdateTest.updater };";
    } else if (specifier === './storage.ts' && context.parentURL.endsWith('/appUpdates.ts')) {
      source = "export function portableStorage() { return globalThis.__tfafUpdateTest.calls.portable ? {} : null; }";
    }
    return source === undefined ? nextResolve(specifier, context) : { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
  }
`)}`, import.meta.url);

const { AppUpdates } = await import('../src/main/appUpdates.ts');
const folder = await mkdtemp(path.join(os.tmpdir(), 'tfaf-updates-test-'));
Object.defineProperty(process, 'resourcesPath', { value: folder, configurable: true });
after(async () => { await rm(folder, { recursive: true, force: true }); });

describe('launcher installation updates', () => {
  it('never initializes or invokes the installer updater in portable mode, even with a feed', async () => {
    await writeFile(path.join(folder, 'app-update.yml'), 'provider: github\n');
    const updates = new AppUpdates(() => {}, () => false, () => false);
    assert.equal(updates.getState().status, 'disabled');
    assert.equal(updates.getState().disabledReason, 'portable');
    await updates.start();
    await updates.check();
    assert.throws(() => updates.install());
    assert.equal(calls.loads, 0);
    assert.equal(calls.checks, 0);
    assert.equal(calls.installs.length, 0);
  });

  it('keeps development builds disabled', async () => {
    calls.portable = false;
    calls.packaged = false;
    const updates = new AppUpdates(() => {}, () => false, () => false);
    assert.equal(updates.getState().disabledReason, 'unavailable');
    await updates.start();
    assert.equal(calls.loads, 0);
  });

  it('still downloads and installs updates for an ordinary installed copy', async () => {
    calls.packaged = true;
    const updates = new AppUpdates(() => {}, () => false, () => false);
    assert.equal(updates.getState().disabledReason, null);
    await updates.start();
    assert.equal(calls.loads, 1);
    assert.equal(calls.checks, 1);
    updater.emit('update-downloaded', { version: '1.3.0' });
    assert.equal(updates.getState().status, 'ready');
    updates.install();
    assert.deepEqual(calls.installs, [[true, true]]);
  });

  it('takes betas only while the player wants them, and drops a waiting beta when they stop', async () => {
    let betas = true;
    // The services of the tests above listen to the same updater.
    updater.removeAllListeners();
    const updates = new AppUpdates(() => {}, () => false, () => betas);
    await updates.start();
    assert.equal(calls.prerelease.at(-1), true);
    updater.emit('update-downloaded', { version: '1.4.0-beta.1' });
    assert.equal(updates.getState().status, 'ready');
    assert.equal(updater.autoInstallOnAppQuit, true);

    betas = false;
    updates.betasChanged();
    assert.equal(updates.getState().status, 'idle');
    assert.equal(updater.autoInstallOnAppQuit, false, 'the downloaded beta must not install on quit');
    assert.equal(calls.prerelease.at(-1), false);
    assert.equal(calls.downgrade.at(-1), false, 'a release never goes back');

    // A beta that finishes downloading after betas were turned off is dropped as well; a release is kept.
    updater.emit('update-downloaded', { version: '1.4.0-beta.2' });
    assert.equal(updates.getState().status, 'idle');
    updater.emit('update-downloaded', { version: '1.4.0' });
    assert.equal(updates.getState().status, 'ready');
    assert.equal(updater.autoInstallOnAppQuit, true);
  });

  it('takes a beta back to the latest release once the player stops taking betas, unless they change their mind', async () => {
    calls.version = '1.3.0-beta.2';
    let betas = true;
    updater.removeAllListeners();
    const updates = new AppUpdates(() => {}, () => false, () => betas);
    await updates.start();
    assert.equal(calls.downgrade.at(-1), false, 'a beta goes back only when the player stops taking betas');

    betas = false;
    updates.betasChanged();
    assert.equal(calls.downgrade.at(-1), true);
    updater.emit('update-downloaded', { version: '1.2.3' });
    assert.equal(updates.getState().status, 'ready');
    assert.equal(updater.autoInstallOnAppQuit, true);

    betas = true;
    updates.betasChanged();
    assert.equal(updates.getState().status, 'idle');
    assert.equal(updater.autoInstallOnAppQuit, false, 'the older release must not install on quit');
    assert.equal(calls.downgrade.at(-1), false);

    // The older release finishes downloading after the player took betas back: it is dropped and the check runs again.
    const checks = calls.checks;
    updater.emit('update-downloaded', { version: '1.2.3' });
    assert.equal(updates.getState().status, 'idle');
    assert.equal(calls.checks, checks + 1);
    updater.emit('update-downloaded', { version: '1.3.0-beta.3' });
    assert.equal(updates.getState().status, 'ready');
  });
});
