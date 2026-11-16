<script setup lang="ts">
import { Progress } from '@/components/ui/progress';

// `value` is 0..1; null while the total is unknown, which shows a running stripe instead.
defineProps<{ value: number | null; done?: boolean }>();
</script>

<template>
  <div v-if="value === null && !done" class="relative h-1 overflow-hidden bg-background">
    <div class="absolute inset-y-0 w-1/3 animate-[indeterminate_1.1s_ease-in-out_infinite] bg-primary" data-loading-motion />
  </div>
  <Progress
    v-else
    :model-value="done ? 100 : Math.round((value ?? 0) * 100)"
    class="h-1 bg-background"
    :class="{ '*:data-[slot=progress-indicator]:bg-success': done }"
  />
</template>

<!-- Not scoped: a scoped block would rename the keyframes, and the Tailwind class refers to them by name. -->
<style>
@keyframes indeterminate {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(300%);
  }
}
</style>
