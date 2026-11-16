import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { patchExeVersion, readExeVersion } from '../src/main/game/exePatcher.ts';
import { relayLobbyCommand } from '../src/main/game/gpgRelay.ts';
import type { IceAdapter } from '../src/main/game/iceAdapter.ts';
import { parseRpcMessage } from '../src/main/game/jsonRpc.ts';
import { buildLaunchArguments, buildSkirmishArguments, type LaunchParameters } from '../src/main/game/launchCommand.ts';
import { parseGameLaunch } from '../src/main/lobby/lobbyProtocol.ts';

describe('ForgedAlliance.exe version patch', () => {
  it('writes the version little-endian at all three offsets', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tfaf-exe-test-'));
    try {
      const exe = path.join(directory, 'ForgedAlliance.exe');
      await writeFile(exe, Buffer.alloc(0x476666 + 16));
      await patchExeVersion(exe, 3814);

      assert.equal(await readExeVersion(exe), 3814);
      const content = await readFile(exe);
      for (const address of [0xd3d40, 0x47612d, 0x476666]) {
        assert.deepEqual([...content.subarray(address, address + 4)], [0xe6, 0x0e, 0x00, 0x00]);
      }
      assert.equal(content.readUInt32LE(0xd3d40 + 4), 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

const BASE: LaunchParameters = {
  uid: 25000001,
  username: 'Tergride',
  gpgPort: 6112,
  replayPort: 15000,
  logFile: 'C:\\ProgramData\\TFAF\\logs\\game_25000001.log',
  mean: 1500,
  deviation: 500,
  division: null,
  subdivision: null,
  country: 'RU',
  clan: null,
  numberOfGames: 42,
  faction: null,
  team: null,
  expectedPlayers: null,
  mapPosition: null,
  gameOptions: null,
  additionalArgs: [],
};

describe('buildLaunchArguments', () => {
  it('builds the custom game command line like the official client', () => {
    assert.deepEqual(buildLaunchArguments(BASE), [
      '/init', 'init.lua', '/nobugreport',
      '/log', 'C:\\ProgramData\\TFAF\\logs\\game_25000001.log',
      '/gpgnet', '127.0.0.1:6112',
      '/mean', '1500',
      '/deviation', '500',
      '/savereplay', 'gpgnet://127.0.0.1:15000/25000001/Tergride.SCFAreplay',
      '/country', 'RU',
      '/numgames', '42',
    ]);
  });

  it('adds matchmaker parameters and server arguments', () => {
    const args = buildLaunchArguments({
      ...BASE,
      clan: 'TFAF',
      faction: 'Aeon',
      team: 2,
      expectedPlayers: 2,
      mapPosition: 1,
      division: 'gold',
      subdivision: 'II',
      gameOptions: { Share: 'ShareUntilDeath' },
      additionalArgs: ['/numgames 43'],
    });
    assert.deepEqual(args.slice(0, 4), ['/init', 'init.lua', '/nobugreport', '/aeon']);
    assert.ok(args.join(' ').includes('/clan TFAF'));
    // The league goes right after the rating, as in LaunchCommandBuilder.
    assert.ok(args.join(' ').includes('/deviation 500 /division gold /subdivision II /savereplay'));
    assert.ok(args.join(' ').includes('/team 2 /players 2 /startspot 1 /gameoptions Share:ShareUntilDeath'));
    assert.deepEqual(args.slice(-2), ['/numgames', '43']);
  });

  it('starts skirmish on the FAF files with no lobby connection', () => {
    assert.deepEqual(buildSkirmishArguments('C:\\logs\\skirmish.log'), [
      '/init', 'init.lua', '/nobugreport',
      '/log', 'C:\\logs\\skirmish.log',
    ]);
  });
});

describe('parseGameLaunch', () => {
  it('reads the server launch command', () => {
    const launch = parseGameLaunch({
      command: 'game_launch',
      uid: 123,
      mod: 'faf',
      name: 'Friends 2v2',
      mapname: 'scmp_015',
      args: ['/numgames', 42],
      rating_type: 'global',
      game_type: 'custom',
      faction: 2,
      game_options: { Share: 'ShareUntilDeath' },
    });
    assert.equal(launch.uid, 123);
    assert.deepEqual(launch.args, ['/numgames', '42']);
    assert.equal(launch.faction, 'aeon');
    assert.equal(launch.team, null);
    assert.deepEqual(launch.gameOptions, { Share: 'ShareUntilDeath' });
  });

  it('rejects a launch without game id', () => {
    assert.throws(() => parseGameLaunch({ command: 'game_launch' }));
  });
});

describe('relayLobbyCommand', () => {
  function recordingAdapter(): { adapter: IceAdapter; calls: unknown[][] } {
    const calls: unknown[][] = [];
    const record =
      (name: string) =>
      (...args: unknown[]): void => {
        calls.push([name, ...args]);
      };
    const adapter: IceAdapter = {
      start: () => Promise.resolve(0),
      hostGame: record('hostGame'),
      joinGame: record('joinGame'),
      connectToPeer: record('connectToPeer'),
      disconnectFromPeer: record('disconnectFromPeer'),
      iceMessage: record('iceMessage'),
      signalingRestored: record('signalingRestored'),
      announceRehost: () => Promise.resolve(),
      kickPeer: () => Promise.resolve(),
      updateFingerprint: record('updateFingerprint'),
      stop: record('stop'),
    };
    return { adapter, calls };
  }

  it('maps lobby game commands to adapter calls', () => {
    const { adapter, calls } = recordingAdapter();
    assert.ok(relayLobbyCommand(adapter, 'HostGame', ['scmp_015']));
    assert.ok(relayLobbyCommand(adapter, 'JoinGame', ['Alice', 1]));
    assert.ok(relayLobbyCommand(adapter, 'ConnectToPeer', ['Bob', 2, true]));
    assert.ok(relayLobbyCommand(adapter, 'IceMsg', [2, { candidates: [] }]));
    assert.ok(relayLobbyCommand(adapter, 'DisconnectFromPeer', [2]));
    assert.deepEqual(calls, [
      ['hostGame', 'scmp_015'],
      ['joinGame', 'Alice', 1],
      ['connectToPeer', 'Bob', 2, true],
      ['iceMessage', 2, { candidates: [] }],
      ['disconnectFromPeer', 2],
    ]);
  });

  it('ignores unknown commands and malformed ids', () => {
    const { adapter, calls } = recordingAdapter();
    assert.equal(relayLobbyCommand(adapter, 'Rehost', []), false);
    assert.equal(relayLobbyCommand(adapter, 'JoinGame', ['Alice', 'not-a-number']), false);
    assert.equal(calls.length, 0);
  });
});

describe('parseRpcMessage', () => {
  it('distinguishes calls, results and errors', () => {
    assert.deepEqual(parseRpcMessage('{"jsonrpc":"2.0","method":"onGpgNetMessageReceived","params":["GameState",["Idle"]],"id":5}'), {
      kind: 'call',
      method: 'onGpgNetMessageReceived',
      params: ['GameState', ['Idle']],
      id: 5,
    });
    assert.deepEqual(parseRpcMessage('{"jsonrpc":"2.0","method":"onConnectionStateChanged","params":["Connected"]}'), {
      kind: 'call',
      method: 'onConnectionStateChanged',
      params: ['Connected'],
      id: null,
    });
    assert.deepEqual(parseRpcMessage('{"jsonrpc":"2.0","result":{"ok":true},"id":3}'), { kind: 'result', id: 3, result: { ok: true } });
    assert.deepEqual(parseRpcMessage('{"jsonrpc":"2.0","error":{"code":-32601,"message":"Method not found"},"id":4}'), {
      kind: 'error',
      id: 4,
      message: 'Method not found',
    });
    assert.deepEqual(parseRpcMessage('garbage'), { kind: 'invalid' });
  });
});
