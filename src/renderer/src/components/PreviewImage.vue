<script setup lang="ts">
import { ref, watch } from 'vue';

// `small` fits the fallback text into a thumbnail.
const props = defineProps<{ src: string | null | undefined; fallback?: string; lazy?: boolean; small?: boolean }>();

const failed = ref(false);
watch(
  () => props.src,
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <img
    v-if="src && !failed"
    :src="src"
    alt=""
    draggable="false"
    :loading="lazy ? 'lazy' : undefined"
    class="size-full object-cover"
    @error="failed = true"
  />
  <div
    v-else
    class="flex size-full items-center justify-center bg-linear-to-br from-secondary to-background font-display font-semibold text-muted-foreground/50"
    :class="small ? 'text-[11px]' : 'text-2xl tracking-widest'"
  >
    {{ fallback ?? '' }}
  </div>
</template>
