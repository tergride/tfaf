import { readonly, ref } from 'vue';

// A join that needs the game's password, from wherever it started: the chat, an invitation, a friend's Discord status.
// The app opens the password dialog once the game is in its list of open games.
const request = ref<{ gameId: number; at: number } | null>(null);

export function useJoinPassword() {
  return {
    request: readonly(request),
    ask(gameId: number): void {
      request.value = { gameId, at: Date.now() };
    },
    done(): void {
      request.value = null;
    },
  };
}
