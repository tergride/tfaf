<script setup lang="ts">
// A lit lamp with a word, as on a status board; `overlay` sets it on a dark plate over a picture, `large` makes it a main status line.
defineProps<{ tone: 'success' | 'warning' | 'info' | 'muted'; overlay?: boolean; large?: boolean }>();
</script>

<template>
  <span
    class="inline-flex items-center font-medium whitespace-nowrap"
    :class="[
      large ? 'gap-2 text-sm' : 'gap-1.5 text-xs',
      { success: 'text-success', warning: 'text-warning', info: 'text-info', muted: 'text-faint' }[tone],
      overlay && 'plate cut-xs h-5.5 bg-hull/85 px-2 backdrop-blur-sm [--plate-border:transparent]',
    ]"
  >
    <span v-if="tone !== 'muted'" class="shrink-0 rounded-full bg-current shadow-[0_0_6px_currentColor]" :class="large ? 'size-2' : 'size-1.5'" />
    <slot />
  </span>
</template>
