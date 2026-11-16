<script setup lang="ts">
import { Lock, Trophy } from '@lucide/vue';
import { computed, onMounted, ref, shallowRef } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import type { ProfileAchievement } from '../../../shared/contract.ts';
import { errorMessage, formatDate, formatNumber } from '../format.ts';
import { t } from '../lib/i18n.ts';
import FilterChip from './FilterChip.vue';

const props = defineProps<{ playerId: number }>();

const achievements = shallowRef<ProfileAchievement[] | null>(null);
const error = ref<string | null>(null);
const onlyUnlocked = ref(false);

onMounted(async () => {
  try {
    achievements.value = await window.tfaf.profile.achievements(props.playerId);
  } catch (cause) {
    error.value = errorMessage(cause);
  }
});

const unlocked = computed(() => (achievements.value ?? []).filter((achievement) => achievement.state === 'unlocked'));
// Unlocked first, the most recent on top, then the rest in the official order.
const shown = computed(() => {
  const list = achievements.value ?? [];
  const recent = [...unlocked.value].sort((a, b) => (b.unlockedAt ?? '').localeCompare(a.unlockedAt ?? ''));
  return onlyUnlocked.value ? recent : [...recent, ...list.filter((achievement) => achievement.state !== 'unlocked')];
});
const experience = computed(() => unlocked.value.reduce((sum, achievement) => sum + achievement.experiencePoints, 0));

function progress(achievement: ProfileAchievement): number | null {
  if (achievement.totalSteps === null || achievement.totalSteps <= 0 || achievement.currentSteps === null) {
    return null;
  }
  return Math.min(1, achievement.currentSteps / achievement.totalSteps);
}
</script>

<template>
  <Alert v-if="error" variant="destructive"><AlertDescription class="selectable">{{ error }}</AlertDescription></Alert>
  <div v-else-if="!achievements" class="grid h-40 place-items-center"><Spinner class="size-5 text-primary" /></div>
  <div v-else class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-3">
      <span class="text-sm">
        {{ t('profile.achievements.summary', { unlocked: unlocked.length, total: achievements.length }) }}
        <span class="text-muted-foreground">· {{ t('profile.achievements.experience', { points: formatNumber(experience) }) }}</span>
      </span>
      <FilterChip class="ml-auto" :pressed="onlyUnlocked" @toggle="onlyUnlocked = !onlyUnlocked">
        {{ t('profile.achievements.onlyUnlocked') }}
      </FilterChip>
    </div>
    <ul class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
      <li
        v-for="achievement in shown"
        :key="achievement.id"
        class="plate cut-sm flex gap-3 bg-background p-2.5"
        :class="achievement.state === 'unlocked' ? '[--plate-border:color-mix(in_srgb,var(--color-primary)_35%,transparent)]' : 'opacity-70'"
      >
        <img
          v-if="achievement.iconUrl"
          :src="achievement.iconUrl"
          alt=""
          class="size-12 shrink-0 object-contain"
          :class="{ grayscale: achievement.state !== 'unlocked' }"
          draggable="false"
          loading="lazy"
        />
        <div v-else class="grid size-12 shrink-0 place-items-center bg-secondary text-muted-foreground">
          <Lock v-if="achievement.state !== 'unlocked'" class="size-5" />
          <Trophy v-else class="size-5" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-sm font-semibold">
            {{ achievement.state === 'hidden' ? t('profile.achievements.hidden') : achievement.name }}
          </span>
          <span class="text-xs text-muted-foreground">
            {{ achievement.state === 'hidden' ? t('profile.achievements.hiddenDescription') : achievement.description }}
          </span>
          <span v-if="achievement.state === 'unlocked' && achievement.unlockedAt" class="text-[11px] text-primary">
            {{ t('profile.achievements.unlockedAt', { date: formatDate(achievement.unlockedAt) ?? '' }) }}
          </span>
          <div v-else-if="progress(achievement) !== null" class="mt-1 flex items-center gap-2">
            <div class="h-1 flex-1 bg-secondary">
              <div class="h-full bg-primary" :style="{ width: `${progress(achievement)! * 100}%` }" />
            </div>
            <span class="text-[11px] text-muted-foreground tabular-nums">
              {{ formatNumber(achievement.currentSteps ?? 0) }}/{{ formatNumber(achievement.totalSteps ?? 0) }}
            </span>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
