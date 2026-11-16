import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { LobbyNotice, LobbyState, MatchmakerPrefs, MatchmakerState } from '../src/shared/contract.ts';
import type { GameLaunch, LobbyMessage, LobbyPlayer } from '../src/main/lobby/lobbyProtocol.ts';
import { applyVeto, bracketForRating, parseMapPool, parseQueueDefinitions, queueTitle, vetoProblem } from '../src/main/matchmaker/mapPools.ts';
import {
  parseFactions,
  parseMatchmakerInfo,
  parsePartyInfo,
  parseSearchInfo,
  parseVetoesInfo,
  partyChannelName,
  vetoesMessage,
} from '../src/main/matchmaker/matchmakerProtocol.ts';
import { type MatchmakerDependencies, MatchmakerService } from '../src/main/matchmaker/matchmakerService.ts';
import { NotificationCenter } from '../src/main/notifications.ts';
import { checkGeneratorVersion, generatorArguments, generatorDownloadUrl, parseGeneratedMapName } from '../src/main/vault/mapGenerator.ts';

const settle = (ms = 150): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('matchmaker messages', () => {
  it('reads the queues with their pop time from the time left', () => {
    const now = Date.parse('2026-10-23T12:00:00Z');
    const queues = parseMatchmakerInfo(
      {
        command: 'matchmaker_info',
        queues: [
          { queue_name: 'ladder1v1', queue_pop_time: '2026-10-23T11:00:00+00:00', queue_pop_time_delta: 42.5, team_size: 1, num_players: 7 },
          { queue_name: 'tmm2v2', queue_pop_time: '2026-10-23T12:01:00+00:00', team_size: 2, num_players: 0 },
          { queue_name: 'bad name', team_size: 1 },
        ],
      },
      now,
    );
    assert.deepEqual(queues, [
      { name: 'ladder1v1', teamSize: 1, playersInQueue: 7, popAt: '2026-10-23T12:00:42.500Z' },
      { name: 'tmm2v2', teamSize: 2, playersInQueue: 0, popAt: '2026-10-23T12:01:00.000Z' },
    ]);
  });

  it('reads searches, parties and vetoes', () => {
    assert.deepEqual(parseSearchInfo({ command: 'search_info', queue_name: 'tmm2v2', state: 'start' }), { queue: 'tmm2v2', searching: true });
    assert.equal(parseSearchInfo({ command: 'search_info', queue_name: 'tmm2v2', state: 'maybe' }), null);
    assert.deepEqual(parseFactions(['seraphim', 'UEF', 3, 'nomad', 9]), ['uef', 'cybran', 'seraphim']);
    assert.deepEqual(
      parsePartyInfo({ command: 'update_party', owner: 5, members: [{ player: 5, factions: ['aeon'] }, { player: 'x' }, { player: 7 }] }),
      { owner: 5, members: [{ playerId: 5, factions: ['aeon'] }, { playerId: 7, factions: [] }] },
    );
    assert.deepEqual(
      parseVetoesInfo({
        command: 'vetoes_info',
        forced: true,
        vetoes: [
          { map_pool_map_version_id: 11, veto_tokens_applied: 2, matchmaker_queue_map_pool_id: 3 },
          { map_pool_map_version_id: 12, veto_tokens_applied: 0, matchmaker_queue_map_pool_id: 3 },
        ],
      }),
      { forced: true, vetoes: [{ bracketId: 3, assignmentId: 11, tokens: 2 }] },
    );
    assert.deepEqual(vetoesMessage([{ bracketId: 3, assignmentId: 11, tokens: 2 }]), {
      command: 'set_player_vetoes',
      vetoes: [{ map_pool_map_version_id: 11, veto_tokens_applied: 2, matchmaker_queue_map_pool_id: 3 }],
    });
    assert.equal(partyChannelName('Tergride'), "#Tergride'sParty");
  });
});

