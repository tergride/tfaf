import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChatModel, type ChatModelEvents } from '../src/main/chat/chatModel.ts';
import { clanChannel, mergeChatPrefs, wantedChannels } from '../src/main/chat/chatPrefs.ts';
import { ChatService, type ChatServiceDependencies } from '../src/main/chat/chatService.ts';
import { IrcConnection } from '../src/main/chat/ircConnection.ts';
import { formatIrcLine, nickOf, parseIrcLine } from '../src/main/chat/ircMessage.ts';
import { isPrivateAddress, parseLinkMetadata } from '../src/main/chat/linkPreview.ts';
import {
  gameInvite,
  gameInviteReply,
  lobbyQuery,
  lobbyReply,
  lobbyReplyRoom,
  parseTfafCtcp,
  parseTfafRealname,
  TFAF_CHANNEL,
  tfafRealname,
} from '../src/main/chat/tfafPresence.ts';
import { CHAT_LIMITS, HOST_GAME_LIMITS } from '../src/shared/contract.ts';

describe('TFAF presence', () => {
  it('names the version in the realname and reads it back, ignoring other clients', () => {
    assert.equal(parseTfafRealname(tfafRealname('0.7.0')), '0.7.0');
    assert.equal(parseTfafRealname('Tergride'), null);
    assert.equal(parseTfafRealname('TFAF 0.7'), null);
  });

  it('asks a host about its game with CTCP and reads the answer', () => {
    const body = (text: string): string => text.slice(1, -1);
    assert.deepEqual(parseTfafCtcp(body(lobbyQuery(42)), false), { kind: 'lobbyQuery', gameId: 42 });
    assert.deepEqual(parseTfafCtcp(body(lobbyReply(42, '{"v":"0.7.0","f":[]}')), true), {
      kind: 'lobbyReply',
      gameId: 42,
      announcement: '{"v":"0.7.0","f":[]}',
    });
    assert.deepEqual(parseTfafCtcp(body(lobbyReply(42, null)), true), { kind: 'lobbyReply', gameId: 42, announcement: null });
    // A query sent as a notice, a reply sent as a message and other CTCP are not ours.
    assert.equal(parseTfafCtcp(body(lobbyQuery(42)), true), null);
    assert.equal(parseTfafCtcp(body(lobbyReply(42, null)), false), null);
    assert.equal(parseTfafCtcp('VERSION', false), null);
    assert.equal(Buffer.byteLength(lobbyReply(42, 'x'.repeat(lobbyReplyRoom(42)))), CHAT_LIMITS.messageMaxBytes);
  });

  it('carries the game password of an invitation intact and reads the answer', () => {
    const body = (text: string): string => text.slice(1, -1);
    for (const password of ['secret', 'пароль с пробелами: \u0001 и \r\n', null]) {
      assert.deepEqual(parseTfafCtcp(body(gameInvite(42, password)), false), { kind: 'invite', gameId: 42, password });
    }
    assert.deepEqual(parseTfafCtcp(body(gameInviteReply(42, 'notFriend')), true), { kind: 'inviteReply', gameId: 42, answer: 'notFriend' });
    // An invitation sent as a notice, an answer sent as a message, and a password no launcher would send are not ours.
    assert.equal(parseTfafCtcp(body(gameInvite(42, 'secret')), true), null);
    assert.equal(parseTfafCtcp(body(gameInviteReply(42, 'ok')), false), null);
    assert.equal(parseTfafCtcp('TFAF INVITE 42 c2VjcmV0=', false), null);
    assert.equal(parseTfafCtcp(`TFAF INVITE 42 ${Buffer.from('x'.repeat(HOST_GAME_LIMITS.passwordMaxLength + 1)).toString('base64url')}`, false), null);
    // The longest password of the widest characters still fits into one chat message.
    const longest = 'ж'.repeat(HOST_GAME_LIMITS.passwordMaxLength);
    assert.ok(Buffer.byteLength(gameInvite(2 ** 31 - 1, longest)) <= CHAT_LIMITS.messageMaxBytes);
  });
});

