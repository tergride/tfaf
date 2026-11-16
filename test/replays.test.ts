import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';
import { resolveDocument } from '../src/main/api/jsonApi.ts';
import { CancelledError } from '../src/main/errors.ts';
import { buildReplayArguments } from '../src/main/game/launchCommand.ts';
import type { RawGame } from '../src/main/lobby/lobbyProtocol.ts';
import { LiveReplaySource } from '../src/main/replays/liveReplay.ts';
import { replayQuality } from '../src/main/replays/matchQuality.ts';
import { parseReplayChat, readReplayDetails } from '../src/main/replays/replayBody.ts';
import {
  encodeReplayFile,
  parseMetadataLine,
  parseReplayFile,
  parseScfaHeader,
  ReplayFormatError,
} from '../src/main/replays/replayFile.ts';
import { ReplayRecorder } from '../src/main/replays/replayRecorder.ts';
import { replayListParams, toVaultReplay } from '../src/main/replays/vaultReplays.ts';
import { parseWatchedReplays, withWatchedReplay } from '../src/main/replays/watchedReplays.ts';
import { matchQuality } from '../src/shared/trueskill.ts';

/** Writes the binary header of a `.scfareplay` the way Forged Alliance does. */
class StreamWriter {
  private readonly parts: Buffer[] = [];

  string(value: string): this {
    this.parts.push(Buffer.from(value, 'utf8'), Buffer.from([0]));
    return this;
  }

  byte(value: number): this {
    this.parts.push(Buffer.from([value]));
    return this;
  }

  int(value: number): this {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(value);
    this.parts.push(buffer);
    return this;
  }

  lua(value: unknown): this {
    if (typeof value === 'number') {
      const buffer = Buffer.alloc(5);
      buffer[0] = 0;
      buffer.writeFloatLE(value, 1);
      this.parts.push(buffer);
    } else if (typeof value === 'string') {
      this.byte(1).string(value);
    } else if (typeof value === 'boolean') {
      this.byte(3).byte(value ? 1 : 0);
    } else if (value === null) {
      this.byte(2).byte(0);
    } else {
      this.byte(4);
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        this.lua(key).lua(entry);
      }
      this.byte(5);
    }
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.parts);
  }
}

const OPTIONS = {
  ScenarioFile: '/maps/dualgap_adaptive.v0012/dualgap_adaptive_scenario.lua',
  Share: 'FullShare',
  Timeouts: 3,
  CheatMult: 0.1,
  AllowObservers: false,
  RestrictedCategories: { 1: 'NUKE', 2: 'T3' },
  Ratings: { alpha: 1500 },
};

/**
 * A recording of alpha (team 2) and beta (team 3) and a civilian army. `sources` are the command sources of alpha
 * and beta; `betaRating` gives beta a rating too.
 */
function scfaStream(
  body: Buffer = Buffer.from('body of the replay'),
  { sources = [0, 1], betaRating = false }: { sources?: [number, number]; betaRating?: boolean } = {},
): Buffer {
  const header = new StreamWriter()
    .string('Supreme Commander v1.50.3812')
    .string('\r\n')
    .string('Replay v1.9\r\n/maps/dualgap_adaptive.v0012/dualgap_adaptive.scmap')
    .string('\r\n\x1a')
    .int(0)
    .lua({ 1: { uid: 'mod-uid-1', name: 'Sim mod' } })
    .int(0)
    .lua({ Options: OPTIONS })
    .byte(2)
    .string('alpha')
    .int(1)
    .string('beta')
    .int(2)
    .byte(0)
    .byte(3)
    // Two players with a source each, then a civilian army without one.
    .int(0)
    .lua({ PlayerName: 'alpha', Team: 2, Faction: 1, Human: true, MEAN: 1500, DEV: 100 })
    .byte(sources[0])
    .byte(255)
    .int(0)
    .lua({ PlayerName: 'beta', Team: 3, Faction: 3, Human: true, Civilian: false, ...(betaRating ? { MEAN: 1400, DEV: 120 } : {}) })
    .byte(sources[1])
    .byte(255)
    .int(0)
    .lua({ PlayerName: 'civilian', Team: 1, Faction: 5, Human: false, Civilian: true })
    .byte(255)
    .int(12345)
    .build();
  return Buffer.concat([header, body]);
}