const QUEUES_DOCUMENT = {
  data: [
    { type: 'matchmakerQueue', id: '1', attributes: { technicalName: 'ladder1v1', teamSize: 1 }, relationships: { leaderboard: { data: { type: 'leaderboard', id: '2' } } } },
    { type: 'matchmakerQueue', id: '2', attributes: { technicalName: 'tmm2v2', teamSize: 2 }, relationships: { leaderboard: { data: { type: 'leaderboard', id: '3' } } } },
  ],
  included: [
    { type: 'leaderboard', id: '2', attributes: { technicalName: 'ladder_1v1' } },
    { type: 'leaderboard', id: '3', attributes: { technicalName: 'tmm_2v2' } },
  ],
};

function assignment(id: number, bracket: number, version: number | null, params: unknown = null) {
  return {
    type: 'mapPoolAssignment',
    id: String(id),
    attributes: { weight: 1, mapParams: params },
    relationships: {
      mapPool: { data: { type: 'mapPool', id: String(bracket) } },
      mapVersion: { data: version === null ? null : { type: 'mapVersion', id: String(version) } },
    },
  };
}

const POOL_DOCUMENT = {
  data: [
    assignment(101, 10, 1001),
    assignment(102, 10, 1002),
    assignment(103, 10, null, { type: 'neroxis', size: 512, spawns: 2, version: '1.22.2' }),
    assignment(201, 20, 1002),
  ],
  included: [
    { type: 'mapPool', id: '10', relationships: { matchmakerQueueMapPool: { data: { type: 'matchmakerQueueMapPool', id: '30' } } } },
    { type: 'mapPool', id: '20', relationships: { matchmakerQueueMapPool: { data: { type: 'matchmakerQueueMapPool', id: '40' } } } },
    { type: 'matchmakerQueueMapPool', id: '30', attributes: { minRating: null, maxRating: 800, vetoTokensPerPlayer: 3, maxTokensPerMap: 1 } },
    { type: 'matchmakerQueueMapPool', id: '40', attributes: { minRating: 800, maxRating: null, vetoTokensPerPlayer: 2, maxTokensPerMap: 0 } },
    { type: 'mapVersion', id: '1001', attributes: { folderName: 'big_map.v0001', width: 1024, height: 1024, maxPlayers: 2, thumbnailUrlSmall: 'https://content.faforever.com/a.png' }, relationships: { map: { data: { type: 'map', id: '1' } } } },
    { type: 'mapVersion', id: '1002', attributes: { folderName: 'small_map.v0003', width: 256, height: 256, maxPlayers: 2, thumbnailUrlSmall: 'http://insecure/a.png' }, relationships: { map: { data: { type: 'map', id: '2' } } } },
    { type: 'map', id: '1', attributes: { displayName: 'Big Map' } },
    { type: 'map', id: '2', attributes: { displayName: 'Small Map' } },
  ],
};

