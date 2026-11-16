<script setup lang="ts">
import { SlidersHorizontal } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { type BuiltInTheme, type CustomTheme, type Theme, THEMES } from '../../../shared/contract.ts';
import { resolveTheme, themeStyle } from '../../../shared/themes.ts';
import splashUrl from '../assets/splash.jpg';
// Small copies of the game's textures/ui/common/BACKGROUND/faction/faction-background-paint_*_bmp.dds.
import aeonArt from '../assets/themes/aeon.jpg';
import cybranArt from '../assets/themes/cybran.jpg';
import seraphimArt from '../assets/themes/seraphim.jpg';
import uefArt from '../assets/themes/uef.jpg';
import { t } from '../lib/i18n.ts';

const model = defineModel<Theme>({ required: true });
const props = defineProps<{ customTheme: CustomTheme }>();
const emit = defineEmits<{ customize: [] }>();

const ART: Record<BuiltInTheme, string> = { default: splashUrl, uef: uefArt, aeon: aeonArt, cybran: cybranArt, seraphim: seraphimArt };

function appearance(theme: Theme) {
  return resolveTheme({ theme, customTheme: props.customTheme });
}
</script>

<template>
  <div class="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-3 p-1.5" role="group" :aria-label="t('settings.interface.theme')">
    <div v-for="theme in THEMES" :key="theme" class="relative min-w-0" :class="{ brackets: theme === model }" :data-theme="appearance(theme).controls" :style="themeStyle(appearance(theme).colors)">
      <button
        type="button"
        class="plate plate-focus cut-lg flex w-full min-w-0 flex-col overflow-hidden bg-card text-left text-foreground transition-colors"
        :class="theme === model ? '[--plate-border:var(--color-primary)]' : 'hover:[--plate-border:var(--color-input)]'"
        :aria-pressed="theme === model"
        @click="model = theme"
      >
        <span class="block aspect-16/10 overflow-hidden bg-hull">
          <img
            v-if="theme !== 'custom'"
            :src="ART[theme]"
            alt=""
            class="size-full"
            :class="theme === 'default' ? 'object-contain [mask-image:radial-gradient(circle,black_58%,transparent_71%)]' : 'object-cover'"
            draggable="false"
          />
          <span v-else class="flex size-full items-center justify-center p-3" aria-hidden="true">
            <span class="plate cut-sm flex w-full max-w-28 flex-col gap-2 bg-card p-3">
              <span class="h-1 w-2/3 bg-foreground" />
              <span class="h-1 w-full bg-muted-foreground/50" />
              <span class="flex gap-1.5">
                <span class="plate plate-control cut-xs h-4 flex-1 bg-primary [--plate-border:transparent]" />
                <span class="plate plate-control cut-xs h-4 flex-1 bg-secondary [--plate-border:var(--color-input)]" />
              </span>
            </span>
          </span>
        </span>
        <span class="flex flex-col gap-1.5 px-2.5 pt-2 pb-2.5">
          <span class="truncate font-display text-sm font-semibold">{{ t(`settings.interface.themes.${theme}`) }}</span>
          <span class="flex gap-0.75" aria-hidden="true">
            <span class="h-1.25 flex-1 bg-primary" />
            <span class="h-1.25 flex-1 bg-info" />
            <span class="h-1.25 flex-1 bg-input" />
            <span class="h-1.25 flex-1 border bg-card" />
          </span>
        </span>
      </button>
      <Button v-if="theme === 'custom'" variant="outline" size="sm" class="mt-2 w-full" @click="emit('customize')">
        <SlidersHorizontal />{{ t('settings.interface.custom.configure') }}
      </Button>
    </div>
  </div>
</template>