/** An operation of the command stream: its type, its length with these three bytes, its data. */
function operation(type: number, data: Buffer): Buffer {
  const head = Buffer.alloc(3);
  head[0] = type;
  head.writeUInt16LE(data.length + 3, 1);
  return Buffer.concat([head, data]);
}

function advance(ticks: number): Buffer {
  const data = Buffer.alloc(4);
  data.writeInt32LE(ticks);
  return operation(0, data);
}

function simCallback(func: string, args: Record<string, unknown>, extra = Buffer.alloc(0)): Buffer {
  // One selected unit follows the arguments.
  return operation(22, Buffer.concat([new StreamWriter().string(func).lua(args).int(1).int(77).build(), extra]));
}

/** A chat line as the game's chat sends it: `From` is the sender's army number, -1 for observers. */
function say(from: number, sender: string, to: unknown, text: string): Buffer {
  return simCallback('GiveResourcesToPlayer', { From: from, To: from, Mass: 0, Energy: 0, Sender: sender, Msg: { to, text } });
}

const METADATA = {
  uid: 25000000,
  title: 'Team alpha vs beta',
  mapname: 'None',
  featured_mod: 'coop',
  featured_mod_versions: { 1: 3824, 2: 3830 },
  sim_mods: { 'mod-uid-1': 'Sim mod' },
  teams: { 3: ['beta'], 2: ['alpha'] },
  launched_at: 1748930954,
  game_end: 1748932661,
  complete: true,
};

describe('replay files', () => {
  it('reads the zstd format of the replay server', () => {
    const stream = scfaStream();
    const replay = parseReplayFile(encodeReplayFile(METADATA, stream));
    assert.deepEqual(replay.stream, stream);
    assert.equal(replay.metadata?.uid, 25000000);
    assert.equal(replay.metadata?.mapName, null, 'generated maps are recorded as "None"');
    assert.equal(replay.metadata?.featuredMod, 'coop');
    assert.deepEqual(replay.metadata?.featuredModVersions, [3824, 3830]);
    assert.deepEqual(replay.metadata?.teams, [
      { team: 2, players: ['alpha'] },
      { team: 3, players: ['beta'] },
    ]);
  });

  it('reads the qCompress format of older clients and bare game recordings', () => {
    const stream = scfaStream();
    const length = Buffer.alloc(4);
    length.writeUInt32BE(stream.length);
    const body = Buffer.concat([length, zlib.deflateSync(stream)]).toString('base64');
    const file = Buffer.from(`${JSON.stringify({ uid: 7, title: 'old' })}\n${body}`);
    assert.deepEqual(parseReplayFile(file).stream, stream);
    assert.deepEqual(parseReplayFile(stream), { metadata: null, stream });
  });

  it('takes the version, map, mods and armies from the game header', () => {
    const header = parseScfaHeader(scfaStream());
    assert.equal(header.gameVersion, 3812);
    assert.equal(header.mapFolderName, 'dualgap_adaptive.v0012');
    assert.deepEqual(header.simModUids, ['mod-uid-1']);
    assert.deepEqual(
      header.armies.map((army) => [army.name, army.team, army.faction, army.human, army.civilian]),
      [
        ['alpha', 2, 1, true, false],
        ['beta', 3, 3, true, false],
        ['civilian', 1, 5, false, true],
      ],
    );
    assert.equal(header.armies[0]?.mean, 1500);
  });

  it('rejects damaged files instead of reading past their end', () => {
    assert.throws(() => parseScfaHeader(scfaStream().subarray(0, 120)), ReplayFormatError);
    assert.throws(() => parseReplayFile(Buffer.from('{"compression":"lzma"}\nxxxx')), /сжатие lzma/);
    assert.throws(() => parseReplayFile(Buffer.from('{"compression":"zstd"}\nnot zstd')), ReplayFormatError);
    assert.throws(() => parseReplayFile(Buffer.from('no metadata line')), ReplayFormatError);
    assert.throws(() => parseMetadataLine(Buffer.from('{"uid":1')), ReplayFormatError);
  });

  it('lists a replay from its first line alone', () => {
    const start = encodeReplayFile({ ...METADATA, mapname: 'seton.v0003', time: 0 }, scfaStream()).subarray(0, 2000);
    const metadata = parseMetadataLine(start);
    assert.equal(metadata.mapName, 'seton.v0003');
    assert.equal(metadata.launchedAt, 1748930954, '"time" of 0 falls back to "launched_at"');
  });
});

