<script setup lang="ts">
import { ExternalLink, RefreshCw, Trophy } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge, type BadgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import type { Tournament, TournamentStatus } from '../../../shared/contract.ts';
import { INTL_LOCALES } from '../../../shared/i18n/index.ts';
import FilterChips from '../components/FilterChips.vue';
import { formatDateTime, joinParts, playersLabel, ratingRangeLabel } from '../format.ts';
import { locale, t } from '../lib/i18n.ts';
import { openExternal } from '../lib/links.ts';
import { queries, queryState } from '../lib/queries.ts';

type Filter = 'current' | 'finished';

const SITE_URL = 'https://tournaments.faforever.com';
const STATUS_VARIANTS: Record<TournamentStatus, BadgeVariants['variant']> = {
  running: 'success',
  open: 'accent',
  upcoming: 'info',
  closed: 'warning',
  finished: 'muted',
};

const filter = ref<Filter>('current');
const { data: tournaments, loading, error, reload } = queryState(useQuery(queries.tournaments()));

const shown = computed(() =>
  (tournaments.value ?? []).filter((tournament) => (tournament.status === 'finished') === (filter.value === 'finished')),
);
const counts = computed(() => {
  const all = tournaments.value ?? [];
  const finished = all.filter((tournament) => tournament.status === 'finished').length;
  return { current: all.length - finished, finished };
});
const filterOptions = computed(() =>
  (['current', 'finished'] as const).map((value) => {
    const label = t(`tournaments.filters.${value}`);
    return { value, label: tournaments.value ? `${label} ${counts.value[value]}` : label };
  }),
);
const filterChoice = computed<Filter[]>({
  get: () => [filter.value],
  set: ([value]) => {
    filter.value = value ?? 'current';
  },
});

function teamSizeLabel(size: number | null): string | null {
  return size ? `${size}v${size}` : null;
}

function prizeLabel(prize: Tournament['prize']): string | null {
  if (!prize) {
    return null;
  }
  const amount = new Intl.NumberFormat(INTL_LOCALES[locale.value], {
    style: 'currency',
    currency: prize.currency,
    maximumFractionDigits: 0,
  });
  return t('tournaments.prize', { amount: amount.format(prize.amount) });
}

function participantsLabel(tournament: Tournament): string {
  const players = playersLabel(tournament.players);
  return tournament.teamSize && tournament.teamSize > 1 && tournament.teams > 0
    ? `${players}, ${t('tournaments.teams', { count: tournament.teams })}`
    : players;
}

function ratingLimits(tournament: Tournament): string | null {
  const player = ratingRangeLabel(tournament.minRating, tournament.maxRating);
  const team = tournament.maxTeamRating ? t('tournaments.teamRatingTo', { max: tournament.maxTeamRating }) : null;
  const limits = joinParts(player, team);
  return limits ? t('tournaments.rating', { limits }) : null;
}
</script>

<template>
  <section class="flex min-h-full flex-col gap-4 px-7 pt-3 pb-8">
    <header class="flex items-center gap-5">
      <h1 class="text-2xl">{{ t('tournaments.title') }}</h1>
      <div class="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          :data-tooltip="t('tournaments.refresh')"
          :aria-label="t('tournaments.refresh')"
          :disabled="loading"
          @click="reload"
        >
          <RefreshCw :class="{ 'animate-spin': loading }" />
        </Button>
        <Button variant="outline" @click="openExternal(SITE_URL)"><ExternalLink />{{ t('tournaments.site') }}</Button>
      </div>
    </header>
    <p class="-mt-2 max-w-200 text-sm text-muted-foreground">{{ t('tournaments.intro') }}</p>

    <FilterChips v-model="filterChoice" :label="t('tournaments.show')" :options="filterOptions" required />

    <Alert v-if="error" variant="destructive" class="flex items-center gap-3">
      <AlertDescription class="flex-1 selectable">{{ error }}</AlertDescription>
      <Button variant="outline" size="sm" @click="reload"><RefreshCw />{{ t('common.retry') }}</Button>
    </Alert>

    <div v-if="!tournaments && loading" class="flex flex-col gap-2.5">
      <Skeleton v-for="index in 6" :key="index" class="h-24" />
    </div>
    <Empty v-else-if="tournaments && shown.length === 0">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Trophy /></EmptyMedia>
        <EmptyTitle>{{ t(`tournaments.empty.${filter}`) }}</EmptyTitle>
      </EmptyHeader>
    </Empty>
    <ul v-else class="flex flex-col gap-2.5">
      <li
        v-for="tournament in shown"
        :key="tournament.id"
        class="plate cut-lg flex items-center gap-4 bg-card px-4 py-3"
        :class="{
          '[--plate-border:color-mix(in_srgb,var(--color-success)_55%,transparent)]': tournament.status === 'running',
          '[--plate-border:color-mix(in_srgb,var(--color-primary)_55%,transparent)]': tournament.status === 'open',
        }"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-display text-[15px] font-semibold selectable">{{ tournament.name }}</span>
            <Badge :variant="STATUS_VARIANTS[tournament.status]">{{ t(`tournaments.status.${tournament.status}`) }}</Badge>
            <Badge v-if="tournament.official" variant="outline">{{ t('tournaments.official') }}</Badge>
          </div>
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span v-if="tournament.startsAt" class="text-foreground tabular-nums">{{ formatDateTime(tournament.startsAt) }}</span>
            <span>
              {{ joinParts(teamSizeLabel(tournament.teamSize), tournament.format ? t(`tournaments.formats.${tournament.format}`) : null) }}
            </span>
            <span>{{ participantsLabel(tournament) }}</span>
            <span v-if="ratingLimits(tournament)">{{ ratingLimits(tournament) }}</span>
            <span v-if="prizeLabel(tournament.prize)" class="text-warning">{{ prizeLabel(tournament.prize) }}</span>
          </div>
          <div v-if="tournament.series || (tournament.status === 'open' && tournament.signupClosesAt)" class="text-xs text-faint">
            {{
              joinParts(
                tournament.series ? t('tournaments.series', { series: tournament.series }) : null,
                tournament.status === 'open' && tournament.signupClosesAt
                  ? t('tournaments.signupUntil', { date: formatDateTime(tournament.signupClosesAt) ?? '' })
                  : null,
              )
            }}
          </div>
        </div>
        <Button
          :variant="tournament.status === 'open' ? 'default' : 'outline'"
          size="sm"
          class="shrink-0"
          @click="openExternal(tournament.url)"
        >
          <ExternalLink />
          {{ tournament.status === 'open' ? t('tournaments.signUp') : t('tournaments.open') }}
        </Button>
      </li>
    </ul>
  </section>
</template>
