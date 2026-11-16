import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AttemptHistory, RELAY_ONLY } from '../src/main/ice/attemptHistory.ts';
import {
  ALL_CANDIDATES,
  candidatePriority,
  type IceParameters,
  parseCandidatesMessage,
  serializeCandidatesMessage,
} from '../src/main/ice/candidates.ts';
import { encodeGpgNetMessage, GpgNetDecoder, GpgNetProtocolError } from '../src/main/ice/gpgnet.ts';
import type { PathInfo } from '../src/main/ice/iceAgent.ts';
import { parseIceUrl } from '../src/main/ice/iceServers.ts';
import { DEFAULT_ICE_TIMINGS } from '../src/main/ice/iceTimings.ts';
import { PathSelector } from '../src/main/ice/pathSelector.ts';
import { PeerStats } from '../src/main/ice/peerStats.ts';
import { parseSignal, serializeSignal } from '../src/main/ice/signaling.ts';
import {
  Attr,
  decodeChannelData,
  decodeStun,
  encodeChannelData,
  encodeStun,
  isChannelData,
  Method,
  newTransactionId,
  readErrorCode,
  readString,
  readUint32,
  readXorAddress,
  stringAttribute,
  uint32Attribute,
  verifyFingerprint,
  verifyIntegrity,
  xorAddressAttribute,
} from '../src/main/ice/stun.ts';
import {
  type ControlMessage,
  decodeControl,
  decodeDuplicated,
  Deduplicator,
  DuplicationPolicy,
  encodeControl,
  encodeDuplicated,
  Feature,
  IncomingLoss,
  MAX_MOD_FINGERPRINTS,
} from '../src/main/ice/tfafProtocol.ts';

// RFC 5769, sections 2.1 and 2.2.
const RFC5769_PASSWORD = Buffer.from('VOkJxbRl1RmTxUk/WvJxBt');
const RFC5769_REQUEST = Buffer.from(
  '000100582112a442b7e7a701bc34d686fa87dfae802200105354554e207465737420636c69656e74002400046e0001ff' +
    '80290008932ff9b151263b36000600096576746a3a68367659202020000800149aeaa70cbfd8cb56781ef2b5b2d3f249' +
    'c1b571a280280004e57a3bcf',
  'hex',
);
const RFC5769_RESPONSE = Buffer.from(
  '0101003c2112a442b7e7a701bc34d686fa87dfae8022000b7465737420766563746f7220002000080001a147e112a643' +
    '000800142b91f599fd9e90c38c7489f92af9ba53f06be7d780280004c07d4c96',
  'hex',
);

describe('STUN', () => {
  it('validates the RFC 5769 sample request', () => {
    const message = decodeStun(RFC5769_REQUEST);
    assert.ok(message);
    assert.equal(message.method, Method.binding);
    assert.equal(message.cls, 'request');
    assert.equal(readString(message, Attr.username), 'evtj:h6vY');
    assert.equal(readUint32(message, Attr.priority), 0x6e0001ff);
    assert.ok(verifyIntegrity(message, RFC5769_PASSWORD));
    assert.ok(verifyFingerprint(message));
    assert.equal(verifyIntegrity(message, Buffer.from('wrong password')), false);
  });

  it('validates the RFC 5769 sample response and its XOR-MAPPED-ADDRESS', () => {
    const message = decodeStun(RFC5769_RESPONSE);
    assert.ok(message);
    assert.equal(message.cls, 'success');
    assert.ok(verifyIntegrity(message, RFC5769_PASSWORD));
    assert.ok(verifyFingerprint(message));
    assert.deepEqual(readXorAddress(message, Attr.xorMappedAddress), { address: '192.0.2.1', port: 32853 });
  });

  it('encodes messages that decode and verify, with TURN method and class bits', () => {
    const key = Buffer.from('key');
    const transactionId = newTransactionId();
    const encoded = encodeStun(
      {
        method: Method.allocate,
        cls: 'error',
        transactionId,
        attributes: [
          { type: Attr.errorCode, value: Buffer.from([0, 0, 4, 38, ...Buffer.from('Stale Nonce')]) },
          stringAttribute(Attr.nonce, 'abc'),
          xorAddressAttribute(Attr.xorPeerAddress, { address: '203.0.113.7', port: 6112 }),
        ],
      },
      { integrityKey: key, fingerprint: true },
    );
    assert.equal(encoded.readUInt16BE(0), 0x0113);
    const message = decodeStun(encoded);
    assert.ok(message);
    assert.equal(message.method, Method.allocate);
    assert.equal(message.cls, 'error');
    assert.deepEqual(message.transactionId, transactionId);
    assert.deepEqual(readErrorCode(message), { code: 438, reason: 'Stale Nonce' });
    assert.equal(readString(message, Attr.nonce), 'abc');
    assert.deepEqual(readXorAddress(message, Attr.xorPeerAddress), { address: '203.0.113.7', port: 6112 });
    assert.ok(verifyIntegrity(message, key));
    assert.ok(verifyFingerprint(message));

    const tampered = Buffer.from(encoded);
    tampered[30] = tampered[30]! ^ 0xff;
    const decodedTampered = decodeStun(tampered);
    assert.ok(decodedTampered);
    assert.equal(verifyIntegrity(decodedTampered, key), false);
    assert.equal(verifyFingerprint(decodedTampered), false);

    const indication = encodeStun({ method: Method.data, cls: 'indication', transactionId, attributes: [uint32Attribute(Attr.lifetime, 1)] });
    assert.equal(indication.readUInt16BE(0), 0x0017);
  });

  it('frames ChannelData', () => {
    const framed = encodeChannelData(0x4001, Buffer.from('payload'));
    assert.ok(isChannelData(framed));
    assert.deepEqual(decodeChannelData(framed), { channel: 0x4001, payload: Buffer.from('payload') });
    assert.equal(decodeStun(Buffer.from('d-game-packet-not-stun')), null);
  });
});