describe('replay details', () => {
  it('returns the lobby settings of the header, sorted by key', () => {
    const stream = scfaStream();
    const header = parseScfaHeader(stream);
    assert.equal(header.options.Share, 'FullShare');
    assert.equal(stream.subarray(header.bodyOffset).toString(), 'body of the replay');
    assert.deepEqual(readReplayDetails(stream).options, [
      { key: 'AllowObservers', value: false },
      { key: 'CheatMult', value: 0.1 },
      { key: 'Ratings', value: 'alpha: 1500' },
      { key: 'RestrictedCategories', value: 'NUKE, T3' },
      { key: 'ScenarioFile', value: OPTIONS.ScenarioFile },
      { key: 'Share', value: 'FullShare' },
      { key: 'Timeouts', value: 3 },
    ]);
  });

  it('reads the chat with its game time from the commands', () => {
    const body = Buffer.concat([
      advance(600),
      say(1, 'alpha', 'all', 'gl hf'),
      simCallback('ModeratorEvent', { From: 1, Message: 'not chat' }),
      advance(25),
      say(2, 'beta', 'allies', 'push mid'),
      // An observer, a sender who is not the army's player, resources given and a damaged operation.
      say(-1, 'observer', 'all', 'hi'),
      say(1, 'beta', 'all', 'spoofed'),
      say(2, 'beta', { mass: 100 }, 'resources'),
      simCallback('GiveResourcesToPlayer', { From: 1, Sender: 'alpha', Msg: { to: 'all', text: 'cut' } }, Buffer.from([0])),
      advance(10),
      say(1, 'alpha', 'all', 'gg'),
      operation(23, Buffer.alloc(0)),
      say(1, 'alpha', 'all', 'after the end'),
    ]);
    assert.deepEqual(readReplayDetails(scfaStream(body)).chat, [
      { time: 60, sender: 'alpha', to: 'all', text: 'gl hf' },
      { time: 62, sender: 'beta', to: 'allies', text: 'push mid' },
      { time: 63, sender: 'alpha', to: 'all', text: 'gg' },
    ]);
  });

  it('matches the sender by army number or, as ReplayDataParser does, by command source', () => {
    // alpha plays army 1 from command source 1, beta army 2 from source 0.
    const body = Buffer.concat([say(1, 'alpha', 'all', 'by army'), say(1, 'beta', 'all', 'by source'), say(2, 'alpha', 'all', 'by source too')]);
    const stream = scfaStream(body, { sources: [1, 0] });
    assert.deepEqual(
      parseReplayChat(stream, parseScfaHeader(stream)).map((message) => message.text),
      ['by army', 'by source', 'by source too'],
    );
  });

  it('keeps the chat of a recording that is cut short', () => {
    const line = say(1, 'alpha', 'all', 'still running');
    const stream = scfaStream(Buffer.concat([line, line.subarray(0, 10)]));
    assert.equal(readReplayDetails(stream).chat.length, 1);
  });

  it('gives the match quality from the ratings in the header', () => {
    assert.equal(readReplayDetails(scfaStream()).quality, null, 'beta has no rating');
    const quality = readReplayDetails(scfaStream(undefined, { betaRating: true })).quality;
    const expected = matchQuality([[{ mean: 1500, deviation: 100 }], [{ mean: 1400, deviation: 120 }]]);
    assert.ok(quality !== null && expected !== null && Math.abs(quality - expected) < 1e-9);
  });
});

