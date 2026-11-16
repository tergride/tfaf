// How a TFAF lobby keeps other clients out. The title says what the game is, and the password the server checks comes
// from the host's password in a way that only TFAF launchers apply, so another client is refused before its game starts.

import { createHash } from 'node:crypto';

const TITLE_PREFIX = '[TFAF] ';
const PASSWORD_SALT = 'tfaf-lobby-v1:';
const PASSWORD_LENGTH = 32;

export function lobbyServerTitle(title: string): string {
  return `${TITLE_PREFIX}${title}`;
}

export function isLobbyServerTitle(title: string): boolean {
  return title.startsWith(TITLE_PREFIX);
}

export function lobbyTitle(serverTitle: string): string {
  return isLobbyServerTitle(serverTitle) ? serverTitle.slice(TITLE_PREFIX.length) : serverTitle;
}

/** No password of the host's still gives a password: it is what stops the other clients. */
export function lobbyServerPassword(password: string | null): string {
  return createHash('sha256')
    .update(`${PASSWORD_SALT}${password ?? ''}`)
    .digest('hex')
    .slice(0, PASSWORD_LENGTH);
}
