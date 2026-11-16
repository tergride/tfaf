import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { computeAiRating, launchDigest, resolveLaunch } from '../src/main/game/tfafLobby/launchConfig.ts';
import { dealStartSpots, type SpawnPlayer } from '../src/main/game/tfafLobby/launchSpawns.ts';
import { addMember, applyAction, createRoom, type NewMember } from '../src/main/game/tfafLobby/lobbyRoom.ts';
import { gamePackages } from '../src/main/gameOptions/gamePackages.ts';
import { ddsFromBgra } from '../src/main/game/tfafLobby/screenLogo.ts';
import { readFactions, readLobbyFactions } from '../src/main/gameOptions/factionCatalog.ts';
import { type AiRating, type LaunchCatalog, loadLaunchCatalog, readAiNames, readBuiltInAiRatings } from '../src/main/gameOptions/launchCatalog.ts';
import { GameFileSystem } from '../src/main/mapView/gameFileSystem.ts';
import type { LobbyMap, LobbyRoom, LobbySpot, Settings } from '../src/shared/contract.ts';
import { buildZip } from './helpers/zipBuilder.ts';

const HOST: NewMember = { id: 1, login: 'alpha', clan: 'TF', country: 'RU', rating: 1200, mean: 1500, deviation: 100, games: 40 };
const GUEST: NewMember = { id: 2, login: 'beta', clan: null, country: null, rating: 300, mean: 900, deviation: 200, games: 3 };
const THIRD: NewMember = { id: 3, login: 'gamma', clan: null, country: null, rating: 1000, mean: 1300, deviation: 100, games: 10 };
const FOURTH: NewMember = { id: 4, login: 'delta', clan: null, country: null, rating: 600, mean: 1100, deviation: 150, games: 20 };

/** The same numbers every run. */
function seeded(seed = 7): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

function lobbyMap(spots: LobbySpot[], adaptive = false): LobbyMap {
  return { folderName: 'theta.v0001', name: 'Theta', scenario: '/maps/theta.v0001/theta_scenario.lua', spots, adaptive };
}

// West against east: positions 1 and 2 on the left, 3 and 4 on the right.
const FOUR_SPOTS: LobbySpot[] = [
  { x: 0.1, y: 0.2 },
  { x: 0.1, y: 0.8 },
  { x: 0.9, y: 0.2 },
  { x: 0.9, y: 0.8 },
];

const AI_EASY: AiRating = { rating: 200, cheatMultiplier: 0, buildMultiplier: 0, omniBonus: 0, negativeThreshold: null, mapMultiplier: new Map([[1024, 0.9]]) };

const CATALOG: LaunchCatalog = {
  factions: ['uef', 'aeon', 'cybran', 'seraphim'],
  aiNames: new Map([
    ['uef', ['Harms', 'Gibson']],
    ['aeon', ['Rhiza']],
    ['cybran', ['Brackman']],
    ['seraphim', ['Thel']],
  ]),
  aiRatings: new Map([['easy', AI_EASY]]),
  defaults: { TeamSpawn: 'fixed', Victory: 'demoralization', UnitCap: '1000' },
  mapSize: 1024,
};

function room(spots: LobbySpot[], members: NewMember[] = [HOST, GUEST]): LobbyRoom {
  let current = createRoom({ host: members[0]!, title: 'Friday', featuredMod: 'faf', factions: ['uef', 'aeon', 'cybran', 'seraphim'], map: lobbyMap(spots), simMods: [{ uid: 'sim-1', name: 'Sim' }] });
  for (const [index, member] of members.slice(1).entries()) {
    current = applyAction(addMember(current, member), member.id, { type: 'takeSpot', spot: index + 2 });
  }
  return current;
}

function withOptions(current: LobbyRoom, options: Record<string, string>): LobbyRoom {
  return Object.entries(options).reduce((next, [key, value]) => applyAction(next, current.hostId, { type: 'setOption', key, value }), current);
}