function line(text: string) {
  const message = parseIrcLine(text);
  assert.ok(message, text);
  return message;
}

describe('IRC lines', () => {
  it('reads tags, the source, the command and the trailing parameter', () => {
    const message = line('@msgid=abc;time=2026-10-23T10:00:00.000Z;+draft/reply=x\\sy;solo :alice!a@host PRIVMSG #aeolus :hello  world');
    assert.equal(message.tags.get('msgid'), 'abc');
    assert.equal(message.tags.get('+draft/reply'), 'x y');
    assert.equal(message.tags.get('solo'), '');
    assert.equal(nickOf(message.source), 'alice');
    assert.equal(message.command, 'PRIVMSG');
    assert.deepEqual(message.params, ['#aeolus', 'hello  world']);
    assert.equal(nickOf('irc.faforever.com'), null);
    assert.deepEqual(line(':server 353 me = #aeolus :@alice bob').params, ['me', '=', '#aeolus', '@alice bob']);
  });

  it('writes tags escaped and refuses parameters that would start another command', () => {
    assert.equal(formatIrcLine('PRIVMSG', ['#aeolus', 'hi there'], { label: 'l1', '+typing': 'active' }), '@label=l1;+typing=active PRIVMSG #aeolus :hi there');
    assert.equal(formatIrcLine('TAGMSG', ['#aeolus'], { '+draft/react': 'a;b c' }), '@+draft/react=a\\:b\\sc TAGMSG #aeolus');
    assert.equal(formatIrcLine('JOIN', ['#aeolus']), 'JOIN #aeolus');
    assert.throws(() => formatIrcLine('PRIVMSG', ['#aeolus', 'hi\r\nQUIT']));
    assert.throws(() => formatIrcLine('PRIVMSG', ['#a b', 'hi']));
  });
});

/** Stands in for the WebSocket of the IRC server; the test plays the server. */
class FakeIrcServer extends EventTarget {
  readyState: number = WebSocket.CONNECTING;
  readonly sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1000 }));
  }

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  reply(text: string): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data: text }));
  }
}

describe('IRC connection', () => {
  it('negotiates capabilities, logs in with SASL PLAIN and reports the nick', () => {
    const server = new FakeIrcServer();
    const registered: string[] = [];
    const closed: (string | null)[] = [];
    const connection = new IrcConnection(
      {
        url: 'wss://irc.faforever.com:6697',
        nick: 'alice',
        account: 'alice@FAF',
        password: 'token:secret',
        capabilities: ['message-tags', 'echo-message', 'not-offered'],
        createSocket: () => server as unknown as WebSocket,
      },
      {
        onRegistered: (capabilities, nick) => registered.push(`${nick}:${[...capabilities].sort().join(',')}`),
        onMessage: () => {},
        onClosed: (error) => closed.push(error),
      },
    );
    server.open();
    assert.deepEqual(server.sent, ['CAP LS 302', 'NICK alice', 'USER alice 0 * alice']);
    server.reply(':irc CAP * LS * :sasl=PLAIN message-tags');
    server.reply(':irc CAP * LS :echo-message batch');
    assert.equal(server.sent.at(-1), 'CAP REQ :sasl message-tags echo-message');
    server.reply(':irc CAP * ACK :sasl message-tags echo-message');
    assert.equal(server.sent.at(-1), 'AUTHENTICATE PLAIN');
    server.reply('AUTHENTICATE +');
    assert.equal(
      Buffer.from(server.sent.at(-1)!.slice('AUTHENTICATE '.length), 'base64').toString(),
      'alice@FAF\0alice@FAF\0token:secret',
    );
    server.reply(':irc 903 alice :SASL authentication successful');
    assert.equal(server.sent.at(-1), 'CAP END');
    server.reply(':irc 001 alice :Welcome');
    server.reply('PING :abc');
    assert.equal(server.sent.at(-1), 'PONG abc');
    assert.deepEqual(registered, ['alice:echo-message,message-tags,sasl']);

    connection.close();
    assert.deepEqual(closed, [null]);
  });

  it('puts the realname it is given into USER', () => {
    const server = new FakeIrcServer();
    const connection = new IrcConnection(
      {
        url: 'wss://irc',
        nick: 'alice',
        realname: tfafRealname('0.7.0'),
        account: 'alice@FAF',
        password: 'token:x',
        capabilities: [],
        createSocket: () => server as unknown as WebSocket,
      },
      { onRegistered: () => {}, onMessage: () => {}, onClosed: () => {} },
    );
    server.open();
    assert.equal(server.sent[2], 'USER alice 0 * :TFAF 0.7.0');
    connection.close();
  });

  it('reports a refused login once', () => {
    const server = new FakeIrcServer();
    const closed: (string | null)[] = [];
    new IrcConnection(
      { url: 'wss://irc', nick: 'alice', account: 'alice@FAF', password: 'token:x', capabilities: [], createSocket: () => server as unknown as WebSocket },
      { onRegistered: () => {}, onMessage: () => {}, onClosed: (error) => closed.push(error) },
    );
    server.open();
    server.reply(':irc CAP * LS :sasl');
    server.reply(':irc CAP * ACK :sasl');
    server.reply('AUTHENTICATE +');
    server.reply(':irc 904 alice :SASL authentication failed');
    assert.equal(closed.length, 1);
    assert.match(closed[0] ?? '', /не принял вход: SASL authentication failed/);
  });
});

