import { useQuery } from '@tanstack/vue-query';
import { computed, type ComputedRef, type Ref } from 'vue';
import type { LiveGame, LobbyGame } from '../../../shared/contract.ts';
import { t } from '../lib/i18n.ts';
import { queries } from '../lib/queries.ts';
import { useAuth } from './useAuth.ts';
import { useGameSession } from './useGameSession.ts';
import { useLobby } from './useLobby.ts';

// Running games are not pushed by the main process, so their list is read again now and then.
const LIVE_REFRESH_MS = 30_000;

/** `open`: one can join right away; `password`: with the game's password; `closed`: not now, see the reason. */
export type JoinState = 'open' | 'password' | 'closed';

export type PlayerGame =
  | { kind: 'lobby'; game: LobbyGame; host: boolean; join: JoinState; reason: string }
  | { kind: 'playing'; game: LiveGame };

/**
 * The game each online player is in: an open custom or coop lobby, which one may join, or a running game, which one
 * may watch. Running games are only looked up while `watchRunning` is set, e.g. while the chat is on screen.
 */
export function usePlayerGames(watchRunning: Ref<boolean>): ComputedRef<ReadonlyMap<number, PlayerGame>> {
  const { state: lobby, games } = useLobby();
  const { state: session } = useGameSession();
  const auth = useAuth();
  const selfId = computed(() => (auth.value?.status === 'signedIn' ? auth.value.user.id : null));
  const live = useQuery(() => ({
    ...queries.liveReplays(),
    enabled: watchRunning.value && lobby.value.status === 'connected',
    refetchInterval: LIVE_REFRESH_MS,
  }));

  function joinState(game: LobbyGame): { join: JoinState; reason: string } {
    if (game.teams.some((team) => team.players.some((player) => player.id !== null && player.id === selfId.value))) {
      return { join: 'closed', reason: t('games.joinState.alreadyIn') };
    }
    if (lobby.value.status !== 'connected') {
      return { join: 'closed', reason: t('games.joinState.noLobby') };
    }
    if (session.value.phase !== 'idle') {
      return { join: 'closed', reason: t('games.joinState.otherGameRunning') };
    }
    if (game.maxPlayers > 0 && game.numPlayers >= game.maxPlayers) {
      return { join: 'closed', reason: t('games.joinState.full') };
    }
    // The server sees a password on every TFAF lobby; whether its host set one, the launcher asks the host on joining.
    if (game.passwordProtected && !game.tfafLobby) {
      return { join: 'password', reason: t('games.joinState.password') };
    }
    return { join: 'open', reason: t('games.joinState.open') };
  }

  return computed(() => {
    const byPlayer = new Map<number, PlayerGame>();
    for (const game of live.data.value ?? []) {
      for (const player of game.teams.flatMap((team) => team.players)) {
        if (player.id !== null) {
          byPlayer.set(player.id, { kind: 'playing', game });
        }
      }
    }
    // Lobbies come from the server as they change, so they win over the running games read a while ago.
    for (const game of games.value) {
      const join = joinState(game);
      for (const player of game.teams.flatMap((team) => team.players)) {
        if (player.id !== null) {
          byPlayer.set(player.id, { kind: 'lobby', game, host: player.login === game.host, ...join });
        }
      }
    }
    return byPlayer;
  });
}