describe('GPGNet', () => {
  it('uses little-endian lengths and typed fields', () => {
    assert.equal(encodeGpgNetMessage('A', [1, 'b']).toString('hex'), '0100000041' + '02000000' + '0001000000' + '010100000062');
  });

  it('decodes messages split at any byte and unescapes tabs and newlines', () => {
    const stream = Buffer.concat([
      encodeGpgNetMessage('GameState', ['Idle']),
      encodeGpgNetMessage('Chat', ['line/nnext/tcolumn', -5, 2147483647]),
    ]);
    const decoder = new GpgNetDecoder();
    const messages = [...stream].flatMap((byte) => decoder.push(Buffer.of(byte)));
    assert.deepEqual(messages, [
      { header: 'GameState', args: ['Idle'] },
      { header: 'Chat', args: ['line\nnext\tcolumn', -5, 2147483647] },
    ]);
  });

  it('rejects messages with more than ten arguments', () => {
    const decoder = new GpgNetDecoder();
    assert.throws(() => decoder.push(encodeGpgNetMessage('Spam', Array.from({ length: 11 }, () => 1))), GpgNetProtocolError);
  });
});

describe('ICE candidates', () => {
  it('computes the same priorities as ice4j', () => {
    assert.equal(candidatePriority('host', 65535), 2130706431);
    assert.equal(candidatePriority('srflx', 65535), 1694498815);
    assert.equal(candidatePriority('relay', 65535), 16777215);
  });

  it('serializes candidates in the format of the Java adapter and parses them back', () => {
    const parameters: IceParameters = {
      ufrag: 'abcd1234',
      password: 'password0123456789abcdef',
      candidates: [
        { type: 'relay', address: '198.51.100.20', port: 50000, priority: 16777215, foundation: '3', relatedAddress: '203.0.113.5', relatedPort: 40000 },
        { type: 'host', address: '192.168.0.10', port: 6200, priority: 2130706431, foundation: '1', relatedAddress: null, relatedPort: 0 },
      ],
    };
    const json = serializeCandidatesMessage(7, 9, parameters);
    const raw = JSON.parse(json) as { candidates: Record<string, unknown>[] };
    assert.deepEqual(Object.keys(raw), ['srcId', 'destId', 'password', 'ufrag', 'candidates']);
    assert.deepEqual(raw.candidates[0], {
      foundation: '1',
      protocol: 'udp',
      priority: 2130706431,
      ip: '192.168.0.10',
      port: 6200,
      type: 'HOST_CANDIDATE',
      generation: 0,
      id: '0',
      relAddr: null,
      relPort: 0,
    });
    assert.equal(raw.candidates[1]?.type, 'RELAYED_CANDIDATE');

    const parsed = parseCandidatesMessage(json);
    assert.equal(parsed?.sourceId, 7);
    assert.deepEqual(
      parsed?.parameters.candidates.map((candidate) => [candidate.type, candidate.address]),
      [
        ['host', '192.168.0.10'],
        ['relay', '198.51.100.20'],
      ],
    );
  });

  it('skips candidates it cannot use and rejects messages without credentials', () => {
    const message = JSON.stringify({
      srcId: 1,
      destId: 2,
      password: 'p',
      ufrag: 'u',
      candidates: [
        { foundation: '1', protocol: 'udp', priority: 2130706431, ip: 'fe80::1', port: 6112, type: 'HOST_CANDIDATE', generation: 0 },
        { foundation: '2', protocol: 'tcp', priority: 2130706431, ip: '192.0.2.1', port: 6112, type: 'HOST_CANDIDATE', generation: 0 },
        { foundation: '3', protocol: 'udp', priority: 1694498815, ip: '192.0.2.1', port: 6112, type: 'SERVER_REFLEXIVE_CANDIDATE', generation: 1 },
        { foundation: '4', protocol: 'UDP', priority: 1694498815, ip: '192.0.2.2', port: 6113, type: 'SERVER_REFLEXIVE_CANDIDATE', generation: 0 },
      ],
    });
    assert.deepEqual(
      parseCandidatesMessage(message)?.parameters.candidates.map((candidate) => candidate.address),
      ['192.0.2.2'],
    );
    assert.equal(parseCandidatesMessage(JSON.stringify({ srcId: 1, candidates: [] })), null);
    assert.equal(parseCandidatesMessage('{not json'), null);
  });

  it('parses STUN and TURN URLs in both URI forms', () => {
    assert.deepEqual(parseIceUrl('turn:198.51.100.1?transport=udp'), { scheme: 'turn', host: '198.51.100.1', port: 3478, transport: 'udp' });
    assert.deepEqual(parseIceUrl('turn://relay.example.org:3479?transport=tcp'), {
      scheme: 'turn',
      host: 'relay.example.org',
      port: 3479,
      transport: 'tcp',
    });
    assert.deepEqual(parseIceUrl('stun:stun.example.org:19302'), { scheme: 'stun', host: 'stun.example.org', port: 19302, transport: 'udp' });
    assert.equal(parseIceUrl('turns:relay.example.org'), null);
    assert.equal(parseIceUrl('https://example.org'), null);
  });
});

