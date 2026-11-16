<script setup lang="ts">
import { Copy, Minus, Square, X } from '@lucide/vue';
import logoUrl from '../assets/logo.png';
import { useAppWindow } from '../composables/useAppWindow.ts';
import { t } from '../lib/i18n.ts';

const windowState = useAppWindow();
const controls = window.tfaf.appWindow;
</script>

<template>
  <!-- Stays above modal overlays so the window can always be moved, minimized or closed. -->
  <header
    class="drag-region pointer-events-auto relative z-60 flex h-(--titlebar-height) shrink-0 items-center gap-4 border-b bg-hull"
    :class="$slots.start ? 'pl-1.5' : 'pl-3.5'"
  >
    <div v-if="$slots.start" class="-mr-2 flex items-center">
      <slot name="start" />
    </div>
    <div class="flex items-center gap-2.5 transition-opacity" :class="{ 'opacity-60': !windowState.focused }">
      <img :src="logoUrl" alt="" class="size-6" draggable="false" />
      <span class="font-display text-[15px] leading-none font-bold tracking-[0.16em]">TFAF</span>
    </div>
    <div class="flex min-w-0 flex-1 items-center justify-end gap-4 transition-opacity" :class="{ 'opacity-60': !windowState.focused }">
      <slot />
    </div>
    <div class="no-drag flex h-full" data-window-controls>
      <button
        type="button"
        tabindex="-1"
        :aria-label="t('app.window.minimize')"
        class="grid h-full w-[46px] place-items-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        @click="controls.minimize()"
      >
        <Minus class="size-4" :stroke-width="1.25" />
      </button>
      <button
        type="button"
        tabindex="-1"
        :aria-label="windowState.maximized ? t('app.window.restore') : t('app.window.maximize')"
        class="grid h-full w-[46px] place-items-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        @click="controls.toggleMaximize()"
      >
        <Copy v-if="windowState.maximized" class="size-3.5 -scale-x-100" :stroke-width="1.25" />
        <Square v-else class="size-3.5" :stroke-width="1.25" />
      </button>
      <button
        type="button"
        tabindex="-1"
        :aria-label="t('common.close')"
        class="grid h-full w-[46px] place-items-center text-muted-foreground transition-colors hover:bg-[#c42b1c] hover:text-white"
        @click="controls.close()"
      >
        <X class="size-4" :stroke-width="1.25" />
      </button>
    </div>
  </header>
</template>
