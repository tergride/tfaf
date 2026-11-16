// How TFAF launchers find each other in FAF's chat. A TFAF launcher's IRC realname names its version, so every client
// that shares a channel with it, or asks the server with WHO, can tell; the official client puts the login there. Every
// TFAF launcher is in one channel of its own, never shown, so they all share at least that one. To learn the lobby
// features of a game before joining it (lobbyFeatures.ts), a launcher sends the host a CTCP query in a private message,
// which IRC clients do not show, and the host's launcher answers with a CTCP notice. An invitation into a game
// (gameInvites.ts) goes the same way: the game and the password the server checks for it, answered with a notice.

import { CHAT_LIMITS, HOST_GAME_LIMITS } from '../../shared/contract.ts';

/**
 * The channel every TFAF launcher joins and never leaves; nothing said there is shown. It is registered with ChanServ
 * by hand and set +sm, so no launcher becomes its operator, LIST and WHOIS do not show it and only operators speak.
 */
export const TFAF_CHANNEL = '#tfaf-presence-7c1e94';

export function isTfafChannel(name: string): boolean {
  return name.toLowerCase() === TFAF_CHANNEL;
}

export const CTCP = '\u0001';
const REALNAME = /^TFAF (\d{1,3}\.\d{1,3}\.\d{1,3})$/;
const LOBBY_QUERY = /^TFAF LOBBY (\d{1,10})$/;
const LOBBY_REPLY = /^TFAF LOBBY (\d{1,10}) (.+)$/;
// The password goes as base64url of its UTF-8 bytes, so any character of it survives the chat; `-` is no password.
const INVITE = /^TFAF INVITE (\d{1,10}) ([A-Za-z0-9_-]{1,400})$/;
const INVITE_REPLY = /^TFAF INVITE (\d{1,10}) (ok|notFriend|unavailable)$/;
/** The answer of a launcher that does not host that game in its lobby; an invitation to a game without a password. */
const NO_GAME = '-';
const NO_PASSWORD = '-';

export function tfafRealname(version: string): string {
  return `TFAF ${version}`;
}

/** The TFAF version a realname names; null for another client. */
export function parseTfafRealname(realname: string): string | null {
  return REALNAME.exec(realname)?.[1] ?? null;
}

/**
 * How an invited player's launcher took the invitation: `ok` shown to the player, `notFriend` refused because the
 * inviter is not the player's friend, `unavailable` refused because the player does not see that open game.
 */
export type InviteAnswer = 'ok' | 'notFriend' | 'unavailable';

export type TfafCtcp =
  | { kind: 'lobbyQuery'; gameId: number }
  /** `announcement`: serialized (lobbyFeatures.ts), null when the sender does not host the game. */
  | { kind: 'lobbyReply'; gameId: number; announcement: string | null }
  /** `password`: what the server checks for the game, null for a game without one. */
  | { kind: 'invite'; gameId: number; password: string | null }
  | { kind: 'inviteReply'; gameId: number; answer: InviteAnswer };

function decodePassword(encoded: string): string | null | undefined {
  if (encoded === NO_PASSWORD) {
    return null;
  }
  const password = Buffer.from(encoded, 'base64url').toString('utf8');
  // Anything that does not encode back the same way is not what a launcher sent.
  const valid = password.length > 0 && password.length <= HOST_GAME_LIMITS.passwordMaxLength && Buffer.from(password, 'utf8').toString('base64url') === encoded;
  return valid ? password : undefined;
}

/** A TFAF CTCP message from its body (the text between the \u0001 marks); null for any other. */
export function parseTfafCtcp(body: string, notice: boolean): TfafCtcp | null {
  if (!notice) {
    const query = LOBBY_QUERY.exec(body);
    if (query) {
      return { kind: 'lobbyQuery', gameId: Number(query[1]) };
    }
    const invite = INVITE.exec(body);
    const password = invite ? decodePassword(invite[2]!) : undefined;
    return invite && password !== undefined ? { kind: 'invite', gameId: Number(invite[1]), password } : null;
  }
  const inviteReply = INVITE_REPLY.exec(body);
  if (inviteReply) {
    return { kind: 'inviteReply', gameId: Number(inviteReply[1]), answer: inviteReply[2] as InviteAnswer };
  }
  const reply = LOBBY_REPLY.exec(body);
  if (!reply) {
    return null;
  }
  return { kind: 'lobbyReply', gameId: Number(reply[1]), announcement: reply[2] === NO_GAME ? null : reply[2]! };
}

export function lobbyQuery(gameId: number): string {
  return `${CTCP}TFAF LOBBY ${gameId}${CTCP}`;
}

export function lobbyReply(gameId: number, announcement: string | null): string {
  return `${CTCP}TFAF LOBBY ${gameId} ${announcement ?? NO_GAME}${CTCP}`;
}

/** A password of the longest length, in any script, still fits into one chat message. */
export function gameInvite(gameId: number, password: string | null): string {
  const encoded = password === null ? NO_PASSWORD : Buffer.from(password, 'utf8').toString('base64url');
  return `${CTCP}TFAF INVITE ${gameId} ${encoded}${CTCP}`;
}

export function gameInviteReply(gameId: number, answer: InviteAnswer): string {
  return `${CTCP}TFAF INVITE ${gameId} ${answer}${CTCP}`;
}

/** Bytes left for the announcement in a reply that has to fit into one chat message. */
export function lobbyReplyRoom(gameId: number): number {
  return CHAT_LIMITS.messageMaxBytes - Buffer.byteLength(lobbyReply(gameId, ''), 'utf8');
}
