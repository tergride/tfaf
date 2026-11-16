import { ref } from 'vue';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { confirmAction } from './useConfirm.ts';
import { useGameSession } from './useGameSession.ts';

/** Closes Forged Alliance once the user confirms; `error` keeps why it could not be closed. */
export function useCloseGame() {
  const { state } = useGameSession();
  const error = ref<string | null>(null);

  async function close(): Promise<void> {
    const confirmed = await confirmAction({
      title: t('currentGame.banner.killConfirm'),
      description: t(`currentGame.banner.killWarnings.${state.value.kind}`),
      confirmText: t('currentGame.banner.closeGame'),
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    try {
      await window.tfaf.game.kill();
    } catch (cause) {
      error.value = errorMessage(cause);
    }
  }

  return { close, error };
}