describe('AI rating', () => {
  it('weighs the base rating by the map and the cheats, as ComputeAIRating does', () => {
    assert.equal(computeAiRating(AI_EASY, {}, 1024), 180);
    assert.equal(computeAiRating(AI_EASY, {}, 300), 200);
    assert.equal(computeAiRating({ ...AI_EASY, cheatMultiplier: 100, omniBonus: 50 }, { CheatMult: '1.5', OmniCheat: 'on' }, 512), 300);
    assert.equal(computeAiRating({ ...AI_EASY, rating: -100, negativeThreshold: -50 }, {}, 512), -60);
    assert.equal(computeAiRating(undefined, {}, 512), 0);
    assert.equal(computeAiRating(AI_EASY, {}, null), 0);
  });
});

describe('launch of a room', () => {
  it('plays every default of the game with the room and its locked options on top', () => {
    const launch = resolveLaunch(withOptions(room(FOUR_SPOTS), { UnitCap: '1500' }), CATALOG, seeded());
    assert.equal(launch.options.UnitCap, '1500');
    assert.equal(launch.options.TeamSpawn, 'fixed');
    assert.equal(launch.options.Unranked, 'Yes');
    assert.equal(launch.options.RandomMap, 'Off');
    assert.equal(launch.options.AutoTeams, 'none');
    assert.equal(launch.options.ScenarioFile, '/maps/theta.v0001/theta_scenario.lua');
    assert.equal(launch.options.Title, '[TFAF] Friday');
    assert.deepEqual(launch.simMods, ['sim-1']);
    assert.equal(launch.positionGroups, null);
    assert.equal(launch.spawnMex, null);
  });

  it('turns a match without two sides into a sandbox', () => {
    assert.equal(resolveLaunch(room(FOUR_SPOTS, [HOST]), CATALOG, seeded()).options.Victory, 'sandbox');
    assert.equal(resolveLaunch(room(FOUR_SPOTS), CATALOG, seeded()).options.Victory, 'demoralization');
  });

  it('deals a random faction out of those the map allows on the position, and keeps a chosen one', () => {
    let current = room(FOUR_SPOTS.map((spot, index) => (index === 0 ? { ...spot, factions: ['cybran'] } : spot)));
    current = applyAction(current, 2, { type: 'setFaction', spot: 2, faction: 2 });
    const launch = resolveLaunch(current, CATALOG, seeded());
    assert.equal(launch.armies.find((army) => army.playerId === 1)?.faction, 3);
    assert.equal(launch.armies.find((army) => army.playerId === 2)?.faction, 2);
  });

  it('names AIs after their faction, each name once, and rates them for the map', () => {
    let current = room(FOUR_SPOTS);
    for (const spot of [3, 4]) {
      current = applyAction(current, 1, { type: 'addAi', spot, personality: 'easy', name: 'AI: Easy' });
      current = applyAction(current, 1, { type: 'setFaction', spot, faction: 1 });
    }
    const ais = resolveLaunch(current, CATALOG, seeded()).armies.filter((army) => army.ai !== null);
    assert.deepEqual(ais.map((army) => army.name).sort(), ['Gibson (AI: Easy)', 'Harms (AI: Easy)']);
    assert.deepEqual(ais.map((army) => [army.mean, army.deviation, army.rating]), [
      [180, 0, 180],
      [180, 0, 180],
    ]);
  });

  it('carries what the room knows of its players into the match', () => {
    const host = resolveLaunch(room(FOUR_SPOTS), CATALOG, seeded()).armies[0]!;
    assert.deepEqual(
      { name: host.name, clan: host.clan, country: host.country, mean: host.mean, deviation: host.deviation, rating: host.rating, games: host.games },
      { name: 'alpha', clan: 'TF', country: 'RU', mean: 1500, deviation: 100, rating: 1200, games: 40 },
    );
  });

  it('deals the positions out when the room does not fix them, and tells the simulation how to shuffle them', () => {
    const current = withOptions(room(FOUR_SPOTS, [HOST, GUEST, THIRD, FOURTH]), { TeamSpawn: 'balanced' });
    const launch = resolveLaunch(applyAction(current, 1, { type: 'setAutoTeams', mode: 'lvsr' }), CATALOG, seeded());
    assert.equal(launch.options.AutoTeams, 'lvsr');
    assert.deepEqual(launch.positionGroups, [
      [1, 2],
      [3, 4],
    ]);
    assert.ok(typeof launch.options.Quality === 'number' && launch.options.Quality > 0);
    assert.deepEqual(launch.armies.map((army) => army.spot), [1, 2, 3, 4]);
    // Each side of the map is one team.
    assert.equal(launch.armies[0]!.team, launch.armies[1]!.team);
    assert.equal(launch.armies[2]!.team, launch.armies[3]!.team);
    assert.notEqual(launch.armies[0]!.team, launch.armies[2]!.team);
    // The strongest and the weakest play together.
    const teamOf = (id: number): number => launch.armies.find((army) => army.playerId === id)!.team;
    assert.equal(teamOf(1), teamOf(2));
  });

  it('keeps the mass points of closed positions on an adaptive map', () => {
    let current = room(FOUR_SPOTS);
    current = { ...current, map: { ...current.map, adaptive: true } };
    current = applyAction(current, 1, { type: 'closeSpot', spot: 4, closed: true, spawnMex: true });
    assert.deepEqual(resolveLaunch(current, CATALOG, seeded()).spawnMex, [4]);
  });

  it('gives the same digest to the same launch and another one to any change', () => {
    const launch = resolveLaunch(room(FOUR_SPOTS), CATALOG, seeded());
    const { digest, ...rest } = launch;
    assert.equal(launchDigest(rest), digest);
    assert.equal(launchDigest({ ...rest, options: Object.fromEntries(Object.entries(rest.options).reverse()) }), digest);
    assert.notEqual(launchDigest({ ...rest, options: { ...rest.options, UnitCap: '500' } }), digest);
  });
});

