<script setup lang="ts">
import { ref, watch } from 'vue';
import type { PlayerAvatar } from '../../../shared/contract.ts';

// FAF avatars are 40×20 pictures; one that fails to load is left out rather than shown broken.
const props = defineProps<{ avatar: PlayerAvatar; large?: boolean }>();
const failed = ref(false);

watch(
  () => props.avatar.url,
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <img
    v-if="!failed"
    :src="avatar.url"
    :alt="avatar.tooltip"
    :data-tooltip="avatar.tooltip || undefined"
    class="shrink-0 object-contain"
    :class="large ? 'h-10 w-20' : 'h-4 w-8'"
    draggable="false"
    loading="lazy"
    @error="failed = true"
  />
</template>