function model() {
  const events = { changed: [] as string[], joined: [] as string[], attention: [] as string[], errors: [] as string[] };
  const handlers: ChatModelEvents = {
    onChanged: (channel, part) => events.changed.push(`${channel ?? '*'}:${part}`),
    onJoined: (channel) => events.joined.push(channel),
    onAttention: (channel, sender, text, reason) => events.attention.push(`${reason}:${channel}:${sender}:${text}`),
    onError: (text) => events.errors.push(text),
  };
  const chat = new ChatModel(handlers);
  chat.setNick('Tergride');
  return { chat, events };
}

const now = () => new Date().toISOString();

describe('chat model', () => {
  it('joins, lists users with their prefixes and follows modes, away and quits', () => {
    const { chat, events } = model();
    chat.handle(line(':irc 005 Tergride PREFIX=(qaohv)~&@%+ CHANMODES=Ibe,k,fl,CEMRUimnstu :are supported'));
    chat.handle(line(':Tergride!t@h JOIN #aeolus'));
    assert.deepEqual(events.joined, ['#aeolus']);
    chat.handle(line(':irc 353 Tergride = #aeolus :~Owner @Mod +Voiced Tergride bob!b@host'));
    chat.handle(line(':irc 366 Tergride #aeolus :End of NAMES'));
    chat.handle(line(':irc 352 Tergride #aeolus b host irc bob G :0 bob'));
    chat.handle(line(':Mod!m@h MODE #aeolus +o-v+l bob Voiced 50'));
    chat.handle(line(':Mod!m@h MODE #aeolus -o Mod'));
    chat.handle(line(':Owner!o@h QUIT :bye'));
    const users = Object.fromEntries(chat.users('#aeolus').map((user) => [user.nick, `${user.prefixes}${user.away ? ' away' : ''}`]));
    assert.deepEqual(users, { Mod: '', Voiced: '', Tergride: '', bob: '@ away' });
    assert.equal(chat.isModerator('#aeolus'), false);
    chat.handle(line(':Mod!m@h MODE #aeolus +o Tergride'));
    assert.equal(chat.isModerator('#aeolus'), true);
  });

  it('orders history by time, replaces our pending message with the echo and counts unread mentions', () => {
    const { chat, events } = model();
    chat.handle(line(':Tergride!t@h JOIN #aeolus'));
    chat.handle(line(`@msgid=live1;time=${now()} :bob!b@h PRIVMSG #aeolus :hi tergride, ready?`));
    chat.handle(line(':irc BATCH +h1 chathistory #aeolus'));
    chat.handle(line('@batch=h1;msgid=old1;time=2026-10-20T10:00:00.000Z :alice!a@h PRIVMSG #aeolus :good morning'));
    chat.handle(line('@batch=h1;msgid=old0;time=2026-10-20T09:00:00.000Z :alice!a@h JOIN #aeolus'));
    chat.handle(line(':irc BATCH -h1'));
    chat.addPending('#aeolus', 'l1', 'ready', 'message', 'live1');
    assert.equal(chat.messages('#aeolus').at(-1)?.pending, true);
    chat.handle(line(`@label=l1;msgid=mine1;time=${now()};+draft/reply=live1 :Tergride!t@h PRIVMSG #aeolus :ready`));
    chat.handle(line(`@msgid=act1;time=${now()} :alice!a@h PRIVMSG #aeolus :\u0001ACTION waves\u0001`));

    const messages = chat.messages('#aeolus');
    assert.deepEqual(
      messages.map((message) => [message.id, message.kind, message.pending, message.own, message.mention]),
      [
        ['old1', 'message', false, false, false],
        ['live1', 'message', false, false, true],
        ['mine1', 'message', false, true, false],
        ['act1', 'action', false, false, false],
      ],
    );
    assert.deepEqual(messages[2]?.replyTo, { id: 'live1', sender: 'bob', text: 'hi tergride, ready?' });
    assert.deepEqual(events.attention, ['mention:#aeolus:bob:hi tergride, ready?']);
    assert.deepEqual(
      [chat.info('#aeolus')?.unread, chat.info('#aeolus')?.mentions],
      [2, 1],
    );
    chat.setOpen('#aeolus');
    assert.deepEqual([chat.info('#aeolus')?.unread, chat.info('#aeolus')?.mentions], [0, 0]);
  });

  it('opens private conversations, shows reactions and typing, and removes what is redacted', () => {
    const { chat, events } = model();
    chat.handle(line(`@msgid=p1;time=${now()} :bob!b@h PRIVMSG Tergride :psst`));
    assert.deepEqual(events.attention, ['private:bob:bob:psst']);
    chat.handle(line(`@msgid=r1;+draft/reply=p1;+draft/react=:+1: :Tergride!t@h TAGMSG bob`));
    chat.handle(line(`@msgid=r2;+draft/reply=p1;+draft/react=:+1: :bob!b@h TAGMSG Tergride`));
    chat.handle(line('@+typing=active :bob!b@h TAGMSG Tergride'));
    assert.deepEqual(chat.messages('bob')[0]?.reactions, [{ shortcode: ':+1:', users: ['Tergride', 'bob'], mine: true }]);
    assert.equal(chat.ownReaction('bob', 'p1', ':+1:'), 'r1');
    assert.deepEqual(chat.info('bob')?.typing, ['bob']);
    assert.equal(chat.expireTyping(Date.now() + 10_000), true);
    assert.deepEqual(chat.info('bob')?.typing, []);

    chat.handle(line(':Tergride!t@h REDACT bob r1'));
    assert.deepEqual(chat.messages('bob')[0]?.reactions, [{ shortcode: ':+1:', users: ['bob'], mine: false }]);
    chat.handle(line(':bob!b@h REDACT Tergride p1'));
    assert.deepEqual(chat.messages('bob'), []);

    chat.addPending('bob', 'l2', 'are you there?', 'message', null);
    chat.handle(line(':irc 401 Tergride bob :No such nick'));
    assert.deepEqual(
      chat.messages('bob').map((message) => [message.kind, message.pending]),
      [['system', false]],
    );
  });

  it('keeps hidden senders out entirely: no messages, counts, private conversations or typing', () => {
    const attention: string[] = [];
    const chat = new ChatModel(
      { onChanged: () => {}, onJoined: () => {}, onAttention: (channel) => attention.push(channel), onError: () => {} },
      { isHidden: (nick) => nick.toLowerCase() === 'troll', messageLimit: () => 3 },
    );
    chat.setNick('Tergride');
    chat.handle(line(':Tergride!t@h JOIN #aeolus'));
    chat.handle(line(`@msgid=t1;time=${now()} :Troll!t@h PRIVMSG #aeolus :tergride look`));
    chat.handle(line(`@msgid=t2;time=${now()} :troll!t@h PRIVMSG Tergride :psst`));
    chat.handle(line('@+typing=active :Troll!t@h TAGMSG #aeolus'));
    assert.deepEqual(chat.messages('#aeolus'), []);
    assert.equal(chat.hasChannel('troll'), false);
    assert.deepEqual([chat.info('#aeolus')?.unread, chat.info('#aeolus')?.typing], [0, []]);
    assert.deepEqual(attention, []);

    for (const id of ['m1', 'm2', 'm3', 'm4']) {
      chat.handle(line(`@msgid=${id};time=${now()} :bob!b@h PRIVMSG #aeolus :${id}`));
    }
    assert.deepEqual(
      chat.messages('#aeolus').map((message) => message.id),
      ['m2', 'm3', 'm4'],
      'only the latest messages up to the limit stay',
    );
  });

  it('tells TFAF launchers by their realname and forgets them when they leave', () => {
    const changes: string[] = [];
    const ctcp: string[] = [];
    const whoEnds: string[] = [];
    const chat = new ChatModel({
      onChanged: () => {},
      onJoined: () => {},
      onAttention: () => {},
      onError: () => {},
      onClientsChanged: () => changes.push('clients'),
      onCtcp: (sender, body, notice) => ctcp.push(`${sender}:${notice ? 'notice' : 'query'}:${body}`),
      onWhoEnd: (mask) => whoEnds.push(mask),
    });
    chat.setNick('Tergride');
    chat.handle(line(':Tergride!t@h JOIN #aeolus'));
    chat.handle(line(':irc 353 Tergride = #aeolus :Tergride bob alice'));
    chat.handle(line(':irc 366 Tergride #aeolus :End of NAMES'));
    chat.handle(line(':irc 352 Tergride #aeolus b host irc bob H :0 TFAF 0.7.0'));
    chat.handle(line(':irc 352 Tergride #aeolus a host irc alice H :0 alice'));
    // With extended-join the realname comes with the join.
    chat.handle(line(':carol!c@h JOIN #aeolus carol :TFAF 0.6.9'));
    assert.deepEqual(Object.fromEntries(chat.tfafClients()), { bob: '0.7.0', carol: '0.6.9' });
    assert.equal(chat.tfafVersion('Alice'), null);
    assert.equal(chat.tfafVersion('dave'), undefined);

    chat.handle(line(':bob!b@h NICK bobby'));
    chat.handle(line(':carol!c@h PART #aeolus'));
    assert.deepEqual(Object.fromEntries(chat.tfafClients()), { bobby: '0.7.0' });
    chat.handle(line(':bobby!b@h QUIT :bye'));
    assert.equal(chat.tfafClients().size, 0);
    assert.ok(changes.length >= 4);

    // A player outside our channels, asked about with WHO.
    chat.handle(line(':irc 352 Tergride * d host irc dave H :0 TFAF 0.7.0'));
    chat.handle(line(':irc 315 Tergride dave :End of WHO list'));
    assert.equal(chat.tfafVersion('dave'), '0.7.0');
    assert.deepEqual(whoEnds, ['dave']);

    // TFAF CTCP goes to the launcher and never into the chat; our own echo is not news.
    chat.handle(line(`@msgid=c1;time=${now()} :alice!a@h PRIVMSG Tergride :\u0001TFAF LOBBY 42\u0001`));
    chat.handle(line(`@msgid=c2;time=${now()} :Tergride!t@h PRIVMSG alice :\u0001TFAF LOBBY 7\u0001`));
    chat.handle(line(`@msgid=c3;time=${now()} :alice!a@h NOTICE Tergride :\u0001TFAF LOBBY 7 -\u0001`));
    assert.deepEqual(ctcp, ['alice:query:TFAF LOBBY 42', 'alice:notice:TFAF LOBBY 7 -']);
    assert.equal(chat.hasChannel('alice'), false);
  });

  it("keeps TFAF's own channel out of sight while its members tell TFAF players", () => {
    const { chat, events } = model();
    chat.handle(line(`:Tergride!t@h JOIN ${TFAF_CHANNEL}`));
    chat.handle(line(`:bob!b@h JOIN ${TFAF_CHANNEL} bob :TFAF 0.7.0`));
    chat.handle(line(`@msgid=t1;time=${now()} :bob!b@h PRIVMSG ${TFAF_CHANNEL} :Tergride, hello`));
    chat.handle(line(`:irc 474 Tergride ${TFAF_CHANNEL} :Cannot join channel (+b)`));

    assert.deepEqual(chat.list(), []);
    assert.deepEqual(chat.messages(TFAF_CHANNEL), []);
    assert.deepEqual(events.attention, []);
    assert.deepEqual(events.errors, []);
    assert.equal(chat.tfafVersion('bob'), '0.7.0');
  });

  it('shows what ChanServ answers only in a conversation the user opened, and never HistServ', () => {
    const { chat, events } = model();
    chat.handle(line(`@msgid=s1;time=${now()} :ChanServ!s@h NOTICE Tergride :Channel registered`));
    assert.equal(chat.hasChannel('ChanServ'), false);

    chat.openPrivate('ChanServ');
    chat.openPrivate('HistServ');
    chat.handle(line(`@msgid=s2;time=${now()} :ChanServ!s@h NOTICE Tergride :Channel registered`));
    chat.handle(line(`@msgid=s3;time=${now()} :HistServ!s@h NOTICE Tergride :replayed`));
    assert.deepEqual(chat.messages('ChanServ').map((message) => message.text), ['Channel registered']);
    assert.deepEqual(chat.messages('HistServ'), []);

    chat.handle(line(`:irc 324 Tergride ${TFAF_CHANNEL} +Cmnst`));
    assert.equal(events.errors.length, 1);
    assert.ok(events.errors[0]?.includes('+Cmnst'));
  });

  it('counts messages of a watched channel as read, like those of the open one', () => {
    const { chat } = model();
    chat.handle(line(':Tergride!t@h JOIN #party'));
    chat.handle(line(`@msgid=a;time=${now()} :bob!b@h PRIVMSG #party :one`));
    assert.equal(chat.info('#party')?.unread, 1);
    chat.setWatched('#party');
    assert.equal(chat.info('#party')?.unread, 0);
    chat.handle(line(`@msgid=b;time=${now()} :bob!b@h PRIVMSG #party :two`));
    assert.equal(chat.info('#party')?.unread, 0);
  });
});