describe('start positions', () => {
  const players = (teams: number[]): SpawnPlayer[] => teams.map((team, index) => ({ spot: index + 1, team, mean: 1500 - index * 100, deviation: 100 }));

  it('stay as the room seats them on fixed positions and with the autobalance', () => {
    for (const teamSpawn of ['fixed', 'penguin_autobalance']) {
      assert.equal(dealStartSpots({ teamSpawn, autoTeams: 'none', spots: FOUR_SPOTS, closed: new Set(), manualTeams: [], players: players([2, 3]), random: seeded() }), null);
    }
  });

  it('give every player without a team a team of their own on random positions', () => {
    const dealt = dealStartSpots({ teamSpawn: 'random', autoTeams: 'none', spots: FOUR_SPOTS, closed: new Set([4]), manualTeams: [], players: players([1, 1, 1]), random: seeded() })!;
    assert.deepEqual(dealt.positionGroups, [[1, 2, 3]]);
    assert.deepEqual([...dealt.seats.values()].map((seat) => seat.spot).sort((a, b) => a - b), [1, 2, 3]);
    assert.deepEqual([...dealt.seats.values()].map((seat) => seat.team).sort((a, b) => a - b), [2, 3, 4]);
    assert.equal(dealt.quality > 0, true);
  });

  it('mirror the positions of the teams by the strength of their players', () => {
    const dealt = dealStartSpots({
      teamSpawn: 'balanced_reveal_mirrored',
      autoTeams: 'lvsr',
      spots: FOUR_SPOTS,
      closed: new Set(),
      manualTeams: [],
      players: players([2, 2, 3, 3]),
      random: seeded(3),
    })!;
    const bySpot = new Map([...dealt.seats].map(([from, seat]) => [seat.spot, 1500 - (from - 1) * 100]));
    // The stronger player of each side has the same place on it: both on top or both at the bottom.
    const westTop = bySpot.get(1)! > bySpot.get(2)!;
    const eastTop = bySpot.get(3)! > bySpot.get(4)!;
    assert.equal(westTop, eastTop);
  });
});

