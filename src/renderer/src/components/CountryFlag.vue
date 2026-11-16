<script setup lang="ts">
import { computed } from 'vue';
import { countryName } from '../format.ts';
import { countryFlagUrl } from '../lib/countryFlags.ts';

const props = defineProps<{ country?: string | null }>();

const url = computed(() => (props.country ? countryFlagUrl(props.country) : undefined));
const name = computed(() => (props.country ? countryName(props.country) : undefined));
</script>

<template>
  <span class="inline-flex w-4 shrink-0 items-center justify-center" :data-tooltip="name">
    <img v-if="url" :src="url" :alt="name" class="size-4" draggable="false" />
    <span v-else-if="country" class="text-[10px] font-semibold text-muted-foreground">{{ country }}</span>
  </span>
</template>