describe('map pools', () => {
  it('groups the maps into rating brackets, generated maps last', () => {
    assert.deepEqual(parseQueueDefinitions(QUEUES_DOCUMENT), [
      { id: 1, name: 'ladder1v1', teamSize: 1, leaderboard: 'ladder_1v1' },
      { id: 2, name: 'tmm2v2', teamSize: 2, leaderboard: 'tmm_2v2' },
    ]);
    const brackets = parseMapPool(POOL_DOCUMENT);
    assert.deepEqual(
      brackets.map((bracket) => [bracket.id, bracket.minRating, bracket.maxRating, bracket.maps.map((map) => map.folderName ?? map.displayName)]),
      [
        [30, null, 800, ['small_map.v0003', 'big_map.v0001', 'Сгенерированная карта']],
        [40, 800, null, ['small_map.v0003']],
      ],
    );
    const small = brackets[0]!.maps[0]!;
    assert.equal(small.displayName, 'Small Map');
    assert.equal(small.previewUrl, null, 'only https thumbnails are shown');
    assert.deepEqual(brackets[0]!.maps[2]!.generated, { size: 512, spawns: 2, version: '1.22.2' });
    assert.equal(queueTitle('tmm4v4_share_until_death', 4), '4v4 No Share');
    assert.equal(queueTitle('tmm5v5', 5), '5v5 (tmm5v5)');
  });

  it('finds the bracket of a rating with bounds that do not include it', () => {
    const brackets = parseMapPool(POOL_DOCUMENT);
    assert.equal(bracketForRating(brackets, 300)?.id, 30);
    assert.equal(bracketForRating(brackets, 1500)?.id, 40);
    assert.equal(bracketForRating(brackets, 800), null);
    assert.equal(bracketForRating(brackets, null), null);
  });

  it('keeps vetoes within the tokens of a bracket and of a map', () => {
    const [limited, dynamic] = parseMapPool(POOL_DOCUMENT);
    const vetoes = [{ bracketId: 30, assignmentId: 101, tokens: 1 }];
    assert.equal(vetoProblem(limited!, vetoes, 102, 1), null);
    assert.match(vetoProblem(limited!, vetoes, 102, 2) ?? '', /не больше 1/);
    assert.match(vetoProblem(limited!, [...vetoes, { bracketId: 30, assignmentId: 102, tokens: 1 }], 103, 2) ?? '', /не больше 1/);
    assert.match(vetoProblem(dynamic!, [], 201, 3) ?? '', /всего 2/);
    assert.equal(vetoProblem(dynamic!, [], 201, 2), null, 'without a per-map limit all tokens may go on one map');
    assert.match(vetoProblem(dynamic!, [], 999, 1) ?? '', /нет в этом пуле/);
    assert.deepEqual(applyVeto(vetoes, 30, 101, 0), []);
    assert.deepEqual(applyVeto(vetoes, 30, 102, 1), [...vetoes, { bracketId: 30, assignmentId: 102, tokens: 1 }]);
  });
});

describe('map generator', () => {
  it('reads the version and the seed from a generated map name', () => {
    assert.deepEqual(parseGeneratedMapName('neroxis_map_generator_1.12.0_bmxq2zkxmi2gm_aidaaaa'), {
      version: '1.12.0',
      major: 1,
      seed: 'bmxq2zkxmi2gm_aidaaaa',
    });
    assert.equal(parseGeneratedMapName('neroxis_map_generator_1.12.0_../../evil'), null);
    assert.equal(parseGeneratedMapName('scmp_015'), null);
    assert.throws(() => checkGeneratorVersion('2.0.0'), /не поддерживается/);
    assert.throws(() => checkGeneratorVersion('1.0'), /Некорректная/);
    assert.equal(generatorDownloadUrl('1.22.2'), 'https://github.com/FAForever/Neroxis-Map-Generator/releases/download/1.22.2/NeroxisGen_1.22.2.jar');
  });

  it('builds the command of the official client for both generator generations', () => {
    const modern = parseGeneratedMapName('neroxis_map_generator_1.22.2_abc')!;
    assert.deepEqual(generatorArguments('C:\\gen.jar', 'neroxis_map_generator_1.22.2_abc', modern), [
      '-jar', 'C:\\gen.jar', '--map-name', 'neroxis_map_generator_1.22.2_abc',
    ]);
    const old = parseGeneratedMapName('neroxis_map_generator_0.7.1_12345')!;
    assert.deepEqual(generatorArguments('C:\\gen.jar', 'neroxis_map_generator_0.7.1_12345', old), [
      '-jar', 'C:\\gen.jar', '.', '12345', '0.7.1', 'neroxis_map_generator_0.7.1_12345',
    ]);
  });
});

function player(id: number, login: string, rating = 1000): LobbyPlayer {
  return { id, login, clan: null, country: 'RU', ratings: new Map([['ladder_1v1', { mean: rating, deviation: 0 }], ['tmm_2v2', { mean: rating, deviation: 0 }]]), numberOfGames: 10, avatar: null };
}

