import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const systemTemp = os.tmpdir();
const executable = process.execPath;
const environmentNames = ['TMP', 'TEMP', 'TMPDIR', 'LOCALAPPDATA', 'ProgramData'] as const;
const environment = Object.fromEntries(environmentNames.map((key) => [key, process.env[key]]));
const state = {
  packaged: true,
  paths: {} as Record<string, string>,
  reads: [] as string[],
  changes: [] as string[],
  detected: null as string | null,
  detections: 0,
  writeErrors: {} as Record<string, string>,
  probes: [] as string[],
};
Object.assign(globalThis, { __tfafStorageTest: state });
const gameLocatorUrl = new URL('../src/main/gameLocator.ts', import.meta.url).href;

// Execute the real bootstrap and settings store against isolated Electron paths; no desktop app or registry lookup.
// eslint-disable-next-line @typescript-eslint/no-deprecated -- the tests' Electron stand-in loads through module.register
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    let source;
    if (specifier === 'electron') {
      source = \`
        const state = globalThis.__tfafStorageTest;
        export const app = {
          get isPackaged() { return state.packaged; },
          getVersion: () => '0.16.0',
          getPath(name) {
            state.reads.push(name);
            if (!(name in state.paths)) throw new Error('Unexpected Electron path: ' + name);
            return state.paths[name];
          },
          setPath(name, value) { state.changes.push(name); state.paths[name] = value; },
          setAppLogsPath(value) { state.changes.push('logs'); state.paths.logs = value; },
        };
      \`;
    } else if (specifier === 'node:fs' && context.parentURL.endsWith('/storagePaths.ts')) {
      source = \`
        import * as fs from 'node:fs';
        import path from 'node:path';
        export * from 'node:fs';
        export function openSync(file, ...args) {
          const directory = path.dirname(String(file));
          const state = globalThis.__tfafStorageTest;
          state.probes.push(directory);
          const code = state.writeErrors[directory];
          if (code) throw Object.assign(new Error('Simulated write failure: ' + code), { code });
          return fs.openSync(file, ...args);
        }
      \`;
    } else if (specifier === './gameLocator.ts' && context.parentURL.endsWith('/settings.ts')) {
      source = \`
        export { isValidGamePath } from ${JSON.stringify(gameLocatorUrl)};
        export async function detectGamePath() {
          globalThis.__tfafStorageTest.detections += 1;
          return globalThis.__tfafStorageTest.detected;
        }
      \`;
    }
    return source === undefined ? nextResolve(specifier, context) : {
      url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true,
    };
  }
`)}`, import.meta.url);

const { configureStorage, portableStorage } = await import('../src/main/storage.ts');
const { SettingsStore } = await import('../src/main/settings.ts');

async function savedSettings(profileDirectory: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(profileDirectory, 'settings.json'), 'utf8')) as Record<string, unknown>;
}

describe('portable bootstrap and settings integration', () => {
  let directory: string;
  let installDirectory: string;
  let originalProfile: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(systemTemp, 'tfaf-storage-integration-'));
    installDirectory = path.join(directory, 'app');
    originalProfile = path.join(directory, 'explicit-user-data-dir');
    await mkdir(installDirectory);
    state.packaged = true;
    state.paths = {
      userData: originalProfile,
      home: path.join(directory, 'home'),
      documents: path.join(directory, 'documents'),
    };
    state.reads = [];
    state.changes = [];
    state.detected = null;
    state.detections = 0;
    state.writeErrors = {};
    state.probes = [];
    process.execPath = path.join(installDirectory, 'TFAF.exe');
    process.env.LOCALAPPDATA = path.join(directory, 'local-app-data');
    process.env.ProgramData = path.join(directory, 'program-data');
  });

  afterEach(async () => {
    process.execPath = executable;
    for (const key of environmentNames) {
      if (environment[key] === undefined) delete process.env[key];
      else process.env[key] = environment[key];
    }
    await rm(directory, { recursive: true, force: true });
  });

  async function portable(): Promise<void> {
    await writeFile(path.join(installDirectory, 'portable.flag'), '');
    configureStorage();
  }

  async function gameAt(folder: string): Promise<void> {
    await mkdir(path.join(folder, 'bin'), { recursive: true });
    // A file-only fixture; this executable is never started.
    await writeFile(path.join(folder, 'bin', 'SupremeCommander.exe'), 'test fixture');
  }

  it('preserves Electron userData selected by --user-data-dir for an ordinary installation', async () => {
    const game = path.join(directory, 'installed-game');
    await gameAt(game);
    await mkdir(originalProfile);
    await writeFile(path.join(originalProfile, 'settings.json'), JSON.stringify({ gamePath: game, theme: 'cybran' }));
    const originalTemp = os.tmpdir();
    configureStorage();
    assert.equal(portableStorage(), null);
    assert.deepEqual(state.changes, []);
    assert.equal(os.tmpdir(), originalTemp);
    const settings = await SettingsStore.load();
    assert.equal(settings.get().theme, 'cybran');
    assert.equal(settings.get().gamePath, game);
    assert.equal(settings.get().vaultPath, path.join(state.paths.documents!, 'My Games', 'Gas Powered Games', 'Supreme Commander Forged Alliance'));
    assert.equal(settings.get().dataPath, path.join(process.env.ProgramData!, 'TFAF'));
    assert.equal(settings.pathsStatus().portable, false);
    assert.equal(state.detections, 0);
    await settings.update({ theme: 'aeon' });
    assert.equal((await savedSettings(originalProfile)).theme, 'aeon');
    assert.equal(existsSync(path.join(installDirectory, 'portable-data')), false);
  });

  it('scopes every bootstrap path and fresh settings default to this portable copy', async () => {
    await portable();
    const layout = portableStorage()!;
    assert.deepEqual(Object.fromEntries(state.changes.map((name) => [name, state.paths[name]])), {
      userData: layout.profileDirectory,
      sessionData: layout.sessionDirectory,
      temp: layout.tempDirectory,
      crashDumps: layout.crashDirectory,
      logs: layout.logsDirectory,
    });
    assert.equal(os.tmpdir(), layout.tempDirectory);
    const settings = await SettingsStore.load();
    assert.equal(settings.pathsStatus().portable, true);
    assert.equal(settings.get().vaultPath, layout.vaultDirectory);
    assert.equal(settings.get().dataPath, layout.dataDirectory);
    assert.equal(settings.get().gamePrefsPath, layout.prefsFile);
    assert.deepEqual(state.reads, ['userData']);
    await settings.update({ theme: 'seraphim' });
    const disk = await savedSettings(layout.profileDirectory);
    assert.equal(disk.dataPath, 'portable-data/game');
    assert.equal(disk.vaultPath, 'portable-data/vault');
    assert.equal(disk.gamePrefsPath, 'portable-data/prefs/TFAF.prefs');
    assert.equal(existsSync(originalProfile), false);
    assert.equal(existsSync(process.env.LOCALAPPDATA!), false);
    assert.equal(existsSync(process.env.ProgramData!), false);
    assert.equal(existsSync(state.paths.documents!), false);
  });

  it('loads relative paths after the whole portable folder has moved and preserves external overrides', async () => {
    await portable();
    const internalGame = path.join(installDirectory, 'base-game');
    const externalData = path.join(directory, 'external-data');
    await gameAt(internalGame);
    const original = await SettingsStore.load();
    await original.update({ gamePath: internalGame, vaultPath: path.join(installDirectory, 'custom-vault'), dataPath: externalData });
    const detections = state.detections;
    const movedDirectory = path.join(directory, 'moved portable');
    await rename(installDirectory, movedDirectory);
    installDirectory = movedDirectory;
    process.execPath = path.join(installDirectory, 'TFAF.exe');
    configureStorage();
    const moved = await SettingsStore.load();
    assert.equal(moved.get().gamePath, path.join(installDirectory, 'base-game'));
    assert.equal(moved.get().vaultPath, path.join(installDirectory, 'custom-vault'));
    assert.equal(moved.get().dataPath, externalData);
    assert.equal(moved.get().gamePrefsPath, portableStorage()!.prefsFile);
    assert.equal(state.detections, detections);
    assert.equal(existsSync(originalProfile), false);
  });

  it('re-detects a missing external game and clears a stale path when no game is found', async () => {
    await portable();
    const settings = await SettingsStore.load();
    await settings.update({ gamePath: path.join(directory, 'old-computer-game') });
    state.detected = path.join(directory, 'new-computer-game');
    await gameAt(state.detected);
    state.detections = 0;
    const detected = await SettingsStore.load();
    assert.equal(detected.get().gamePath, state.detected);
    assert.equal(state.detections, 1);
    await detected.update({ gamePath: path.join(directory, 'missing-again') });
    state.detected = null;
    const absent = await SettingsStore.load();
    assert.equal(absent.get().gamePath, null);
    const disk = await savedSettings(portableStorage()!.profileDirectory);
    assert.equal(disk.gamePath, null);
  });

  it('keeps portable game preferences local even when settings or IPC request another file', async () => {
    await portable();
    const layout = portableStorage()!;
    const outside = path.join(directory, 'external-prefs', 'Game.prefs');
    await writeFile(path.join(layout.profileDirectory, 'settings.json'), JSON.stringify({ gamePrefsPath: outside }));
    const settings = await SettingsStore.load();
    assert.equal(settings.get().gamePrefsPath, layout.prefsFile);
    await assert.rejects(settings.update({ gamePrefsPath: outside }));
    assert.equal(settings.get().gamePrefsPath, layout.prefsFile);
    await settings.update({ theme: 'uef' });
    const disk = await savedSettings(layout.profileDirectory);
    assert.equal(disk.gamePrefsPath, 'portable-data/prefs/TFAF.prefs');
    assert.equal(existsSync(outside), false);
  });

  it('fails an unavailable portable folder before changing any Electron path', async () => {
    await writeFile(path.join(installDirectory, 'portable.flag'), '');
    await writeFile(path.join(installDirectory, 'portable-data'), 'blocked by a file');
    assert.throws(() => configureStorage());
    assert.deepEqual(state.changes, []);
    assert.equal(state.paths.userData, originalProfile);
    assert.equal(existsSync(originalProfile), false);
  });

  it('uses and persists a personal default when the shared folder denies writes', async () => {
    const shared = path.join(process.env.ProgramData!, 'TFAF');
    const personal = path.join(process.env.LOCALAPPDATA!, 'TFAF');
    state.writeErrors[shared] = 'EACCES';
    configureStorage();
    const settings = await SettingsStore.load();
    assert.equal(settings.get().dataPath, personal);
    assert.deepEqual(state.probes, [shared, personal]);
    const disk = await savedSettings(originalProfile);
    assert.equal(disk.dataPath, personal);
    state.writeErrors = {};
    state.probes = [];
    const reopened = await SettingsStore.load();
    assert.equal(reopened.get().dataPath, personal);
    assert.deepEqual(state.probes, []);
  });

  it('never changes an explicit saved data path, including the shared default', async () => {
    const shared = path.join(process.env.ProgramData!, 'TFAF');
    await mkdir(originalProfile);
    await writeFile(path.join(originalProfile, 'settings.json'), JSON.stringify({ dataPath: shared }));
    state.writeErrors[shared] = 'EPERM';
    configureStorage();
    const settings = await SettingsStore.load();
    assert.equal(settings.get().dataPath, shared);
    assert.deepEqual(state.probes, []);
    assert.equal(existsSync(path.join(process.env.LOCALAPPDATA!, 'TFAF')), false);
  });

  it('selects a writable default when an ordinary stored path is invalid', async () => {
    await mkdir(originalProfile);
    await writeFile(path.join(originalProfile, 'settings.json'), JSON.stringify({ dataPath: 'relative-path' }));
    state.writeErrors[path.join(process.env.ProgramData!, 'TFAF')] = 'EROFS';
    configureStorage();
    const settings = await SettingsStore.load();
    assert.equal(settings.get().dataPath, path.join(process.env.LOCALAPPDATA!, 'TFAF'));
  });

  it('surfaces disk and IO failures instead of hiding them behind another directory', async () => {
    configureStorage();
    const shared = path.join(process.env.ProgramData!, 'TFAF');
    for (const code of ['ENOSPC', 'EIO']) {
      state.writeErrors[shared] = code;
      await assert.rejects(SettingsStore.load(), { code });
      assert.equal(existsSync(path.join(process.env.LOCALAPPDATA!, 'TFAF')), false);
      assert.equal(existsSync(path.join(originalProfile, 'settings.json')), false);
    }
  });

  it('never applies the personal fallback to a portable permission error', async () => {
    await writeFile(path.join(installDirectory, 'portable.flag'), '');
    state.writeErrors[path.join(installDirectory, 'portable-data', 'profile')] = 'EACCES';
    assert.throws(() => configureStorage());
    assert.equal(existsSync(path.join(process.env.LOCALAPPDATA!, 'TFAF')), false);
    assert.equal(existsSync(path.join(process.env.ProgramData!, 'TFAF')), false);
    assert.deepEqual(state.changes, []);
  });
});
