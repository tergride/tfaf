import { computed, readonly, ref, shallowRef } from 'vue';
import type { LobbyGame, LobbyGamesUpdate, LobbyState } from '../../../shared/contract.ts';

const state = ref<LobbyState>({ status: 'disconnected', error: null });
const gamesById = shallowRef(new Map<number, LobbyGame>());
let initialized = false;

function apply(update: LobbyGamesUpdate): void {
  const next = new Map(update.reset ? [] : gamesById.value);
  for (const id of update.removals) {
    next.delete(id);
  }
  for (const game of update.upserts) {
    next.set(game.id, game);
  }
  gamesById.value = next;
}

export function useLobby() {
  if (!initialized) {
    initialized = true;
    let snapshotLoaded = false;
    let receivedState = false;
    window.tfaf.lobby.onStateChanged((next) => {
      receivedState = true;
      state.value = next;
    });
    // Updates sent before the snapshot was taken are already part of it, so they are skipped.
    window.tfaf.lobby.onGamesChanged((update) => {
      if (snapshotLoaded) {
        apply(update);
      }
    });
    void window.tfaf.lobby.getState().then((initial) => {
      if (!receivedState) {
        state.value = initial;
      }
    });
    void window.tfaf.lobby.getGames().then((games) => {
      gamesById.value = new Map(games.map((game) => [game.id, game]));
      snapshotLoaded = true;
    });
  }

  return {
    state: readonly(state),
    games: computed(() => [...gamesById.value.values()]),
    reconnect: () => window.tfaf.lobby.reconnect(),
  };
}
