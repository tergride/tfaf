import { readonly, ref } from 'vue';

// Another view, such as the chat, asks to show an open game: the app switches to its list, the list opens its panel.
const request = ref<{ gameId: number; at: number } | null>(null);

export function useGameFocus() {
  return {
    request: readonly(request),
    focus(gameId: number): void {
      request.value = { gameId, at: Date.now() };
    },
    /** The list that showed the game clears the request, so it is not shown again later. */
    done(): void {
      request.value = null;
    },
  };
}