describe('match quality of replays', () => {
  const rated = (team: number, mean: number | null = 1500, deviation: number | null = 100) => ({ team, mean, deviation });

  it('compares two teams, and players without a team each on their own', () => {
    assert.equal(replayQuality([rated(2), rated(2, 1600), rated(3), rated(3, 1400)]), matchQuality([
      [{ mean: 1500, deviation: 100 }, { mean: 1600, deviation: 100 }],
      [{ mean: 1500, deviation: 100 }, { mean: 1400, deviation: 100 }],
    ]));
    assert.equal(replayQuality([rated(1), rated(1, 1700)]), matchQuality([[{ mean: 1500, deviation: 100 }], [{ mean: 1700, deviation: 100 }]]));
  });

  it('rates free for all too, and gives none for one side or a player without a rating', () => {
    assert.ok((replayQuality([rated(1), rated(1), rated(1)]) ?? 0) > 0);
    assert.equal(replayQuality([rated(2), rated(2)]), null);
    assert.equal(replayQuality([rated(2), rated(3, null, null)]), null);
    assert.notEqual(replayQuality([rated(2), rated(3), rated(-1, null, null)]), null, 'observers do not count');
  });
});

describe('watched replays', () => {
  it('keeps the latest ids, oldest first', () => {
    assert.deepEqual(withWatchedReplay([1, 2, 3], 4), [1, 2, 3, 4]);
    assert.deepEqual(withWatchedReplay([1, 2, 3], 1), [2, 3, 1], 'watched again, it moves to the end');
    assert.deepEqual(withWatchedReplay([1, 2, 3], 4, 3), [2, 3, 4], 'the oldest falls out past the limit');
    assert.equal(withWatchedReplay(Array.from({ length: 5000 }, (_, index) => index + 1), 9999).length, 5000);
  });

  it('drops what is not a replay id from the stored list', () => {
    assert.deepEqual(parseWatchedReplays([5, '6', 0, -1, 2.5, 7, 5]), [7, 5]);
    assert.deepEqual(parseWatchedReplays({ 1: 2 }), []);
    assert.deepEqual(parseWatchedReplays([1, 2, 3, 4], 2), [3, 4]);
  });
});

