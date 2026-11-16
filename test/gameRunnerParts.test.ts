import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { GamePeer, LobbyGame } from '../src/shared/contract.ts';
import { BackgroundUpdate } from '../src/main/game/backgroundUpdate.ts';
import { type GameFingerprint, mapKey, modFingerprints, modsDigest } from '../src/main/game/fingerprint.ts';
import { exitError } from '../src/main/game/gameExit.ts';
import { GameFileChecks } from '../src/main/game/gameFileChecks.ts';
import type { PreparedFiles } from '../src/main/game/gamePreparation.ts';
import type { UpdateOptions, UpdateReport } from '../src/main/game/gameUpdater.ts';
import { type LobbyContent, LobbyFiles, type LobbyFilesUpdate } from '../src/main/game/lobbyFiles.ts';
import { sameMods, waitForRehostedGame } from '../src/main/game/rehost.ts';
import type { RawGame } from '../src/main/lobby/lobbyProtocol.ts';
import type { SettingsStore } from '../src/main/settings.ts';

const files = (gameFiles: string): GameFingerprint => ({ gameFiles, map: 'map', mapKey: null, mods: null, modFiles: [] });
const peer = (playerId: number, login: string): GamePeer => ({
  playerId,
  login,
  state: 'connected',
  route: 'direct',
  rttMs: 20,
  tfaf: true,
  duplication: false,
  loss: null,
});

describe('game file checks', () => {
  it('compares the players with the host and sounds the alarm once per difference, again after a player returns', () => {
    const checks = new GameFileChecks({ playerId: 1, login: 'host', fingerprint: files('a') }, []);
    checks.hostLogin = 'host';
    const peers = [peer(2, 'guest')];
    checks.setPeer({ playerId: 2, login: 'guest', fingerprint: files('b') });

    const first = checks.compare(peers, null);
    assert.equal(first.fresh, true);
    assert.equal(first.files.host?.login, 'host');
    assert.equal(first.files.players.find((player) => player.login === 'guest')?.gameFiles, 'different');
    assert.equal(checks.compare(peers, null).fresh, false);

    checks.removePeer(2);
    checks.setPeer({ playerId: 2, login: 'guest', fingerprint: files('b') });
    assert.equal(checks.compare(peers, null).fresh, true);
  });

  it('sounds the alarm for a map only when the player has the lobby map and its files still differ', () => {
    const onMap = (folderName: string, digest: string): GameFingerprint => ({ ...files('a'), map: digest, mapKey: mapKey(folderName) });
    const checks = new GameFileChecks({ playerId: 1, login: 'host', fingerprint: onMap('map-a', 'digest-a') }, []);
    checks.hostLogin = 'host';
    const peers = [peer(2, 'guest')];
    checks.setPeer({ playerId: 2, login: 'guest', fingerprint: onMap('map-a', 'digest-a') });
    assert.equal(checks.compare(peers, null).fresh, false);

    // The host picked another map; the player's launcher is still bringing it in.
    checks.setOwn(onMap('map-b', 'digest-b'), []);
    assert.equal(checks.compare(peers, null).fresh, false);

    checks.setPeer({ playerId: 2, login: 'guest', fingerprint: onMap('map-b', 'digest-other') });
    assert.equal(checks.compare(peers, null).fresh, true);
    assert.equal(checks.compare(peers, null).fresh, false);
  });

  it('takes the host from the lobby game until the lobby names it', () => {
    const checks = new GameFileChecks({ playerId: 2, login: 'guest', fingerprint: files('a') }, []);
    const lobbyGame = { host: 'host', simMods: [] } as unknown as LobbyGame;
    assert.equal(checks.compare([], lobbyGame).files.host?.login, 'host');
  });
});

