<script setup lang="ts">
import { ChevronRight } from '@lucide/vue';

defineProps<{ heading: string; number: string; open?: boolean }>();
</script>

<template>
  <details class="group/sm border-b" :open="open">
    <summary class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 select-none hover:bg-accent/40 [&::-webkit-details-marker]:hidden">
      <ChevronRight class="size-4 text-muted-foreground transition-transform group-open/sm:rotate-90" />
      <span class="flex-1 font-display text-sm font-semibold tracking-wide uppercase">{{ heading }}</span>
      <span class="text-xs text-muted-foreground tabular-nums">{{ number }}</span>
    </summary>
    <div class="flex flex-col gap-4 px-4 pt-1 pb-5">
      <slot />
    </div>
  </details>
</template>