describe('TFAF extensions', () => {
  it('encodes control packets behind the t prefix', () => {
    const messages: ControlMessage[] = [
      { type: 'hello', version: 1, features: 3, seen: true, fingerprint: null },
      {
        type: 'hello',
        version: 1,
        features: 7,
        seen: false,
        fingerprint: { gameFiles: '0123456789abcdef', map: null, mapKey: null, mods: 'fedcba9876543210', modFiles: null },
      },
      {
        type: 'hello',
        version: 1,
        features: 15 | Feature.mapKey,
        seen: true,
        fingerprint: {
          gameFiles: '0123456789abcdef',
          map: '1111111111111111',
          mapKey: '2222222222222222',
          mods: 'fedcba9876543210',
          modFiles: [
            { key: 'aaaaaaaaaaaaaaaa', digest: 'bbbbbbbbbbbbbbbb' },
            { key: 'cccccccccccccccc', digest: null },
          ],
        },
      },
      { type: 'ping', seq: 7, sentAt: 1_760_000_000_123 },
      { type: 'pong', seq: 7, sentAt: 1_760_000_000_123, lossPermille: 75 },
      { type: 'restart' },
      { type: 'bye' },
    ];
    for (const message of messages) {
      const encoded = encodeControl(message);
      assert.equal(encoded[0], 0x74);
      assert.deepEqual(decodeControl(encoded), message);
    }
    assert.equal(decodeControl(Buffer.from([0x74, 2, 0, 0])), null);
    assert.equal(decodeControl(Buffer.from('dgame data')), null);
  });

  it('reads the mods of a hello only when announced and complete', () => {
    const fingerprint = {
      gameFiles: '0123456789abcdef',
      map: null,
      mapKey: null,
      mods: 'fedcba9876543210',
      modFiles: [{ key: 'aaaaaaaaaaaaaaaa', digest: 'bbbbbbbbbbbbbbbb' }],
    };
    const full = encodeControl({ type: 'hello', version: 1, features: 15, seen: false, fingerprint });
    // An older TFAF announces no mods: whatever follows the parts is ignored.
    const older = Buffer.from(full);
    older.writeUInt32BE(7, 3);
    assert.deepEqual(decodeControl(older), {
      type: 'hello',
      version: 1,
      features: 7,
      seen: false,
      fingerprint: { ...fingerprint, modFiles: null },
    });
    const cut = decodeControl(full.subarray(0, full.length - 4));
    assert.equal(cut?.type === 'hello' ? cut.fingerprint?.modFiles : undefined, null);
  });

  it('reads the map key of a hello only when announced and complete', () => {
    const fingerprint = {
      gameFiles: null,
      map: '1111111111111111',
      mapKey: '2222222222222222',
      mods: null,
      modFiles: [{ key: 'aaaaaaaaaaaaaaaa', digest: 'bbbbbbbbbbbbbbbb' }],
    };
    const features = 15 | Feature.mapKey;
    const mapKeyOf = (data: Buffer) => {
      const decoded = decodeControl(data);
      return decoded?.type === 'hello' ? decoded.fingerprint?.mapKey : undefined;
    };
    const full = encodeControl({ type: 'hello', version: 1, features, seen: false, fingerprint });
    assert.equal(mapKeyOf(full), fingerprint.mapKey);

    // An older TFAF reading the same hello announces no key, and the mods stay readable.
    const older = Buffer.from(full);
    older.writeUInt32BE(15, 3);
    const decoded = decodeControl(older);
    assert.equal(mapKeyOf(older), null);
    assert.deepEqual(decoded?.type === 'hello' ? decoded.fingerprint?.modFiles : undefined, fingerprint.modFiles);

    assert.equal(mapKeyOf(full.subarray(0, full.length - 1)), null);
    const withoutKey = { ...fingerprint, mapKey: null };
    assert.equal(mapKeyOf(encodeControl({ type: 'hello', version: 1, features, seen: false, fingerprint: withoutKey })), null);
  });

  it('sends the same mods from both sides when the game has more than fit, whatever their order', () => {
    const mods = Array.from({ length: MAX_MOD_FINGERPRINTS + 3 }, (_, index) => ({
      key: index.toString(16).padStart(16, '0'),
      digest: 'bbbbbbbbbbbbbbbb',
    }));
    const sentMods = (order: typeof mods) => {
      const fingerprint = { gameFiles: null, map: null, mapKey: null, mods: null, modFiles: order };
      const decoded = decodeControl(encodeControl({ type: 'hello', version: 1, features: 15, seen: false, fingerprint }));
      return decoded?.type === 'hello' ? decoded.fingerprint?.modFiles : undefined;
    };

    const hostOrder = sentMods([...mods].reverse());
    assert.deepEqual(hostOrder, mods.slice(0, MAX_MOD_FINGERPRINTS));
    assert.deepEqual(sentMods(mods), hostOrder);
  });

  it('carries the mods of a rehost as far as they fit and rejects a cut list', () => {
    const uids = ['efda6a45-3896-42ac-a60b-6a0ac8aa90b4', 'mod-ü'];
    const rehost = encodeControl({ type: 'rehost', id: 0xfffffffe, modUids: uids });
    assert.deepEqual(decodeControl(rehost), { type: 'rehost', id: 0xfffffffe, modUids: uids });
    assert.equal(decodeControl(rehost.subarray(0, rehost.length - 1)), null);
    assert.deepEqual(decodeControl(encodeControl({ type: 'rehostAck', id: 7 })), { type: 'rehostAck', id: 7 });

    const many = Array.from({ length: 40 }, (_, index) => `${index}`.padStart(36, '0'));
    const capped = encodeControl({ type: 'rehost', id: 1, modUids: many });
    const decoded = decodeControl(capped);
    assert.ok(capped.length <= 1100);
    assert.deepEqual(decoded?.type === 'rehost' ? decoded.modUids : null, many.slice(0, 29));
  });

  it('carries what a game was started with and the host kicking a player, and rejects them cut short', () => {
    const info = '{"v":"0.7.0","f":[{"id":"modIsolation","min":"0.7.0","req":false,"ru":"Изоляция модов"}]}';
    const launcher = encodeControl({ type: 'launcher', info });
    assert.deepEqual(decodeControl(launcher), { type: 'launcher', info });
    assert.equal(decodeControl(launcher.subarray(0, launcher.length - 1)), null);
    assert.deepEqual(decodeControl(encodeControl({ type: 'launcherAck' })), { type: 'launcherAck' });

    const kick = encodeControl({ type: 'kick', features: ['modIsolation', 'peerMods'] });
    assert.deepEqual(decodeControl(kick), { type: 'kick', features: ['modIsolation', 'peerMods'] });
    assert.equal(decodeControl(kick.subarray(0, kick.length - 1)), null);
  });

  it('numbers duplicated packets and lets every number through once', () => {
    const packet = encodeDuplicated(42, Buffer.from('payload'));
    assert.equal(packet[0], 0x44);
    assert.deepEqual(decodeDuplicated(packet), { seq: 42, payload: Buffer.from('payload') });
    const deduplicator = new Deduplicator();
    assert.equal(deduplicator.accept(42), true);
    assert.equal(deduplicator.accept(42), false);
    assert.equal(deduplicator.accept(43), true);
  });

  it('measures the loss of the last 40 pings', () => {
    const loss = new IncomingLoss();
    assert.equal(loss.permille(), 0);
    for (let seq = 100; seq < 140; seq++) {
      if (seq !== 110 && seq !== 120) {
        loss.record(seq);
      }
    }
    assert.equal(loss.permille(), 50);
    // Once the gaps fall out of the window the loss is back to zero.
    for (let seq = 140; seq < 161; seq++) {
      loss.record(seq);
    }
    assert.equal(loss.permille(), 0);
  });

  it('ignores a single lost ping and the first seconds of a connection', () => {
    const single = new IncomingLoss();
    for (let seq = 0; seq < 40; seq++) {
      if (seq !== 5) {
        single.record(seq);
      }
    }
    assert.equal(single.permille(), 0);

    const early = new IncomingLoss();
    for (const seq of [0, 3, 4]) {
      early.record(seq);
    }
    assert.equal(early.permille(), 0);
  });

  it('turns duplication on at 5% loss and off after a minute without loss', () => {
    const policy = new DuplicationPolicy();
    assert.equal(policy.update(25, 0), false);
    assert.equal(policy.update(50, 1_000), true);
    assert.equal(policy.update(0, 30_000), true);
    assert.equal(policy.update(25, 70_000), true);
    assert.equal(policy.update(0, 71_000), false);
  });
});