/** The lobby server and everything around the matchmaker, played by the test. */
class Harness {
  readonly sent: LobbyMessage[] = [];
  readonly notices: LobbyNotice[] = [];
  readonly shown: string[] = [];
  readonly launches: { launch: GameLaunch; title: string }[] = [];
  readonly installed: string[] = [];
  readonly prepared: string[] = [];
  readonly sounds: string[] = [];
  readonly notifications = new NotificationCenter({ onChanged: () => {}, onAdded: () => {} });
  readonly channels: (string | null)[] = [];
  readonly players = new Map<number, LobbyPlayer>([[1, player(1, 'Tergride')], [2, player(2, 'Kolya')]]);
  readonly friends = new Set<number>();
  readonly inGame = new Set<number>();
  aborted = 0;
  gamePhase: 'idle' | 'running' = 'idle';
  state: LobbyState = { status: 'disconnected', error: null };
  prefs: MatchmakerPrefs = { factions: ['uef', 'aeon', 'cybran', 'seraphim'], unselectedQueues: [], vetoes: [] };
  latest: MatchmakerState | null = null;
  emitted = 0;
  guard: () => string | null = () => null;
  private stateListener: (state: LobbyState) => void = () => {};
  private messageListener: (message: LobbyMessage) => void = () => {};
  private launchHandler: ((launch: GameLaunch) => boolean) | null = null;
  readonly service: MatchmakerService;

  constructor(gamePath: string) {
    const deps: MatchmakerDependencies = {
      api: {
        getCached: async (route: string) => {
          if (route === '/data/matchmakerQueue') {
            return QUEUES_DOCUMENT;
          }
          throw new Error(`unexpected ${route}`);
        },
        getAll: async (route: string) => {
          if (route === '/data/mapPoolAssignment') {
            return POOL_DOCUMENT;
          }
          throw new Error(`unexpected ${route}`);
        },
      },
      lobby: {
        getState: () => this.state,
        onStateChanged: (listener) => {
          this.stateListener = listener;
          return () => {};
        },
        onServerMessage: (listener) => {
          this.messageListener = listener;
          return () => {};
        },
        onGameChanged: () => () => {},
        send: (message) => {
          if (this.state.status !== 'connected') {
            throw new Error('offline');
          }
          this.sent.push(message);
        },
        getSelf: () => this.players.get(1) ?? null,
        getPlayer: (id) => this.players.get(id) ?? null,
        findPlayers: (query) => [...this.players.values()].filter((entry) => entry.login.toLowerCase().includes(query.toLowerCase())),
        getSocial: () => ({ channels: [], friends: this.friends, foes: new Set() }),
        isPlayerInGame: (id) => this.inGame.has(id),
        countMatchmakerGames: (leaderboard) => (leaderboard === 'ladder_1v1' ? 4 : 0),
        setLaunchHandler: (handler) => {
          this.launchHandler = handler;
        },
      },
      settings: {
        get: () => ({ gamePath, matchmaker: this.prefs }) as ReturnType<MatchmakerDependencies['settings']['get']>,
        setMatchmakerPrefs: async (prefs) => {
          this.prefs = prefs;
        },
      },
      games: {
        getState: () => ({ phase: this.gamePhase }) as ReturnType<MatchmakerDependencies['games']['getState']>,
        setGuard: (guard) => {
          this.guard = guard;
        },
        launchMatchmaker: (launch, title) => {
          this.launches.push({ launch, title });
          return true;
        },
        abortMatchmaker: () => {
          this.aborted++;
          return true;
        },
        prepareAdapter: async () => {},
      },
      maps: {
        ensureInstalled: async (folder) => {
          await settle(5);
          this.installed.push(folder);
        },
      },
      generator: {
        prepare: async (version) => {
          this.prepared.push(version);
        },
      },
      updater: { update: async () => ({}) as Awaited<ReturnType<MatchmakerDependencies['updater']['update']>> },
      tasks: { within: (_scope, work) => work() },
      chat: { setPartyChannel: (name) => this.channels.push(name) },
      notifier: {
        show: (notice) => {
          this.shown.push(notice.title);
          return true;
        },
      },
      notifications: this.notifications,
      sounds: { play: (sound) => this.sounds.push(sound) },
    };
    this.service = new MatchmakerService(deps, {
      onState: (state) => {
        this.latest = state;
        this.emitted++;
      },
      onFocusRequested: () => {},
      onNotice: (notice) => this.notices.push(notice),
    });
  }