describe('launch catalog', () => {
  it('reads the AI types GetAItypes builds, the cheating ones included', () => {
    const ratings = readBuiltInAiRatings(`function GetAItypes()
    local aitypes = {
        { key = 'easy', name = "AI: Easy", rating = 200, ratingMapMultiplier = { [256] = 1.0, [1024] = 0.9 } },
    }
    local AIFiles = DiskFindFiles('/lua/AI/CustomAIs_v2', '*.lua')
    for i, v in AIFiles do
        table.insert(aitypes, v)
    end
    table.insert(aitypes, { key = 'rushcheat', name = "AIx: Rush", rating = 450, ratingCheatMultiplier = 100.0, ratingNegativeThreshold = -50 })
    return aitypes
end`);
    assert.deepEqual([...ratings.keys()], ['easy', 'rushcheat']);
    assert.equal(ratings.get('easy')!.mapMultiplier.get(1024), 0.9);
    assert.equal(ratings.get('rushcheat')!.cheatMultiplier, 100);
    assert.equal(ratings.get('rushcheat')!.negativeThreshold, -50);
  });

  it('reads the AI names with what a hook merges into them', () => {
    const names = readAiNames(`ainames = { uef = { "Harms" }, aeon = { "Rhiza" } }\nainames = table.merged( ainames, {\n    nomads = { 'Vantoga', 'Bananana' },\n} )`);
    assert.deepEqual(Object.fromEntries(names), { uef: ['Harms'], aeon: ['Rhiza'], nomads: ['Vantoga', 'Bananana'] });
  });

  describe('custom factions', () => {
    let workDir = '';
    before(async () => {
      workDir = await mkdtemp(path.join(tmpdir(), 'tfaf-launch-catalog-'));
      await writeFile(
        path.join(workDir, 'lua.nmd'),
        buildZip([
          {
            name: 'lua/CustomFactions/Nomads.lua',
            content: `FactionList = { { Key = 'nomads', Category = 'NOMADS', DisplayName = "<LOC _NOMADS>Nomads", SmallIcon = "/faction_icon-sm/nomads_ico.dds" } }`,
          },
          { name: 'lua/CustomFactions/Extra.lua', content: `FactionList = { { Key = 'extra', ModsPrerequisite = { 'MOD-1' } } }` },
          { name: 'textures/ui/common/faction_icon-sm/nomads_ico.dds', content: ddsFromBgra(2, 1, new Uint8Array([10, 20, 30, 255, 40, 50, 60, 128])) },
        ]),
      );
    });
    after(() => rm(workDir, { recursive: true, force: true }));

    it('follow the four of the game, and need the mods they ask for', async () => {
      const files = new GameFileSystem({ get: () => ({ dataPath: workDir, gamePath: null }) as Settings, mapsDirectory: workDir }, () => ({
        archives: [path.join(workDir, 'lua.nmd')],
        hooks: [],
      }));
      assert.deepEqual(await readFactions(files, []), ['uef', 'aeon', 'cybran', 'seraphim', 'nomads']);
      assert.deepEqual(await readFactions(files, ['mod-1']), ['uef', 'aeon', 'cybran', 'seraphim', 'extra', 'nomads']);
      const shown = await readLobbyFactions(files, [], (text) => text.replace(/^<LOC [^>]*>/, ''));
      const nomads = shown.at(-1)!;
      assert.deepEqual([nomads.key, nomads.name, nomads.icon?.width, nomads.icon?.height], ['nomads', 'Nomads', 2, 1]);
      assert.equal(shown[0]!.icon, null);
    });
  });

  const installed = path.join('C:', 'ProgramData', 'TFAF');
  it('reads the files of the installed FAF', { skip: !existsSync(path.join(installed, 'gamedata', 'lua.nx2')) }, async () => {
    const files = new GameFileSystem({ get: () => ({ dataPath: installed, gamePath: null }) as Settings, mapsDirectory: installed }, ({ dataPath }) =>
      gamePackages('faf', dataPath, null),
    );
    const catalog = await loadLaunchCatalog({ files, mapFolder: null, modFolders: [], simModUids: [] });
    assert.deepEqual(catalog.factions, ['uef', 'aeon', 'cybran', 'seraphim']);
    assert.ok(['uef', 'aeon', 'cybran', 'seraphim'].every((key) => (catalog.aiNames.get(key)?.length ?? 0) > 10));
    assert.ok(catalog.aiRatings.get('adaptive')?.rating);
    assert.equal(catalog.aiRatings.get('adaptive')!.mapMultiplier.get(1024), 0.9);
    assert.ok([...catalog.aiRatings.keys()].some((key) => key.endsWith('cheat')));
    assert.ok('TeamSpawn' in catalog.defaults && 'Victory' in catalog.defaults);
  });
});