describe('PeerStats', () => {
  it('summarises a minute of traffic for the adapter log', () => {
    const stats = new PeerStats(0);
    assert.equal(stats.isEmpty, true);
    for (const rtt of [40, 50, 90]) {
      stats.roundTrip(rtt);
    }
    stats.gameSent(1024, false);
    stats.gameSent(1024, true);
    stats.gameReceived(512);
    stats.duplicateDropped();
    assert.equal(stats.isEmpty, false);
    assert.equal(
      stats.summary(60_000, 25, null),
      '60 s, rtt 60 ms (40-90), loss out 2.5% in ?, game packets out 2 (2.0 KB) in 1 (0.5 KB), sent twice 1, duplicates dropped 1',
    );
  });
});

describe('AttemptHistory', () => {
  const timings = DEFAULT_ICE_TIMINGS;

  it('offers every candidate type after connections that lasted, and after a single short one', () => {
    const history = new AttemptHistory(timings);
    assert.deepEqual(history.policy(false, 0), ALL_CANDIDATES);
    history.lost('direct', 0, 60_000);
    assert.deepEqual(history.policy(false, 60_000), ALL_CANDIDATES);
    history.lost('direct', 60_500, 61_000);
    assert.deepEqual(history.policy(false, 61_000), ALL_CANDIDATES);
  });

  it('offers relays only while a direct path keeps breaking soon after connecting', () => {
    const history = new AttemptHistory(timings);
    history.lost('direct', 0, 5_000);
    history.lost('direct', 6_000, 10_000);
    assert.deepEqual(history.policy(false, 10_000), RELAY_ONLY);
    // Short relayed connections say nothing about the direct path.
    const relayed = new AttemptHistory(timings);
    relayed.lost('relay', 0, 5_000);
    relayed.lost('relay', 6_000, 10_000);
    assert.deepEqual(relayed.policy(false, 10_000), ALL_CANDIDATES);
    // Two minutes later the direct path gets another chance.
    assert.deepEqual(history.policy(false, 10_000 + timings.attemptWindowMs), ALL_CANDIDATES);
  });

  it('follows the server when it demands relays, for our candidates and the peer\'s', () => {
    const history = new AttemptHistory(timings);
    assert.deepEqual(history.policy(true, 0), RELAY_ONLY);
    assert.deepEqual(history.remotePolicy(true), RELAY_ONLY);
    history.lost('direct', 0, 5_000);
    history.lost('direct', 6_000, 10_000);
    assert.deepEqual(history.remotePolicy(false), ALL_CANDIDATES);
  });

  it('retries a lost connection at once and a player that stays away less often', () => {
    const history = new AttemptHistory(timings);
    assert.equal(history.retryDelay(true, 0), 0);
    history.failed(0);
    assert.equal(history.retryDelay(false, 1_000), timings.retryDelayMs);
    assert.equal(history.retryDelay(false, timings.slowRetryAfterMs), timings.slowRetryDelayMs);
    history.connected();
    history.failed(500_000);
    assert.equal(history.retryDelay(false, 501_000), timings.retryDelayMs);
  });
});

