import { Play, Swords } from '@lucide/vue';
import type { Component } from 'vue';
import type { JoinState, PlayerGame } from '../composables/usePlayerGames.ts';
import { mapDisplayName } from '../format.ts';
import { t } from './i18n.ts';

export const JOIN_TONES: Record<JoinState, string> = {
  open: 'text-success',
  password: 'text-warning',
  closed: 'text-faint',
};

export interface PlayerActivity {
  icon: Component;
  tone: string;
  hint: string;
  map: string;
}

export function gameTitle(game: PlayerGame): string {
  return game.game.title || t('chat.users.untitled');
}

function gameHint(game: PlayerGame): string {
  const title = gameTitle(game);
  if (game.kind === 'playing') {
    return t('chat.users.playing', { title });
  }
  return t(game.host ? 'chat.users.hostingHint' : 'chat.users.inLobbyHint', { title, reason: game.reason });
}

/** The mark after a nick: a lobby coloured by whether one can join, or a running game. */
export function playerActivity(game: PlayerGame | null): PlayerActivity | null {
  if (!game) {
    return null;
  }
  const map = mapDisplayName(game.game.mapFolderName);
  return game.kind === 'lobby'
    ? { icon: Swords, tone: JOIN_TONES[game.join], hint: gameHint(game), map }
    : { icon: Play, tone: 'text-info', hint: gameHint(game), map };
}
