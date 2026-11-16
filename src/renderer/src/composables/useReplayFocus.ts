import { readonly, ref } from 'vue';

// Another view asks for replays: a player's (from the chat or a profile), or one game to review after it ended. The app
// switches to the replays, the vault filters by the player or opens the game.
const request = ref<{ player: string; at: number } | { gameId: number; at: number } | null>(null);

export function useReplayFocus() {
  return {
    request: readonly(request),
    focusPlayer(player: string): void {
      request.value = { player, at: Date.now() };
    },
    focusGame(gameId: number): void {
      request.value = { gameId, at: Date.now() };
    },
    /** The replays view clears the request once applied, so it is not applied again later. */
    done(): void {
      request.value = null;
    },
  };
}