describe('PathSelector', () => {
  const timings = { pathSilenceMs: 1_000, pathAliveMs: 2_000, pathSwitchHoldMs: 10_000 };
  const path = (id: string, rttMs: number | null, lossPercent: number, lastResponseAt: number | null, relay = false): PathInfo => ({
    id,
    relay,
    description: id,
    rttMs,
    lossPercent,
    lastResponseAt,
  });

  it('moves to a clearly better path only after it stayed better for the hold time', () => {
    const selector = new PathSelector(timings);
    const paths = (now: number): PathInfo[] => [path('relay', 60, 0, now, true), path('direct', 5, 0, now)];
    assert.equal(selector.choose(paths(0), 'relay', 0), null);
    assert.equal(selector.choose(paths(5_000), 'relay', 5_000), null);
    assert.deepEqual(selector.choose(paths(10_000), 'relay', 10_000)?.id, 'direct');
  });

  it('stays on the current path when the other one is only a little better', () => {
    const selector = new PathSelector(timings);
    for (const now of [0, 10_000, 20_000]) {
      assert.equal(selector.choose([path('a', 50, 0, now), path('b', 45, 0, now)], 'a', now), null);
    }
  });

  it('counts loss against the round trip', () => {
    const selector = new PathSelector(timings);
    const paths = (now: number): PathInfo[] => [path('direct', 5, 20, now), path('relay', 60, 0, now, true)];
    selector.choose(paths(0), 'direct', 0);
    assert.equal(selector.choose(paths(10_000), 'direct', 10_000)?.id, 'relay');
  });

  it('leaves a path that stopped answering at once for a live one', () => {
    const selector = new PathSelector(timings);
    const choice = selector.choose([path('direct', 5, 0, 0), path('relay', 60, 0, 1_400, true)], 'direct', 1_500);
    assert.equal(choice?.id, 'relay');
    assert.match(choice?.reason ?? '', /stopped answering/);
    // Nothing alive: nothing to move to.
    assert.equal(selector.choose([path('direct', 5, 0, 0), path('relay', 60, 0, 0, true)], 'direct', 5_000), null);
  });

  it('prefers a direct path on a tie', () => {
    const selector = new PathSelector(timings);
    const choice = selector.choose([path('relay', 20, 0, 0, true), path('direct', 20, 0, 0)], null, 0);
    assert.equal(choice?.id, 'direct');
  });
});

