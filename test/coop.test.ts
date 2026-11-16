import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { parseCoopLeaderboard, parseCoopScenarios } from '../src/main/coop/coopService.ts';
import { readMediaEntries, staleMediaEntries, unpackMedia } from '../src/main/game/gameMedia.ts';
import { buildZip } from './helpers/zipBuilder.ts';

function mission(id: string, order: number, folderName: string | null, name = `Mission ${id}`) {
  return {
    type: 'coopMission',
    id,
    attributes: {
      name,
      order,
      version: 3,
      description: '<p>Defend the base &amp; survive.</p>',
      folderName,
      thumbnailUrlSmall: `https://content.faforever.com/maps/previews/small/${String(folderName)}.png`,
      thumbnailUrlLarge: 'http://insecure.example/large.png',
    },
  };
}

function scenario(id: string, order: number, missionIds: string[], extra: Record<string, unknown> = {}) {
  return {
    type: 'coopScenario',
    id,
    attributes: { name: `Campaign ${id}`, order, description: null, type: 'SCFA', faction: 'AEON', ...extra },
    relationships: { maps: { data: missionIds.map((missionId) => ({ type: 'coopMission', id: missionId })) } },
  };
}

function result(id: string, gameId: string, duration: number, logins: string[], secondary = false) {
  return {
    data: { type: 'coopResult', id, attributes: { duration, secondaryObjectives: secondary, playerCount: logins.length }, relationships: { game: { data: { type: 'game', id: gameId } } } },
    included: [
      {
        type: 'game',
        id: gameId,
        attributes: { endTime: '2026-10-01T12:00:00Z' },
        relationships: { playerStats: { data: logins.map((login) => ({ type: 'gamePlayerStats', id: `${gameId}-${login}` })) } },
      },
      ...logins.map((login) => ({
        type: 'gamePlayerStats',
        id: `${gameId}-${login}`,
        attributes: {},
        relationships: { player: { data: { type: 'player', id: login } } },
      })),
      ...logins.map((login) => ({ type: 'player', id: login, attributes: { login } })),
    ],
  };
}

function leaderboardDocument(results: ReturnType<typeof result>[]) {
  return { data: results.map((entry) => entry.data), included: results.flatMap((entry) => entry.included) };
}

describe('coop missions', () => {
  it('orders campaigns and missions and leaves out what cannot be hosted', () => {
    const scenarios = parseCoopScenarios({
      data: [
        scenario('2', 2, ['21', '20']),
        scenario('1', 1, ['10', '11', '12'], { type: 'CUSTOM', faction: 'CUSTOM' }),
        scenario('3', 3, ['30']),
        scenario('4', 0, []),
      ],
      included: [
        mission('20', 2, 'x1ca_coop_002.v0021'),
        mission('21', 1, 'x1ca_coop_001.v0030'),
        mission('10', 1, 'tight_spot.v0004'),
        mission('11', 2, null),
        mission('12', 3, '../escape'),
        mission('30', 1, null),
      ],
    });

    assert.deepEqual(
      scenarios.map((entry) => [entry.id, entry.type, entry.faction, entry.missions.map((item) => item.id)]),
      [
        ['1', 'custom', 'custom', ['10']],
        ['2', 'scfa', 'aeon', ['21', '20']],
      ],
    );
    const first = scenarios[1]?.missions[0];
    assert.equal(first?.folderName, 'x1ca_coop_001.v0030');
    assert.equal(first?.description, 'Defend the base & survive.');
    assert.equal(first?.previewUrl, 'https://content.faforever.com/maps/previews/small/x1ca_coop_001.v0030.png');
    assert.equal(first?.previewLargeUrl, null);
  });

  it('keeps the fastest finish of each group of players', () => {
    const results = parseCoopLeaderboard(
      leaderboardDocument([
        result('1', '100', 1500, ['Alice', 'Bob'], true),
        result('2', '101', 1600, ['bob', 'alice']),
        result('3', '102', 1700, ['Alice']),
        result('4', '103', 1800, []),
        result('5', '104', 1900, []),
      ]),
    );

    assert.deepEqual(
      results.map((entry) => [entry.rank, entry.replayId, entry.players, entry.durationSeconds, entry.secondaryObjectives]),
      [
        [1, 100, ['Alice', 'Bob'], 1500, true],
        [2, 102, ['Alice'], 1700, false],
        [3, 103, [], 1800, false],
        [4, 104, [], 1900, false],
      ],
    );
    assert.equal(results[0]?.endedAt, '2026-10-01T12:00:00Z');
    assert.equal(parseCoopLeaderboard(leaderboardDocument([result('1', '100', 1500, ['A']), result('2', '101', 1600, ['B'])]), 1).length, 1);
  });
});

