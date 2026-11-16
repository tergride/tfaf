import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildOfflineArguments } from '../src/main/game/launchCommand.ts';
import { extractLinks, htmlToText, truncate } from '../src/main/info/html.ts';
import { parseLeagues, parseScores, parseSubdivisions, rankSeason } from '../src/main/info/leagues.ts';
import { parseNews } from '../src/main/info/news.ts';
import { parseTournaments } from '../src/main/info/tournaments.ts';
import { parseTutorialCategories, parseTutorialLaunch } from '../src/main/info/tutorials.ts';
import { isOpenableLink } from '../src/main/servers.ts';

describe('html helpers', () => {
  it('turns HTML into plain text with paragraph breaks', () => {
    const text = htmlToText(
      '<p class="x">Patch &#8211; The&nbsp;Commissar&#8217;s &amp; more</p>\n\n<script>alert(1)</script><ul><li>One</li><li>Two</li></ul><p></p>',
    );
    assert.equal(text, 'Patch – The Commissar’s & more\n\n• One\n• Two');
  });

  it('cuts long text at a word boundary', () => {
    assert.equal(truncate('short', 10), 'short');
    assert.equal(truncate('one two three four', 15), 'one two three…');
  });

  it('keeps https links and names generic ones by their address', () => {
    const links = extractLinks(
      'See <a href="https://www.youtube.com/c/Heaven/">here</a>, the <a href=\'https://forum.faforever.com/t?a=1&amp;b=2\'>FAF <b>guide</b></a>, ' +
        '<a href="javascript:alert(1)">bad</a> and <a href="https://www.youtube.com/c/Heaven/">again</a>.',
    );
    assert.deepEqual(links, [
      { label: 'www.youtube.com/c/Heaven', url: 'https://www.youtube.com/c/Heaven/' },
      { label: 'FAF guide', url: 'https://forum.faforever.com/t?a=1&b=2' },
    ]);
  });

  it('keeps a link whose address has a line break in it', () => {
    // As in the tutorial "How to improve forever - 6 laws".
    const links = extractLinks('<p>You can view the guide <a href="https://forum.faforever.com/topic/1222/how-to?_=1625166213365\n">here</a>.</p>');
    assert.deepEqual(links, [
      { label: 'forum.faforever.com/topic/1222/how-to', url: 'https://forum.faforever.com/topic/1222/how-to?_=1625166213365' },
    ]);
  });

  it('reads the address after other attributes, with the other quote inside it', () => {
    const links = extractLinks(
      '<a target="_blank" href="https://faforever.com/it\'s">Its</a> <a data-x=\'1\' href=\'https://faforever.com/"quoted"\'>Quoted</a>',
    );
    assert.deepEqual(links, [
      { label: 'Its', url: "https://faforever.com/it's" },
      { label: 'Quoted', url: 'https://faforever.com/"quoted"' },
    ]);
  });
});

describe('parseNews', () => {
  it('maps the news hub feed and repairs links without a scheme', () => {
    const news = parseNews([
      {
        link: 'youtube.com/watch?v=klAL9QfAkbM',
        date: '2026-08-22T11:25:42',
        title: 'Patch #3837 &#8211; The Commissar',
        content: '<p>The video is up!</p>',
        author: 'Fichom',
        media: 'https://direct.faforever.com/wp-content/uploads/patch.jpg',
      },
      { link: 'http://example.com', title: 'Plain http', content: 'x', media: 'http://example.com/a.jpg' },
      { content: 'no title' },
    ]);
    assert.equal(news.length, 2);
    assert.deepEqual(news[0], {
      id: 'https://youtube.com/watch?v=klAL9QfAkbM',
      title: 'Patch #3837 – The Commissar',
      excerpt: 'The video is up!',
      link: 'https://youtube.com/watch?v=klAL9QfAkbM',
      date: '2026-08-22T11:25:42',
      author: 'Fichom',
      imageUrl: 'https://direct.faforever.com/wp-content/uploads/patch.jpg',
    });
    assert.equal(news[1]?.link, null);
    assert.equal(news[1]?.imageUrl, null);
    assert.equal(news[1]?.id, 'news-1');
  });

  it('rejects a feed that is not a list', () => {
    assert.throws(() => parseNews({ posts: [] }));
  });
});

