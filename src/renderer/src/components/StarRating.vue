<script setup lang="ts">
import { Star } from '@lucide/vue';
import { ref } from 'vue';
import { REVIEW_LIMITS } from '../../../shared/contract.ts';
import { t } from '../lib/i18n.ts';

// Stars of a review: shown, or picked when `editable`. A score of 0 means none picked yet.
const props = defineProps<{ score: number; editable?: boolean; size?: 'sm' | 'md' }>();
const emit = defineEmits<{ 'update:score': [score: number] }>();

const STARS = Array.from({ length: REVIEW_LIMITS.maxScore }, (_, index) => index + 1);
const hovered = ref<number | null>(null);

function onKeydown(event: KeyboardEvent): void {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
  if (step !== 0) {
    event.preventDefault();
    emit('update:score', Math.min(REVIEW_LIMITS.maxScore, Math.max(REVIEW_LIMITS.minScore, props.score + step)));
  }
}
</script>

<template>
  <div
    v-if="editable"
    class="flex items-center gap-0.5"
    role="radiogroup"
    :aria-label="t('reviews.score')"
    @keydown="onKeydown"
    @pointerleave="hovered = null"
  >
    <button
      v-for="star in STARS"
      :key="star"
      type="button"
      role="radio"
      class="p-0.5 outline-none focus-visible:outline-2 focus-visible:outline-ring"
      :aria-checked="score === star"
      :aria-label="t('reviews.stars', { count: star })"
      :tabindex="score === star || (score === 0 && star === 1) ? 0 : -1"
      @pointerenter="hovered = star"
      @click="emit('update:score', star)"
    >
      <Star class="size-5 transition-colors" :class="star <= (hovered ?? score) ? 'fill-warning text-warning' : 'text-faint'" />
    </button>
  </div>
  <span v-else class="flex items-center gap-px" role="img" :aria-label="t('reviews.stars', { count: score })">
    <Star
      v-for="star in STARS"
      :key="star"
      :class="[size === 'md' ? 'size-4' : 'size-3', star <= score ? 'fill-warning text-warning' : 'text-faint']"
    />
  </span>
</template>
