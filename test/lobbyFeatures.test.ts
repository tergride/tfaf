import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPlayer, compareWithHost, LobbyFeatureChecks } from '../src/main/game/lobbyFeatureChecks.ts';
import {
  type AnnouncedFeature,
  announceFeatures,
  compareVersions,
  type FeatureAnnouncement,
  parseAnnouncement,
  releaseVersion,
  serializeAnnouncement,
  supportsFeature,
} from '../src/main/game/lobbyFeatures.ts';

const ISOLATED = announceFeatures(['modIsolation'], '0.7.0');
const PLAIN = announceFeatures([], '0.7.0');
// A required feature of a later TFAF version that this one does not know.
const FUTURE: AnnouncedFeature = { id: 'peerMods', minVersion: '0.9.0', required: true, names: { ru: 'Моды хоста', en: 'Host mods' } };

describe('lobby features', () => {
  it('compares release versions and reads them from launcher versions', () => {
    assert.equal(releaseVersion('0.7.0'), '0.7.0');
    assert.equal(releaseVersion('0.10.2-beta.1'), '0.10.2');
    assert.equal(releaseVersion('dev'), '0.0.0');
    assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
    assert.equal(compareVersions('0.7.0', '0.7.0'), 0);
    assert.equal(compareVersions('0.6.0', '0.7.0'), -1);
  });

  it('announces a feature with its version and names, which survive the trip to another launcher', () => {
    assert.deepEqual(ISOLATED.features.map(({ id, minVersion, required }) => ({ id, minVersion, required })), [
      { id: 'modIsolation', minVersion: '0.7.0', required: false },
    ]);
    assert.ok(ISOLATED.features[0]?.names.ru && ISOLATED.features[0].names.en);
    assert.deepEqual(parseAnnouncement(serializeAnnouncement(ISOLATED, 1000)!), ISOLATED);
  });

  it('tells whether a TFAF lobby has a password, also without the names, and nothing when the host did not say', () => {
    const locked: FeatureAnnouncement = { ...ISOLATED, password: true };
    assert.deepEqual(parseAnnouncement(serializeAnnouncement(locked, 1000)!), locked);
    const short = serializeAnnouncement(locked, Buffer.byteLength(serializeAnnouncement(locked, 1000)!) - 1)!;
    assert.equal(parseAnnouncement(short)?.password, true);
    assert.equal(parseAnnouncement(serializeAnnouncement({ ...ISOLATED, password: false }, 1000)!)?.password, false);
    assert.equal(Object.hasOwn(parseAnnouncement(serializeAnnouncement(ISOLATED, 1000)!)!, 'password'), false);
    assert.equal(Object.hasOwn(parseAnnouncement(JSON.stringify({ v: '0.7.0', f: [], pw: 'yes' }))!, 'password'), false);
  });

  it('drops the names when they do not fit, and gives up when nothing does', () => {
    const withNames = serializeAnnouncement(ISOLATED, 1000)!;
    const short = serializeAnnouncement(ISOLATED, Buffer.byteLength(withNames) - 1);
    assert.ok(short);
    assert.deepEqual(parseAnnouncement(short)?.features[0]?.names, {});
    assert.equal(serializeAnnouncement(ISOLATED, 10), null);
  });

  it('accepts only a well-formed announcement from another launcher', () => {
    const valid = { v: '0.7.0', f: [{ id: 'modIsolation', min: '0.7.0', req: false, ru: 'Изоляция', en: 'Isolation' }] };
    assert.ok(parseAnnouncement(JSON.stringify(valid)));
    for (const broken of [
      'not json',
      JSON.stringify([]),
      JSON.stringify({ ...valid, v: '1.0' }),
      JSON.stringify({ ...valid, f: [{ ...valid.f[0], id: 'mod isolation' }] }),
      JSON.stringify({ ...valid, f: [{ ...valid.f[0], min: 7 }] }),
      JSON.stringify({ ...valid, f: [{ ...valid.f[0], req: 'no' }] }),
      JSON.stringify({ ...valid, f: [{ ...valid.f[0], ru: 'line\nbreak' }] }),
      JSON.stringify({ ...valid, f: [{ ...valid.f[0], en: 'x'.repeat(61) }] }),
      JSON.stringify({ ...valid, f: [valid.f[0], valid.f[0]] }),
      JSON.stringify({ ...valid, f: Array.from({ length: 9 }, (_, index) => ({ ...valid.f[0], id: `feature${index}` })) }),
    ]) {
      assert.equal(parseAnnouncement(broken), null, broken);
    }
  });

  it('plays the features it knows, unless the announcement needs a later version of one', () => {
    assert.equal(supportsFeature(ISOLATED.features[0]!), true);
    assert.equal(supportsFeature({ ...ISOLATED.features[0]!, minVersion: '0.8.0' }), false);
    assert.equal(supportsFeature(FUTURE), false);
  });
});