describe('parseTournaments', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  const base = { published: 1, abandoned: 0, teamSize: 1, players: 4, teams: 4, bracketType: 'double' };

  it('derives the status and orders running, open, upcoming, closed and finished tournaments', () => {
    const tournaments = parseTournaments(
      [
        { ...base, id: 'f1', name: 'Old cup', status: 'finished', eventDate: '2026-07-01' },
        { ...base, id: 'f2', name: 'Recent cup', status: 'done', eventDate: '2026-10-10T14:00:00.000Z' },
        { ...base, id: 'f3', name: 'Undated cup', status: 'finished', eventDate: null },
        { ...base, id: 'o2', name: 'Later signup', status: 'signup', eventDate: '2026-12-12T14:00:00.000Z' },
        { ...base, id: 'o1', name: 'Soon signup', status: 'signup', eventDate: '2026-11-07T14:00:00.000Z' },
        { ...base, id: 'u1', name: 'Not open yet', status: 'signup', signupOpensAt: '2026-11-01T00:00:00Z' },
        { ...base, id: 'c1', name: 'Signup over', status: 'signup', signupClosesAt: '2026-10-21T00:00:00Z' },
        { ...base, id: 'c2', name: 'Teams locked', status: 'drafted' },
        { ...base, id: 'r1', name: 'Live now', status: 'running' },
        { ...base, id: 'a1', name: 'Abandoned', status: 'signup', abandoned: 1 },
        { ...base, id: 'x1', name: 'Unknown', status: 'archived' },
        { ...base, id: '../evil', name: 'Bad id', status: 'signup' },
      ],
      now,
    );
    assert.deepEqual(
      tournaments.map((tournament) => [tournament.id, tournament.status]),
      [
        ['r1', 'running'],
        ['o1', 'open'],
        ['o2', 'open'],
        ['u1', 'upcoming'],
        ['c1', 'closed'],
        ['c2', 'closed'],
        ['f2', 'finished'],
        ['f1', 'finished'],
        ['f3', 'finished'],
      ],
    );
  });

  it('keeps limits, prize and the tournament page', () => {
    const [tournament] = parseTournaments(
      [
        {
          ...base,
          id: 'b7055a2e5d',
          name: ' Super-Noob Olympics #9 ',
          status: 'signup',
          category: 'official',
          teamSize: 3,
          bracketType: 'single',
          minRating: 0,
          maxRating: 1350,
          maxTeamRating: 3750,
          prize: { currency: 'USD', amount: 150 },
          seriesName: 'Olympics',
        },
      ],
      now,
    );
    assert.equal(tournament?.name, 'Super-Noob Olympics #9');
    assert.equal(tournament?.official, true);
    assert.equal(tournament?.format, 'single');
    assert.equal(tournament?.minRating, null);
    assert.equal(tournament?.maxRating, 1350);
    assert.deepEqual(tournament?.prize, { amount: 150, currency: 'USD' });
    assert.equal(tournament?.url, 'https://tournaments.faforever.com/t/b7055a2e5d');
    assert.equal(parseTournaments([{ ...base, id: 'p', name: 'P', status: 'signup', prize: { currency: 'usd!', amount: 5 } }], now)[0]?.prize, null);
  });
});