describe('replay recorder', () => {
  const game = {
    id: 99,
    title: 'Friday game',
    host: 'alpha',
    featuredMod: 'faf',
    simMods: [{ uid: 'mod-uid-1', name: 'Sim mod' }],
    mapFolderName: 'seton.v0003',
    numPlayers: 2,
    maxPlayers: 8,
    teamLogins: [{ team: 2, logins: ['alpha', 'beta'] }],
  } as RawGame;

  it('drops the request line of the game and writes a file the official client can read', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tfaf-replays-'));
    try {
      const recorder = new ReplayRecorder();
      const stream = scfaStream();
      // The request line arrives split, and the stream starts in the same chunk as its end.
      recorder.add(Buffer.from('P/99/al'));
      recorder.add(Buffer.concat([Buffer.from('pha.SCFAreplay\0'), stream.subarray(0, 10)]));
      recorder.add(stream.subarray(10));
      recorder.noteGame(game);
      recorder.noteGame(null);

      const file = await recorder.save(directory, 99, 'al/pha', '0.3.0');
      assert.equal(path.basename(file ?? ''), '99-al_pha.fafreplay');
      const replay = parseReplayFile(await readFile(file ?? ''));
      assert.deepEqual(replay.stream, stream);
      assert.equal(replay.metadata?.title, 'Friday game');
      assert.equal(replay.metadata?.mapName, 'seton.v0003');
      assert.deepEqual(replay.metadata?.simMods, [{ uid: 'mod-uid-1', name: 'Sim mod' }]);
      assert.deepEqual(replay.metadata?.teams, [{ team: 2, players: ['alpha', 'beta'] }]);
      assert.equal(replay.metadata?.recorder, 'al/pha');

      assert.equal(await new ReplayRecorder().save(directory, 100, 'alpha', '0.3.0'), null, 'nothing recorded, no file');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

/** Stands in for the WebSocket of the replay server; the test plays the server's part. */
class FakeReplayServer extends EventTarget {
  binaryType = 'blob';
  readonly sent: Buffer[] = [];
  closed = false;

  send(data: Uint8Array): void {
    this.sent.push(Buffer.from(data));
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, fields: Record<string, unknown> = {}): void {
    this.dispatchEvent(Object.assign(new Event(type), fields));
  }

  data(text: string): void {
    this.emit('message', { data: new Uint8Array(Buffer.from(text)).buffer });
  }
}

function openLive(server: FakeReplayServer): Promise<LiveReplaySource> {
  return LiveReplaySource.open(async () => 'wss://replay-ws.faforever.com/x', 7, 'alpha', {
    firstDataTimeoutMs: 1_000,
    createSocket: () => server as unknown as WebSocket,
  });
}

async function readGameStream(port: number): Promise<string> {
  const socket = net.connect(port, '127.0.0.1');
  // The game may close its side once the request line is sent; the stream must still reach it.
  socket.end('G/7/alpha.scfareplay\0');
  const chunks: Buffer[] = [];
  for await (const chunk of socket) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString();
}

describe('live replays', () => {
  it('asks for the stream before the game starts and hands the game everything the server sent', async () => {
    const server = new FakeReplayServer();
    const opening = openLive(server);
    await new Promise((resolve) => setImmediate(resolve));
    server.emit('open');
    assert.equal(server.binaryType, 'arraybuffer');
    assert.deepEqual(server.sent, [Buffer.from('G/7/alpha.scfareplay\0')]);
    server.data('header,');
    const live = await opening;
    server.data('tick 1,');

    const reading = readGameStream(live.port);
    await new Promise((resolve) => setTimeout(resolve, 50));
    server.data('tick 2');
    server.emit('close', { code: 1000, reason: '' });
    assert.equal(await reading, 'header,tick 1,tick 2');
    assert.equal(server.sent.length, 1, 'the request line of the game is not passed on');
    live.stop();
  });

  it('reports a stream the server refuses instead of starting the game', async () => {
    const server = new FakeReplayServer();
    const opening = openLive(server);
    await new Promise((resolve) => setImmediate(resolve));
    server.emit('open');
    server.emit('close', { code: 1008, reason: 'no such replay' });
    await assert.rejects(opening, /код 1008, no such replay/);
    assert.equal(server.closed, true);
  });

  it('stops waiting for the stream when the start is cancelled', async () => {
    const server = new FakeReplayServer();
    const controller = new AbortController();
    const opening = LiveReplaySource.open(async () => 'wss://replay-ws.faforever.com/x', 7, 'alpha', {
      createSocket: () => server as unknown as WebSocket,
      signal: controller.signal,
    });
    await new Promise((resolve) => setImmediate(resolve));
    server.emit('open');
    controller.abort();
    await assert.rejects(opening, CancelledError);
    assert.equal(server.closed, true);
  });
});

describe('vault replays', () => {
  it('maps a game with its players, ratings and results', () => {
    const document = resolveDocument({
      data: [
        {
          type: 'game',
          id: '25000001',
          attributes: {
            name: '2v2',
            startTime: '2026-10-20T18:00:00Z',
            endTime: '2026-10-20T18:30:00Z',
            replayTicks: 18_005,
            validity: 'VALID',
            replayAvailable: true,
          },
          relationships: {
            featuredMod: { data: { type: 'featuredMod', id: '0' } },
            mapVersion: { data: { type: 'mapVersion', id: '5' } },
            playerStats: {
              data: [
                { type: 'gamePlayerStats', id: '1' },
                { type: 'gamePlayerStats', id: '2' },
              ],
            },
          },
        },
      ],
      included: [
        { type: 'featuredMod', id: '0', attributes: { technicalName: 'faf', displayName: 'FAF' } },
        {
          type: 'mapVersion',
          id: '5',
          attributes: { folderName: 'seton.v0003', thumbnailUrlSmall: 'https://content.faforever.com/s.png' },
          relationships: { map: { data: { type: 'map', id: '9' } } },
        },
        { type: 'map', id: '9', attributes: { displayName: "Seton's Clutch" } },
        {
          type: 'gamePlayerStats',
          id: '1',
          attributes: { team: 2, faction: 'CYBRAN', ai: false, result: 'VICTORY' },
          relationships: {
            player: { data: { type: 'player', id: '11' } },
            ratingChanges: { data: [{ type: 'leaderboardRatingJournal', id: '21' }] },
          },
        },
        {
          type: 'gamePlayerStats',
          id: '2',
          attributes: { team: 3, faction: 2, ai: false, result: 'DEFEAT', beforeMean: 1400, beforeDeviation: 100 },
          relationships: { player: { data: { type: 'player', id: '12' } } },
        },
        { type: 'player', id: '11', attributes: { login: 'alpha' } },
        { type: 'player', id: '12', attributes: { login: 'beta' } },
        {
          type: 'leaderboardRatingJournal',
          id: '21',
          attributes: { meanBefore: 1500, deviationBefore: 50, meanAfter: 1520, deviationAfter: 49 },
        },
      ],
    });
    const replay = toVaultReplay(document.items[0]!);
    assert.equal(replay?.mapName, "Seton's Clutch");
    assert.equal(replay?.durationSeconds, 1801);
    assert.deepEqual(replay?.teams, [
      {
        team: 2,
        players: [{ login: 'alpha', ai: false, faction: 'cybran', ratingBefore: 1350, ratingAfter: 1373, result: 'victory' }],
      },
      {
        team: 3,
        players: [{ login: 'beta', ai: false, faction: 'aeon', ratingBefore: 1100, ratingAfter: null, result: 'defeat' }],
      },
    ]);
    assert.equal(replay?.averageRating, 1225);
    // beta's rating before the game is on the player's stats, alpha's only in the rating journal.
    assert.equal(replay?.quality, matchQuality([[{ mean: 1500, deviation: 50 }], [{ mean: 1400, deviation: 100 }]]));
  });

  it('builds the filter of each listing', () => {
    const now = Date.parse('2026-10-22T15:30:00Z');
    const page = { page: 1, pageSize: 20 } as const;
    assert.deepEqual(replayListParams({ ...page, period: 'day', sort: 'newest' }, null, now), {
      filter: 'endTime=gt="2026-10-21T15:00:00.000Z"',
      sort: '-endTime',
    });
    assert.throws(() => replayListParams({ ...page, onlyOwn: true, period: 'year', sort: 'newest' }, null, now), /вход/);
    assert.equal(
      replayListParams(
        { ...page, player: 'a"b', map: 'Seton', onlyRanked: true, onlyOwn: true, period: 'all', sort: 'newest' },
        5,
        now,
      ).filter,
      'playerStats.player.login=="a\\"b";playerStats.player.id==5;mapVersion.map.displayName=="*Seton*";validity=="VALID"',
    );
    assert.deepEqual(replayListParams({ ...page, period: 'all', sort: 'newest' }, 5, now), { sort: '-endTime' });
    assert.deepEqual(
      replayListParams({ ...page, gameId: 25000001, map: 'Seton', onlyOwn: true, period: 'day', sort: 'highestRated' }, null, now),
      { filter: 'id==25000001', sort: '-endTime' },
      'a game number leaves out the other filters',
    );
  });

  it('filters the best rated games through the game of each review summary', () => {
    const now = Date.parse('2026-10-22T15:30:00Z');
    assert.deepEqual(
      replayListParams({ page: 1, pageSize: 20, featuredMod: 'coop', period: 'week', sort: 'highestRated' }, null, now),
      {
        filter: 'game.featuredMod.technicalName=="coop";game.endTime=gt="2026-10-15T15:00:00.000Z"',
        sort: '-lowerBound',
      },
    );
  });

  it('starts the game on a replay file or a live stream', () => {
    assert.deepEqual(buildReplayArguments('C:/logs/replay_7.log', 'gpgnet://127.0.0.1:5000/7/alpha.scfareplay', 7), [
      '/init',
      'init.lua',
      '/nobugreport',
      '/log',
      'C:/logs/replay_7.log',
      '/replay',
      'gpgnet://127.0.0.1:5000/7/alpha.scfareplay',
      '/replayid',
      '7',
    ]);
    assert.equal(buildReplayArguments('log', 'file.scfareplay', null).at(-1), '-1');
  });
});