describe('lobby feature checks', () => {
  const game: FeatureAnnouncement = { version: '0.9.0', features: [...ISOLATED.features, FUTURE] };

  it('lets the host disconnect players without a required feature and report those without an optional one', () => {
    const isolatedOnly = { version: '0.9.0', features: [...ISOLATED.features] };
    assert.deepEqual(checkPlayer(isolatedOnly, { kind: 'tfaf', announcement: ISOLATED }), { action: 'none', missing: [] });
    // TFAF 0.6.0 isolates every game without saying so; older versions and other clients do not.
    assert.equal(checkPlayer(isolatedOnly, { kind: 'legacy' }).action, 'none');
    assert.equal(checkPlayer(isolatedOnly, { kind: 'other' }).action, 'warn');
    assert.equal(checkPlayer(isolatedOnly, { kind: 'tfaf', announcement: PLAIN }).action, 'warn');
    assert.deepEqual(checkPlayer(game, { kind: 'other' }), { action: 'kick', missing: [FUTURE] });
    assert.deepEqual(checkPlayer(game, { kind: 'tfaf', announcement: { version: '0.9.0', features: game.features } }), {
      action: 'none',
      missing: [],
    });
  });

  it('lets a player tell what of the host it cannot play and where its game differs', () => {
    assert.deepEqual(compareWithHost(game, PLAIN), { unsupported: [FUTURE], mismatched: ISOLATED.features });
    assert.deepEqual(compareWithHost(PLAIN, ISOLATED), { unsupported: [], mismatched: ISOLATED.features });
    assert.deepEqual(compareWithHost(ISOLATED, ISOLATED), { unsupported: [], mismatched: [] });
  });

  it('reports each outcome once and keeps disconnected players on the list', () => {
    const host = new LobbyFeatureChecks(game, true);
    assert.equal(host.checkPlayer(2, 'beta', { kind: 'legacy' }).fresh, true);
    assert.equal(host.checkPlayer(2, 'beta', { kind: 'legacy' }).fresh, false);
    host.checkPlayer(3, 'alpha', { kind: 'tfaf', announcement: { version: '0.9.0', features: [FUTURE] } });
    assert.deepEqual(
      host.list().map(({ login, kicked }) => ({ login, kicked })),
      [
        { login: 'alpha', kicked: false },
        { login: 'beta', kicked: true },
      ],
    );
    host.removePlayer(2);
    host.removePlayer(3);
    assert.deepEqual(
      host.list().map(({ login }) => login),
      ['beta'],
    );
  });

  it('does not repeat to a player what the host told before the start, and explains a kick', () => {
    const player = new LobbyFeatureChecks(PLAIN, false, game);
    assert.equal(player.compareWithHost(game), null);
    assert.deepEqual(player.compareWithHost(ISOLATED), { unsupported: [], mismatched: ISOLATED.features });
    assert.deepEqual(player.kickedFor(['modIsolation']), { features: ISOLATED.features, unsupported: false });
    assert.equal(player.kickedFor(['peerMods']).unsupported, true);
  });
});