describe('leagues', () => {
  const subdivisionsDocument = {
    data: [
      { type: 'leagueSeasonDivisionSubdivision', id: '11', attributes: { nameKey: 'II', subdivisionIndex: 1, highestScore: 10, minRating: 0, maxRating: 100 }, relationships: { leagueSeasonDivision: { data: { type: 'leagueSeasonDivision', id: '1' } } } },
      { type: 'leagueSeasonDivisionSubdivision', id: '12', attributes: { nameKey: 'I', subdivisionIndex: 2, highestScore: 10 }, relationships: { leagueSeasonDivision: { data: { type: 'leagueSeasonDivision', id: '1' } } } },
      { type: 'leagueSeasonDivisionSubdivision', id: '21', attributes: { nameKey: '', subdivisionIndex: 1, mediumImageUrl: 'https://content.faforever.com/divisions/gm.png' }, relationships: { leagueSeasonDivision: { data: { type: 'leagueSeasonDivision', id: '2' } } } },
      { type: 'leagueSeasonDivisionSubdivision', id: '99', attributes: { nameKey: 'X', subdivisionIndex: 1 } },
    ],
    included: [
      { type: 'leagueSeasonDivision', id: '1', attributes: { nameKey: 'bronze', divisionIndex: 1 } },
      { type: 'leagueSeasonDivision', id: '2', attributes: { nameKey: 'grandmaster', divisionIndex: 2 } },
    ],
  };
  const score = (id: string, loginId: number, value: number | null, subdivision: string | null) => ({
    type: 'leagueSeasonScore',
    id,
    attributes: { loginId, score: value, gameCount: 5, returningPlayer: false },
    relationships: {
      leagueSeasonDivisionSubdivision: { data: subdivision ? { type: 'leagueSeasonDivisionSubdivision', id: subdivision } : null },
    },
  });

  it('orders leagues by team size and names them like the official client', () => {
    const leagues = parseLeagues({
      data: [
        { type: 'league', id: '3', attributes: { technicalName: '4v4_full_share_league' } },
        { type: 'league', id: '5', attributes: { technicalName: '3v3_league' } },
        { type: 'league', id: '1', attributes: { technicalName: '1v1_league' } },
        { type: 'league', id: '9', attributes: { technicalName: 'ffa_league' } },
      ],
    });
    assert.deepEqual(leagues, [
      { id: '1', name: '1v1' },
      { id: '5', name: '3v3' },
      { id: '3', name: '4v4 Full Share' },
      { id: '9', name: 'ffa_league' },
    ]);
  });

  it('ranks by division, subdivision and score and leaves players in placement unranked', () => {
    const subdivisions = parseSubdivisions(subdivisionsDocument);
    assert.equal(subdivisions.length, 3, 'a subdivision without its division is dropped');
    const scores = parseScores({
      data: [
        score('1', 100, 4, '11'),
        score('2', 101, 9, '11'),
        score('3', 102, 1, '12'),
        score('4', 103, 50, '21'),
        score('5', 104, null, null),
        score('6', 105, 9, '11'),
        score('7', 106, 3, '404'),
      ],
    });
    const season = rankSeason(subdivisions, scores);

    assert.equal(season.players, 5);
    assert.deepEqual(
      [...season.byPlayer.values()].map((entry) => [entry.playerId, entry.rank, entry.subdivisionId, entry.position]),
      [
        [103, 1, '21', 0],
        [102, 2, '12', 0],
        [101, 3, '11', 0],
        [105, 4, '11', 1],
        [100, 5, '11', 2],
      ],
    );
    assert.equal(season.byPlayer.has(104), false);
    assert.deepEqual(
      season.divisions.map((division) => [division.nameKey, division.subdivisions.map((subdivision) => [subdivision.name, subdivision.players])]),
      [
        ['grandmaster', [['', 1]]],
        ['bronze', [['I', 1], ['II', 3]]],
      ],
    );
    assert.equal(season.divisions[0]?.subdivisions[0]?.imageUrl, 'https://content.faforever.com/divisions/gm.png');
  });
});