  connect(): void {
    this.state = { status: 'connected', error: null };
    this.stateListener(this.state);
  }

  server(message: LobbyMessage): void {
    this.messageListener(message);
  }

  launch(launch: GameLaunch): boolean {
    return this.launchHandler?.(launch) ?? false;
  }

  commands(): string[] {
    return this.sent.map((message) => (message.command === 'game_matchmaking' ? `${message.command}:${String(message.queue_name)}:${String(message.state)}` : message.command));
  }
}

const QUEUES: LobbyMessage = {
  command: 'matchmaker_info',
  queues: [
    { queue_name: 'ladder1v1', queue_pop_time_delta: 30, team_size: 1, num_players: 5 },
    { queue_name: 'tmm2v2', queue_pop_time_delta: 30, team_size: 2, num_players: 2 },
  ],
};

const LAUNCH: GameLaunch = {
  uid: 777,
  featuredMod: 'faf',
  name: 'Tergride Vs Someone',
  mapName: 'small_map.v0003',
  leaderboard: 'ladder_1v1',
  gameType: 'matchmaker',
  args: [],
  expectedPlayers: 2,
  mapPosition: 1,
  team: 2,
  faction: 'uef',
  gameOptions: null,
};

describe('MatchmakerService', () => {
  let gamePath = '';

  before(async () => {
    gamePath = await mkdtemp(path.join(os.tmpdir(), 'tfaf-mm-'));
    await mkdir(path.join(gamePath, 'bin'));
    await writeFile(path.join(gamePath, 'bin', 'ForgedAlliance.exe'), '');
  });

  after(async () => {
    await rm(gamePath, { recursive: true, force: true });
  });

  it('sends factions and vetoes on connect and lists the queues with the player rating', async () => {
    const harness = new Harness(gamePath);
    harness.prefs = { ...harness.prefs, vetoes: [{ bracketId: 30, assignmentId: 101, tokens: 1 }] };
    harness.connect();
    assert.deepEqual(harness.commands(), ['set_party_factions', 'set_player_vetoes', 'matchmaker_info']);
    harness.server(QUEUES);
    await settle();
    const state = harness.service.getState();
    assert.deepEqual(
      state.queues.map((queue) => [queue.name, queue.title, queue.fits, queue.selected, queue.rating, queue.activeGames, queue.playersInQueue]),
      [
        ['ladder1v1', '1v1', true, true, 1000, 4, 5],
        ['tmm2v2', '2v2', true, true, 1000, 0, 2],
      ],
    );
    assert.equal(state.blocker, null);
    assert.equal(state.party[0]?.owner, true);
  });

  it('tells the renderer only what changed, and nothing while paused', async () => {
    const harness = new Harness(gamePath);
    harness.connect();
    harness.server(QUEUES);
    await settle();
    const emitted = harness.emitted;
    harness.service.refresh();
    await settle();
    assert.equal(harness.emitted, emitted, 'the same state again');

    harness.service.setUpdatesPaused(true);
    harness.server({ command: 'search_info', queue_name: 'ladder1v1', state: 'start' });
    await settle();
    assert.equal(harness.emitted, emitted, 'held back');

    harness.service.setUpdatesPaused(false);
    await settle();
    assert.equal(harness.emitted, emitted + 1);
    assert.equal(harness.latest?.searching, true);
  });

  it('downloads the pool maps and the generator before it joins the queues, then follows the search', async () => {
    const harness = new Harness(gamePath);
    harness.connect();
    harness.server(QUEUES);
    await harness.service.setQueueSelected('tmm2v2', false);
    harness.sent.length = 0;
    const search = harness.service.startSearch();
    assert.equal(harness.guard() !== null, true, 'other games wait while the maps download');
    await search;
    assert.deepEqual(harness.installed.sort(), ['big_map.v0001', 'small_map.v0003']);
    assert.deepEqual(harness.prepared, ['1.22.2']);
    assert.deepEqual(harness.commands(), ['game_matchmaking:ladder1v1:start']);

    harness.server({ command: 'search_info', queue_name: 'ladder1v1', state: 'start' });
    await settle();
    assert.equal(harness.latest?.searching, true);
    assert.equal(harness.latest?.queues.find((queue) => queue.name === 'ladder1v1')?.status, 'searching');
    assert.match(harness.guard() ?? '', /поиск матча/);

    harness.service.stopSearch();
    assert.deepEqual(harness.commands().at(-1), 'game_matchmaking:ladder1v1:stop');
  });

  it('joins nothing when the search is stopped while the maps download', async () => {
    const harness = new Harness(gamePath);
    harness.connect();
    harness.server(QUEUES);
    harness.sent.length = 0;
    const search = harness.service.startSearch();
    assert.notEqual(harness.service.getState().preparing, null);
    harness.service.stopSearch();
    await search;
    assert.deepEqual(harness.commands(), []);
    assert.equal(harness.service.getState().preparing, null);
    assert.equal(harness.guard(), null);
    assert.deepEqual(harness.notices, []);
  });

  it('starts the game of a found match and stops it when the server cancels the match', async () => {
    const harness = new Harness(gamePath);
    harness.connect();
    harness.server(QUEUES);
    await settle();
    harness.server({ command: 'search_info', queue_name: 'ladder1v1', state: 'start' });
    harness.server({ command: 'match_found', queue_name: 'ladder1v1' });
    assert.deepEqual(harness.sounds, ['matchFound']);
    assert.deepEqual(harness.shown, ['Матч найден']);
    assert.match(harness.guard() ?? '', /Матч найден/);
    assert.equal(harness.service.getState().queues[0]?.status, 'matchFound');
    assert.equal(harness.service.getState().searching, false);

    assert.equal(harness.launch({ ...LAUNCH, gameType: 'custom' }), false, 'other launches are not the matchmaker’s');
    assert.equal(harness.launch(LAUNCH), true);
    assert.deepEqual(harness.launches.map((entry) => [entry.launch.uid, entry.title]), [[777, 'Матчмейкер 1v1']]);
    assert.equal(harness.service.getState().queues[0]?.status, 'launching');

    harness.server({ command: 'match_cancelled' });
    assert.equal(harness.aborted, 1);
    assert.equal(harness.service.getState().queues[0]?.status, 'cancelled');
    assert.match(harness.notices.at(-1)?.text ?? '', /отменил матч/);
    assert.equal(harness.notices.at(-1)?.transient, true, 'the queue shows it too, the bell keeps nothing');
  });

  it('follows the party: members, leader, channel, invites and kicks', async () => {
    const harness = new Harness(gamePath);
    harness.connect();
    harness.server(QUEUES);
    harness.server({ command: 'party_invite', sender: 2 });
    let state = harness.service.getState();
    assert.deepEqual(state.invites.map((invite) => [invite.playerId, invite.login]), [[2, 'Kolya']]);
    assert.deepEqual(harness.shown, ['Приглашение в группу']);
    assert.deepEqual(
      harness.notifications.list().map((notification) => [notification.title, notification.actions.length]),
      [['Приглашение в группу', 2]],
    );

    harness.service.acceptInvite(2);
    assert.deepEqual(harness.notifications.list(), [], 'an answered invite takes its notification away');
    assert.deepEqual(harness.sent.at(-1), { command: 'accept_party_invite', sender_id: 2 });
    harness.server({ command: 'update_party', owner: 2, members: [{ player: 2, factions: ['aeon'] }, { player: 1, factions: ['uef'] }] });
    state = harness.service.getState();
    assert.deepEqual(state.party.map((member) => [member.login, member.owner, member.self]), [['Tergride', false, true], ['Kolya', true, false]]);
    assert.equal(state.isOwner, false);
    assert.equal(state.blocker, 'Поиск запускает лидер группы');
    assert.equal(state.queues.find((queue) => queue.name === 'ladder1v1')?.fits, false, 'two players do not fit a 1v1 queue');
    assert.equal(state.partyChannel, "#Kolya'sParty");
    assert.throws(() => harness.service.invite(2), /лидер группы/);
    assert.throws(() => harness.service.kick(2), /лидер группы/);

    harness.server({ command: 'kicked_from_party' });
    state = harness.service.getState();
    assert.equal(state.party.length, 1);
    assert.equal(state.partyChannel, null);
    assert.deepEqual(harness.channels, ["#Kolya'sParty", null]);
  });

  it('offers the friends who are online, and puts friends first in a search', () => {
    const harness = new Harness(gamePath);
    harness.connect();
    harness.players.set(3, player(3, 'Kolobok'));
    harness.players.set(4, player(4, 'Zed'));
    harness.friends.add(4).add(3).add(99);
    const names = (query: string): string[] => harness.service.findPlayers(query).map((entry) => `${entry.login}${entry.friend ? '*' : ''}`);
    assert.deepEqual(names(''), ['Kolobok*', 'Zed*'], 'friend 99 is offline');
    assert.deepEqual(names('kol'), ['Kolobok*', 'Kolya']);
    harness.server({ command: 'update_party', owner: 1, members: [{ player: 1, factions: [] }, { player: 3, factions: [] }] });
    assert.deepEqual(names(''), ['Zed*'], 'party members are not offered');
  });

  it('does not search while someone of the party is in a game', async () => {
    const harness = new Harness(gamePath);
    harness.connect();
    harness.server(QUEUES);
    harness.server({ command: 'update_party', owner: 1, members: [{ player: 1, factions: ['uef'] }, { player: 2, factions: ['aeon'] }] });
    harness.inGame.add(2);
    assert.equal(harness.service.getState().blocker, 'Кто-то из группы сейчас в игре');
    await assert.rejects(harness.service.startSearch(), /в игре/);
    harness.inGame.clear();
    harness.gamePhase = 'running';
    assert.equal(harness.service.getState().blocker, 'Нельзя искать матч, пока вы в игре');
  });

  it('checks vetoes against the pool and sends them', async () => {
    const harness = new Harness(gamePath);
    harness.connect();
    harness.server(QUEUES);
    const pool = await harness.service.mapPool('ladder1v1');
    assert.equal(pool.playerBracketId, 40, 'a rating of 1000 is above the first bracket');
    const updated = await harness.service.setVeto(30, 101, 1);
    assert.equal(updated.brackets[0]?.maps.find((map) => map.assignmentId === 101)?.vetoTokens, 1);
    assert.deepEqual(harness.sent.at(-1), {
      command: 'set_player_vetoes',
      vetoes: [{ map_pool_map_version_id: 101, veto_tokens_applied: 1, matchmaker_queue_map_pool_id: 30 }],
    });
    await assert.rejects(harness.service.setVeto(30, 102, 2), /не больше 1/);
    harness.server({ command: 'vetoes_info', forced: true, vetoes: [] });
    await settle(10);
    assert.deepEqual(harness.prefs.vetoes, []);
    assert.match(harness.notices.at(-1)?.text ?? '', /изменил ваши вето/);
    assert.equal(harness.notices.at(-1)?.transient, undefined, 'the server changed a saved choice, so the bell keeps it');
  });
});