describe('lobby files', () => {
  const prepared: PreparedFiles = {
    localFiles: { gameVersion: 3840, map: 'matches', mods: [{ uid: 'm28', name: 'M28AI', state: 'matches' }] },
    fingerprint: {
      gameFiles: 'game',
      map: 'digest-map-a',
      mapKey: mapKey('map-a'),
      mods: 'all',
      modFiles: modFingerprints([{ uid: 'm28', digest: 'digest-m28' }]),
    },
    simModUids: ['m28'],
    mods: [{ uid: 'm28', name: 'M28AI', state: 'matches', digest: 'digest-m28' }],
  };

  function lobbyFiles(failing: string[] = []) {
    const calls: string[] = [];
    const notices: string[] = [];
    const updates: LobbyFilesUpdate[] = [];
    const files = new LobbyFiles(
      {
        maps: {
          ensureInstalled: async (folderName) => {
            calls.push(`install ${folderName}`);
          },
          verify: async (folderName) => {
            calls.push(`verify ${folderName}`);
            return { state: 'repaired', digest: `digest-${folderName}`, note: { style: 'info', text: `repaired ${folderName}` } };
          },
        },
        mods: {
          ensureInstalled: async (uids) => {
            calls.push(`install ${uids.join(' ')}`);
            if (uids.some((uid) => failing.includes(uid))) {
              throw new Error('not in the vault');
            }
          },
          verify: async (uids) => {
            calls.push(`verify ${uids.join(' ')}`);
            return { notes: [], mods: uids.map((uid) => ({ uid, name: uid.toUpperCase(), state: 'matches' as const, digest: `digest-${uid}` })) };
          },
        },
        notice: (_style, text) => notices.push(text),
        onUpdate: (update) => updates.push(update),
      },
      prepared,
      'map-a',
    );
    return { files, calls, notices, updates };
  }
  const lobby = (mapFolderName: string, ...uids: string[]): LobbyContent => ({
    mapFolderName,
    simMods: uids.map((uid) => ({ uid, name: uid })),
  });
  const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  it("brings in the map and the mods the game's lobby picks, each once", async () => {
    const { files, calls, notices, updates } = lobbyFiles();
    files.follow(lobby('map-b', 'shields'));
    await settled();
    assert.deepEqual(calls, ['install map-b', 'verify map-b', 'install shields', 'verify shields']);
    assert.deepEqual(notices, ['repaired map-b']);
    assert.equal(updates.length, 1);
    const shields = { uid: 'shields', name: 'SHIELDS', state: 'matches' as const, digest: 'digest-shields' };
    assert.deepEqual(updates[0], {
      mapFolderName: 'map-b',
      localFiles: { gameVersion: 3840, map: 'repaired', mods: [{ uid: 'shields', name: 'SHIELDS', state: 'matches' }] },
      fingerprint: {
        gameFiles: 'game',
        map: 'digest-map-b',
        mapKey: mapKey('map-b'),
        mods: modsDigest([shields]),
        modFiles: modFingerprints([shields]),
      },
      // The unticked mod is still named in comparisons.
      checkedMods: [
        { uid: 'm28', name: 'M28AI' },
        { uid: 'shields', name: 'SHIELDS' },
      ],
    });

    // The first map and the unticked mod again: nothing is checked twice.
    files.follow(lobby('MAP-A', 'shields', 'm28'));
    await settled();
    assert.equal(calls.length, 4);
    assert.equal(updates[1]?.localFiles.map, 'matches');
    assert.deepEqual(updates[1]?.localFiles.mods.map((mod) => mod.uid), ['m28', 'shields']);

    // The same files in another order change nothing.
    files.follow(lobby('map-a', 'm28', 'shields'));
    await settled();
    assert.equal(updates.length, 2);

    // Mods not known yet, as before the game we host reports them, stay as they are.
    files.follow({ mapFolderName: 'map-a', simMods: null });
    await settled();
    assert.equal(updates.length, 2);
  });

  it('shows a mod it could not prepare as unchecked and stops with the game', async () => {
    const { files, notices, updates } = lobbyFiles(['broken']);
    files.follow(lobby('map-a', 'm28', 'broken'));
    await settled();
    assert.match(notices[0] ?? '', /broken.*not in the vault/);
    assert.deepEqual(updates[0]?.localFiles.mods, [
      { uid: 'broken', name: 'broken', state: 'unchecked' },
      { uid: 'm28', name: 'M28AI', state: 'matches' },
    ]);
    assert.equal(updates[0]?.fingerprint.mods, null);

    files.stop();
    files.follow(lobby('map-b'));
    await settled();
    assert.equal(updates.length, 1);
  });
});

