<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { type PlayerProfile, PROFILE_PERIODS, type ProfilePeriod, type RatingHistoryPoint } from '../../../shared/contract.ts';
import { errorMessage, formatDateTime, formatNumber } from '../format.ts';
import { t } from '../lib/i18n.ts';
import FilterChip from './FilterChip.vue';
import LineChart from './LineChart.vue';

const props = defineProps<{ profile: PlayerProfile }>();

// The official client opens the chart on the last month of the first leaderboard.
const leaderboardId = ref(props.profile.ratings[0]?.leaderboardId ?? null);
const period = ref<ProfilePeriod>('month');
const history = shallowRef<RatingHistoryPoint[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
let request = 0;

const leaderboardName = computed(() => props.profile.ratings.find((rating) => rating.leaderboardId === leaderboardId.value)?.name ?? '');
const points = computed(() => history.value.map((point) => ({ x: Date.parse(point.time), y: point.rating })));
const change = computed(() => {
  const first = history.value[0];
  const last = history.value.at(-1);
  return first && last && history.value.length > 1 ? last.rating - first.rating : null;
});

watch(
  [leaderboardId, period],
  async ([id, chosen]) => {
    if (!id) {
      return;
    }
    const current = ++request;
    loading.value = true;
    error.value = null;
    try {
      const next = await window.tfaf.profile.ratingHistory(props.profile.id, id, chosen);
      if (current === request) {
        history.value = next;
      }
    } catch (cause) {
      if (current === request) {
        history.value = [];
        error.value = errorMessage(cause);
      }
    } finally {
      if (current === request) {
        loading.value = false;
      }
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="profile.ratings.length === 0" class="text-sm text-muted-foreground">{{ t('profile.overview.noRatings') }}</p>
    <template v-else>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div class="flex flex-wrap gap-0.75" role="group" :aria-label="t('profile.rating.leaderboard')">
          <FilterChip
            v-for="rating in profile.ratings"
            :key="rating.leaderboardId"
            :pressed="leaderboardId === rating.leaderboardId"
            @toggle="leaderboardId = rating.leaderboardId"
          >
            {{ rating.name }}
          </FilterChip>
        </div>
        <div class="ml-auto flex flex-wrap gap-0.75" role="group" :aria-label="t('profile.rating.period')">
          <FilterChip v-for="value in PROFILE_PERIODS" :key="value" :pressed="period === value" @toggle="period = value">
            {{ t(`profile.rating.periods.${value}`) }}
          </FilterChip>
        </div>
      </div>

      <Alert v-if="error" variant="destructive"><AlertDescription class="selectable">{{ error }}</AlertDescription></Alert>
      <div v-else class="relative min-h-[260px]">
        <div v-if="loading" class="absolute inset-0 z-10 grid place-items-center bg-card/60"><Spinner class="size-5 text-primary" /></div>
        <LineChart
          v-if="points.length"
          :points="points"
          :label="t('profile.rating.chartLabel', { leaderboard: leaderboardName })"
        >
          <template #tooltip="{ index }">
            <span class="font-display text-sm font-semibold tabular-nums">{{ formatNumber(history[index]!.rating) }}</span>
            <span class="text-muted-foreground">{{ formatDateTime(history[index]!.time) }}</span>
            <span v-if="history[index]!.gameId" class="text-muted-foreground">{{ t('profile.rating.game', { id: history[index]!.gameId! }) }}</span>
          </template>
        </LineChart>
        <p v-else-if="!loading" class="grid h-[260px] place-items-center text-sm text-muted-foreground">{{ t('profile.rating.noGames') }}</p>
      </div>
      <p v-if="history.length && !error" class="text-xs text-muted-foreground">
        {{ t('profile.rating.summary', { count: history.length }) }}
        <span v-if="change !== null" :class="change >= 0 ? 'text-success' : 'text-destructive'">
          {{ change >= 0 ? '+' : '' }}{{ formatNumber(change) }}
        </span>
      </p>
    </template>
  </div>
</template>
