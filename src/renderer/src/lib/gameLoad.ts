// The setting that reduces the launcher's load during a game, for what the page itself does about it; the main process
// handles the rest (game/gameLoadSaver.ts). Until the settings answer it stays off.
import { readonly, ref } from 'vue';

const enabled = ref(false);

window.tfaf.settings.get().then(
  (settings) => setReduceGameLoad(settings.reduceGameLoad),
  () => undefined,
);

export const reduceGameLoad = readonly(enabled);

/** Applies the setting saved in the settings. */
export function setReduceGameLoad(value: boolean): void {
  enabled.value = value;
}
