import '@fontsource-variable/exo-2/wght.css';
import '@fontsource-variable/ibm-plex-sans/wght.css';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { createApp } from 'vue';
import App from './App.vue';
import { setChatPrefs } from './composables/useChatPrefs.ts';
import { setNotificationPrefs } from './composables/useNotifications.ts';
import { applyLanguageSettings } from './lib/language.ts';
import './lib/motion.ts';
import { queryClient, watchLocalContent } from './lib/queries.ts';
import './lib/sounds.ts';
import { setTheme } from './lib/theme.ts';
import './styles.css';

watchLocalContent();
// The first render waits for the language, so the interface does not switch languages under the user's eyes.
window.tfaf.settings
  .get()
  .then(
    (settings) => {
      applyLanguageSettings(settings);
      setTheme(settings);
      setNotificationPrefs(settings.notifications);
      setChatPrefs(settings.chat);
    },
    (error: unknown) => console.warn('Settings could not be read for the language', error),
  )
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- typescript-eslint cannot read the type of a .vue module
  .finally(() => createApp(App).use(VueQueryPlugin, { queryClient }).mount('#app'));