describe('chat service', () => {
  it('holds its updates for the renderer while paused and sends them once on resume', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    let socialChanged = (): void => {};
    let states = 0;
    const lobby = {
      onSocialChanged: (listener: () => void) => {
        socialChanged = listener;
      },
      getSelf: () => null,
    };
    const service = new ChatService({ lobby } as unknown as ChatServiceDependencies, {
      onState: () => states++,
      onChannel: () => undefined,
      onFocusRequested: () => undefined,
      onNotice: () => undefined,
    });

    socialChanged();
    t.mock.timers.tick(150);
    assert.equal(states, 1);

    service.setUpdatesPaused(true);
    socialChanged();
    socialChanged();
    t.mock.timers.tick(5_000);
    assert.equal(states, 1);

    service.setUpdatesPaused(false);
    t.mock.timers.tick(150);
    assert.equal(states, 2);
  });
});

describe('chat settings', () => {
  it('moves the channels joined by hand into the auto-join list once', () => {
    const migrated = mergeChatPrefs(undefined, ['#tfaf', '#AEOLUS', 'not a channel']);
    assert.deepEqual(migrated.autoJoin.channels, ['#aeolus', '#russian', '#tfaf']);
    assert.equal(migrated.hideFoeMessages, true);
    // Once the chat has its own settings, the old list is not read again.
    assert.deepEqual(mergeChatPrefs({ autoJoin: { channels: [] } }, ['#tfaf']).autoJoin.channels, []);
  });

  it('keeps what is valid and puts defaults in place of the rest', () => {
    const prefs = mergeChatPrefs(
      {
        mutedUsers: ['Troll', 'troll', 'bad nick'],
        colorMode: 'neon',
        groupColors: { friends: '#22AA55', foes: 'red', nobody: '#000000' },
        userColors: { Bob: '#123456', 'x y': '#000000' },
        textScale: 115,
        messageLimit: 123,
      },
      null,
    );
    assert.deepEqual(prefs.mutedUsers, ['troll']);
    assert.equal(prefs.colorMode, 'random');
    assert.deepEqual(prefs.groupColors, { friends: '#22aa55' });
    assert.deepEqual(prefs.userColors, { bob: '#123456' });
    assert.deepEqual([prefs.textScale, prefs.messageLimit], [115, 500]);
  });

  it("joins TFAF's own channel and the clan always, then what the settings allow, the party and the channels open", () => {
    const autoJoin = { enabled: true, channels: ['#aeolus', '#russian'], lobbyChannels: true, newbie: true };
    const context = {
      clanChannel: clanChannel('TFAF'),
      lobbyChannels: ['#tfaf_clan', '#moderators'],
      newbie: true,
      partyChannel: "#Bob'sParty",
      open: ['#Aeolus', '#mine'],
    };
    assert.deepEqual(wantedChannels(autoJoin, context), [
      TFAF_CHANNEL,
      '#TFAF_clan',
      '#aeolus',
      '#russian',
      '#moderators',
      '#newbie',
      "#Bob'sParty",
      '#mine',
    ]);
    assert.deepEqual(wantedChannels({ ...autoJoin, lobbyChannels: false, newbie: false }, context), [
      TFAF_CHANNEL,
      '#TFAF_clan',
      '#aeolus',
      '#russian',
      "#Bob'sParty",
      '#mine',
    ]);
    assert.deepEqual(wantedChannels({ ...autoJoin, enabled: false }, context), [
      TFAF_CHANNEL,
      '#TFAF_clan',
      "#Bob'sParty",
      '#Aeolus',
      '#mine',
    ]);
    assert.deepEqual(wantedChannels({ ...autoJoin, enabled: false }, { ...context, clanChannel: clanChannel(null) }), [
      TFAF_CHANNEL,
      "#Bob'sParty",
      '#Aeolus',
      '#mine',
    ]);
  });
});

describe('link previews', () => {
  it('reads Open Graph data and resolves the image against the page', () => {
    const metadata = parseLinkMetadata(
      `<html><head><title>Fallback &amp; title</title>
      <meta property="og:title" content="FAF &quot;News&quot;">
      <meta content='All about FAF' name="description">
      <meta property="og:image" content="/img/cover.png"></head></html>`,
      new URL('https://www.faforever.com/news/1'),
    );
    assert.deepEqual(
      { ...metadata, image: metadata.image?.href },
      { title: 'FAF "News"', description: 'All about FAF', siteName: null, image: 'https://www.faforever.com/img/cover.png' },
    );
  });

  it('refuses addresses of the local network', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.20.0.1', '169.254.1.1', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1']) {
      assert.equal(isPrivateAddress(address), true, address);
    }
    for (const address of ['8.8.8.8', '172.32.0.1', '2a00:1450::1']) {
      assert.equal(isPrivateAddress(address), false, address);
    }
  });
});