describe('tutorials', () => {
  const document = {
    data: [
      {
        type: 'tutorialCategory',
        id: '1',
        attributes: { category: 'Build order tutorials' },
        relationships: { tutorials: { data: [{ type: 'tutorial', id: '3' }, { type: 'tutorial', id: '1' }] } },
      },
      { type: 'tutorialCategory', id: '2', attributes: { category: 'Empty' }, relationships: { tutorials: { data: [] } } },
    ],
    included: [
      {
        type: 'tutorial',
        id: '1',
        attributes: { title: 'Four-Leaf Clover', ordinal: 1, launchable: true, technicalName: 'scmp_031_tutorial', description: '<p>Intro</p>' },
        relationships: { mapVersion: { data: { type: 'mapVersion', id: '7' } } },
      },
      {
        type: 'tutorial',
        id: '3',
        attributes: { title: 'Guide', ordinal: 2, launchable: true, description: 'Read <a href="https://forum.faforever.com/guide">the guide</a>' },
      },
      {
        type: 'mapVersion',
        id: '7',
        attributes: { folderName: 'scmp_031_ai.v0001', thumbnailUrlLarge: 'https://content.faforever.com/maps/previews/large/scmp_031_ai.v0001.png' },
        relationships: { map: { data: { type: 'map', id: '70' } } },
      },
      { type: 'map', id: '70', attributes: { displayName: 'Four-Leaf Clover AI' } },
    ],
  };

  it('lists categories with their tutorials in order and drops empty ones', () => {
    const categories = parseTutorialCategories(document);
    assert.equal(categories.length, 1);
    const [clover, guide] = categories[0]?.tutorials ?? [];
    assert.equal(clover?.title, 'Four-Leaf Clover');
    assert.equal(clover?.launchable, true);
    assert.equal(clover?.mapName, 'Four-Leaf Clover AI');
    assert.equal(clover?.mapPreviewUrl, 'https://content.faforever.com/maps/previews/large/scmp_031_ai.v0001.png');
    assert.equal(guide?.launchable, false, 'without a scenario there is nothing to launch');
    assert.deepEqual(guide?.links, [{ label: 'the guide', url: 'https://forum.faforever.com/guide' }]);
  });

  it('reads what a launch needs and refuses tutorials that cannot run', () => {
    const tutorial = (attributes: Record<string, unknown>, folderName = 'scmp_031_ai.v0001') => ({
      data: { type: 'tutorial', id: '1', attributes, relationships: { mapVersion: { data: { type: 'mapVersion', id: '7' } } } },
      included: [{ type: 'mapVersion', id: '7', attributes: { folderName } }],
    });
    assert.deepEqual(parseTutorialLaunch(tutorial({ title: 'Clover', launchable: true, technicalName: 'scmp_031_tutorial' })), {
      title: 'Clover',
      scenario: 'scmp_031_tutorial',
      mapFolderName: 'scmp_031_ai.v0001',
    });
    assert.throws(() => parseTutorialLaunch(tutorial({ title: 'Guide', launchable: false, technicalName: 'x' })));
    assert.throws(() => parseTutorialLaunch(tutorial({ title: 'Clover', launchable: true, technicalName: 'x' }, '..')));
  });

  it('starts the game offline on the scenario', () => {
    assert.deepEqual(buildOfflineArguments('C:\\logs\\offline.log', 'scmp_031_tutorial'), [
      '/init',
      'init.lua',
      '/nobugreport',
      '/log',
      'C:\\logs\\offline.log',
      '/map',
      'scmp_031_tutorial',
    ]);
  });
});

describe('external links', () => {
  it('lets pages open FAF pages and unit blueprints on GitHub, nothing else', () => {
    assert.equal(isOpenableLink('https://www.faforever.com/news'), true);
    assert.equal(isOpenableLink('https://github.com/FAForever/fa/blob/deploy/faf/units/UEL0101/UEL0101_unit.bp'), true);
    assert.equal(isOpenableLink('https://faforever.github.io/spooky-db/'), true);
    assert.equal(isOpenableLink('http://github.com/FAForever/fa'), false);
    assert.equal(isOpenableLink('https://github.com.evil.example/x'), false);
    assert.equal(isOpenableLink('https://example.com/'), false);
    assert.equal(isOpenableLink('javascript:alert(1)'), false);
  });
});