describe('TFAF signals', () => {
  it('carries a restart request and a goodbye and tells them from candidates', () => {
    for (const kind of ['restart', 'bye'] as const) {
      const message = { kind, sourceId: 435772, destinationId: 68778 };
      assert.deepEqual(parseSignal(serializeSignal(message)), message);
    }
    const candidates = serializeCandidatesMessage(1, 2, { ufrag: 'abcd', password: 'secret', candidates: [] });
    assert.equal(parseSignal(candidates), null);
    assert.equal(parseCandidatesMessage(serializeSignal({ kind: 'restart', sourceId: 1, destinationId: 2 })), null);
  });

  it('rejects anything it does not know', () => {
    assert.equal(parseSignal('{"tfaf":3,"kind":"restart","srcId":1,"destId":2}'), null);
    assert.equal(parseSignal('{"tfaf":2,"kind":"reboot","srcId":1,"destId":2}'), null);
    assert.equal(parseSignal('{"tfaf":2,"kind":"bye","srcId":"1","destId":2}'), null);
    assert.equal(parseSignal(`{"tfaf":2,"kind":"bye","srcId":1,"destId":2,"pad":"${'x'.repeat(300)}"}`), null);
    assert.equal(parseSignal('not json, but "tfaf"'), null);
  });

  it('goes with the new feature bits of the hello, which an older reader passes over', () => {
    const features = Feature.liveness | Feature.signaling | Feature.pathManagement;
    const hello = decodeControl(encodeControl({ type: 'hello', version: 1, features, seen: false, fingerprint: null }));
    assert.deepEqual(hello, { type: 'hello', version: 1, features, seen: false, fingerprint: null });
  });
});