describe('coop voice-overs and videos', () => {
  let directory: string;
  let archive: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'tfaf-media-test-'));
    archive = path.join(directory, 'A01_VO.nx2');
    await writeFile(
      archive,
      buildZip([
        { name: 'movies/' },
        { name: 'movies/A01_Intro.sfd', content: 'intro video', method: 8 },
        { name: 'sounds/Voice/A01_VO.xwb', content: 'voice bank' },
        { name: 'lua/ignored.lua', content: 'not media' },
      ]),
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('finds the media of an archive and ignores other files', async () => {
    const entries = await readMediaEntries(archive);
    assert.deepEqual(
      entries.map((entry) => entry.name),
      ['movies/A01_Intro.sfd', 'sounds/Voice/A01_VO.xwb'],
    );
    const notZip = path.join(directory, 'init_coop.lua');
    await writeFile(notZip, 'path = {}');
    assert.deepEqual(await readMediaEntries(notZip), []);
  });

  it('unpacks only missing or changed files', async () => {
    const root = path.join(directory, 'data');
    const entries = await readMediaEntries(archive);
    await unpackMedia(archive, root, await staleMediaEntries(entries, root, false));

    assert.equal(await readFile(path.join(root, 'movies', 'A01_Intro.sfd'), 'utf8'), 'intro video');
    assert.equal(await readFile(path.join(root, 'sounds', 'Voice', 'A01_VO.xwb'), 'utf8'), 'voice bank');
    await assert.rejects(stat(path.join(root, 'lua', 'ignored.lua')));
    assert.deepEqual(await staleMediaEntries(entries, root, false), []);

    await writeFile(path.join(root, 'movies', 'A01_Intro.sfd'), 'cut');
    assert.deepEqual(
      (await staleMediaEntries(entries, root, false)).map((entry) => entry.name),
      ['movies/A01_Intro.sfd'],
    );
    assert.equal((await staleMediaEntries(entries, root, true)).length, 2);
  });

  it('shares the main copies with hard links and never writes through them', async () => {
    const main = path.join(directory, 'data');
    const replay = path.join(directory, 'replaydata');
    const entries = await readMediaEntries(archive);
    await unpackMedia(archive, main, entries);
    await unpackMedia(archive, replay, entries, { linkFrom: main });

    const mainVideo = path.join(main, 'movies', 'A01_Intro.sfd');
    const replayVideo = path.join(replay, 'movies', 'A01_Intro.sfd');
    assert.equal((await stat(mainVideo)).ino, (await stat(replayVideo)).ino);

    // Unpacking again replaces the link with a new file, so the main copy stays as it was.
    await writeFile(mainVideo, 'other video');
    await unpackMedia(archive, replay, entries);
    assert.equal(await readFile(replayVideo, 'utf8'), 'intro video');
    assert.equal(await readFile(mainVideo, 'utf8'), 'other video');
  });

  it('removes partly unpacked files when cancelled', async () => {
    const root = path.join(directory, 'data');
    await mkdir(path.join(root, 'movies'), { recursive: true });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(unpackMedia(archive, root, await readMediaEntries(archive), { signal: controller.signal }));
    await assert.rejects(stat(path.join(root, 'movies', 'A01_Intro.sfd')));
  });
});
