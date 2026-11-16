<script setup lang="ts">
import { MousePointerClick } from '@lucide/vue';
import { useMediaQuery } from '@vueuse/core';
import { useTemplateRef } from 'vue';

// A list with its toolbar above and the panel of the picked item on the right. Only the list scrolls, so the toolbar
// and the panel stay in place. The list never changes its width when an item is picked, so its cards do not reflow:
// in a wide window the panel is always there and shows `placeholder` until an item is picked; in a narrower one it
// slides in over the list.
const props = defineProps<{ panelOpen: boolean; placeholder: string }>();
const emit = defineEmits<{ closePanel: [] }>();

// The width from which App.vue shows the full sidebar; below it the list keeps the room for itself.
const docked = useMediaQuery('(width >= 72rem)');
const scroller = useTemplateRef<HTMLElement>('scroller');

defineExpose({
  scrollToTop(): void {
    scroller.value?.scrollTo({ top: 0 });
  },
});

function onEscape(): void {
  if (props.panelOpen) {
    emit('closePanel');
  }
}
</script>

<template>
  <section class="relative flex min-h-0 flex-1" @keydown.esc="onEscape">
    <div class="flex min-w-0 flex-1 flex-col">
      <div class="flex flex-col px-7 pt-3">
        <slot name="header" />
      </div>
      <div ref="scroller" class="@container min-h-0 flex-1 overflow-y-auto px-7 pb-8 [scrollbar-gutter:stable]">
        <slot />
      </div>
    </div>
    <!-- The placeholder and the panel lie on top of each other while they cross-fade, so nothing moves. The panel's
         wrapper stays while it switches to another kind of item, so the old and the new panel never cross-fade. -->
    <div v-if="docked" class="relative w-90 shrink-0">
      <Transition
        enter-active-class="transition-opacity duration-150 ease-out"
        enter-from-class="opacity-0"
        leave-active-class="transition-opacity duration-150 ease-in"
        leave-to-class="opacity-0"
      >
        <div v-if="panelOpen" class="absolute inset-0 flex">
          <slot name="panel" />
        </div>
        <aside v-else class="absolute inset-0 flex flex-col items-center justify-center gap-3 border-l bg-card px-10 text-center">
          <MousePointerClick class="size-6 text-faint" />
          <p class="text-sm text-muted-foreground">{{ placeholder }}</p>
        </aside>
      </Transition>
    </div>
    <Transition
      v-else
      enter-active-class="transition-[translate,opacity] duration-200 ease-out"
      enter-from-class="translate-x-full opacity-0"
      leave-active-class="transition-[translate,opacity] duration-150 ease-in"
      leave-to-class="translate-x-full opacity-0"
    >
      <div v-if="panelOpen" class="absolute inset-y-0 right-0 z-20 flex shadow-[-16px_0_32px_rgb(0_0_0/0.55)]">
        <slot name="panel" />
      </div>
    </Transition>
  </section>
</template>
