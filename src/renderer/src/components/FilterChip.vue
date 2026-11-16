<script setup lang="ts">
defineProps<{ pressed: boolean }>();
defineEmits<{ toggle: [] }>();
</script>

<template>
  <button
    type="button"
    class="plate plate-control plate-focus cut-xs inline-flex h-7 min-w-7.5 shrink-0 items-center justify-center gap-1.5 px-2 text-[13px] font-medium whitespace-nowrap tabular-nums transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0"
    :class="
      pressed
        ? 'bg-primary/12 text-primary [--plate-border:var(--color-primary)]'
        : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground'
    "
    :aria-pressed="pressed"
    @click="$emit('toggle')"
  >
    <slot />
  </button>
</template>
