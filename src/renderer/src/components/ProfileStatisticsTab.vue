<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import type { PlayerStatistics, UnitCounts } from '../../../shared/contract.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import { errorMessage, factionLabel, formatNumber } from '../format.ts';
import { emoticonSrc } from '../lib/chatText.ts';
import { t } from '../lib/i18n.ts';
import DetailStats from './DetailStats.vue';

const props = defineProps<{ playerId: number }>();

const CATEGORIES: { key: keyof UnitCounts; label: MessageKey }[] = [
  { key: 'land', label: 'profile.statistics.land' },
  { key: 'air', label: 'profile.statistics.air' },
  { key: 'naval', label: 'profile.statistics.naval' },
];
const TECH: { key: keyof UnitCounts; label: MessageKey }[] = [
  { key: 'tech1', label: 'profile.statistics.tech1' },
  { key: 'tech2', label: 'profile.statistics.tech2' },
  { key: 'tech3', label: 'profile.statistics.tech3' },
  { key: 'experimentals', label: 'profile.statistics.experimentals' },
];

const statistics = shallowRef<PlayerStatistics | null>(null);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    statistics.value = await window.tfaf.profile.statistics(props.playerId);
  } catch (cause) {
    error.value = errorMessage(cause);
  }
});

const factionMax = computed(() => Math.max(1, ...(statistics.value?.factions ?? []).map((entry) => entry.games)));

function rows(groups: { key: keyof UnitCounts; label: MessageKey }[]): { label: string; built: number; lost: number; share: number }[] {
  const stats = statistics.value;
  if (!stats) {
    return [];
  }
  const max = Math.max(1, ...groups.map((group) => stats.built[group.key]));
  return groups.map((group) => ({
    label: t(group.label),
    built: stats.built[group.key],
    lost: stats.lost[group.key],
    share: stats.built[group.key] / max,
  }));
}

const hours = computed(() => Math.round((statistics.value?.secondsPlayed ?? 0) / 3600));
</script>

<template>
  <Alert v-if="error" variant="destructive"><AlertDescription class="selectable">{{ error }}</AlertDescription></Alert>
  <div v-else-if="!statistics" class="grid h-40 place-items-center"><Spinner class="size-5 text-primary" /></div>
  <div v-else class="flex flex-col gap-5">
    <DetailStats
      :items="[
        { label: t('profile.statistics.timePlayed'), value: t('profile.statistics.hours', { count: hours }) },
        { label: t('profile.statistics.customGames'), value: formatNumber(statistics.customGames) },
        { label: t('profile.statistics.ladderGames'), value: formatNumber(statistics.ladderGames) },
        { label: t('profile.statistics.acusLost'), value: formatNumber(statistics.lost.acus) },
        { label: t('profile.statistics.engineers'), value: formatNumber(statistics.built.engineers) },
        { label: t('profile.statistics.engineersLost'), value: formatNumber(statistics.lost.engineers) },
      ]"
    />

    <section class="flex flex-col gap-2">
      <h3 class="flex items-center gap-3 font-sans text-xs font-normal text-muted-foreground">
        {{ t('profile.statistics.factions') }}
        <span class="flex items-center gap-1"><span class="size-2 bg-success" />{{ t('profile.statistics.wins') }}</span>
        <span class="flex items-center gap-1"><span class="size-2 bg-destructive/70" />{{ t('profile.statistics.losses') }}</span>
      </h3>
      <div v-for="entry in statistics.factions" :key="entry.faction" class="grid grid-cols-[110px_minmax(0,1fr)_120px] items-center gap-3 text-[13px]">
        <span class="flex items-center gap-1.5">
          <img :src="emoticonSrc(`:${entry.faction}:`) ?? undefined" alt="" class="size-4" draggable="false" />
          {{ factionLabel(entry.faction) }}
        </span>
        <div class="flex h-3 bg-secondary" :aria-label="t('profile.statistics.factionBar', { wins: entry.wins, games: entry.games })" role="img">
          <div class="h-full bg-success" :style="{ width: `${(entry.wins / factionMax) * 100}%` }" />
          <div class="h-full bg-destructive/70" :style="{ width: `${(Math.max(0, entry.games - entry.wins) / factionMax) * 100}%` }" />
        </div>
        <span class="text-right text-muted-foreground tabular-nums">
          {{ formatNumber(entry.wins) }} / {{ formatNumber(entry.games) }}
          <template v-if="entry.games">· {{ Math.round((entry.wins / entry.games) * 100) }} %</template>
        </span>
      </div>
    </section>

    <section v-for="group in [{ title: t('profile.statistics.byCategory'), rows: rows(CATEGORIES) }, { title: t('profile.statistics.byTech'), rows: rows(TECH) }]" :key="group.title" class="flex flex-col gap-2">
      <h3 class="font-sans text-xs font-normal text-muted-foreground">{{ group.title }}</h3>
      <div v-for="row in group.rows" :key="row.label" class="grid grid-cols-[110px_minmax(0,1fr)_160px] items-center gap-3 text-[13px]">
        <span>{{ row.label }}</span>
        <div class="h-3 bg-secondary">
          <div class="h-full bg-primary/80" :style="{ width: `${row.share * 100}%` }" />
        </div>
        <span class="text-right text-muted-foreground tabular-nums">
          {{ t('profile.statistics.builtLost', { built: formatNumber(row.built), lost: formatNumber(row.lost) }) }}
        </span>
      </div>
    </section>
  </div>
</template>