describe('rehost waiting', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  const lobby = (games: RawGame[]) => {
    const listeners = new Set<(gameId: number) => void>();
    return {
      games,
      changed: (gameId: number) => listeners.forEach((listener) => listener(gameId)),
      getRawGames: () => games,
      onGameChanged: (listener: (gameId: number) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  };
  const game = (id: number, host: string) => ({ id, host, state: 'open' }) as RawGame;

  it("resolves with the host's new game once the lobby announces it", async () => {
    const fake = lobby([game(100, 'Host')]);
    const waiting = waitForRehostedGame(fake, 'host', 100, new AbortController().signal);
    fake.games.push(game(105, 'HOST'));
    fake.changed(105);
    assert.equal((await waiting).id, 105);
  });

  it('gives up after the wait', async () => {
    const waiting = waitForRehostedGame(lobby([]), 'host', 100, new AbortController().signal);
    mock.timers.tick(3 * 60 * 1000);
    await assert.rejects(waiting);
  });

  it('compares mod lists as sets', () => {
    assert.equal(sameMods(['b', 'a', 'a'], ['a', 'b']), true);
    assert.equal(sameMods(['a'], ['a', 'b']), false);
  });
});

describe('background update', () => {
  let gamePath: string;

  beforeEach(async () => {
    gamePath = await mkdtemp(path.join(os.tmpdir(), 'tfaf-background-update-'));
    await mkdir(path.join(gamePath, 'bin'));
    await writeFile(path.join(gamePath, 'bin', 'ForgedAlliance.exe'), '');
    mock.timers.enable({ apis: ['Date'], now: Date.now() });
    mock.method(console, 'warn', () => {});
  });
  afterEach(async () => {
    mock.timers.reset();
    mock.restoreAll();
    await rm(gamePath, { recursive: true, force: true });
  });

  it('hashes every file on the first update of a launcher run, again until that succeeds, then trusts the cache', async () => {
    const verified: boolean[] = [];
    let offline = true;
    const background = new BackgroundUpdate(
      { get: () => ({ gamePath }) } as unknown as Pick<SettingsStore, 'get'>,
      {
        update: async (_featuredMod: string, options?: UpdateOptions) => {
          verified.push(options?.verify ?? false);
          if (offline) {
            throw new Error('offline');
          }
          return {} as UpdateReport;
        },
      },
      'faf',
    );
    const login = async (): Promise<void> => {
      background.run();
      await new Promise((resolve) => setImmediate(resolve));
    };

    await login();
    offline = false;
    await login();
    mock.timers.tick(31 * 60 * 1000);
    await login();
    assert.deepEqual(verified, [true, true, false]);
  });
});

describe('game exit', () => {
  it('reports an exit with an error code, an unknown code and missing system libraries, not a normal exit', () => {
    assert.equal(exitError(0, 'game.log'), null);
    assert.match(exitError(1, 'game.log') ?? '', /код 1\).*game\.log/);
    assert.match(exitError(null, 'game.log') ?? '', /код неизвестен.*game\.log/);
    // STATUS_DLL_NOT_FOUND as Node and Java report it.
    assert.match(exitError(3221225781, 'game.log') ?? '', /библиотек/);
    assert.match(exitError(-1073741515, 'game.log') ?? '', /библиотек/);
  });
});
