<script setup lang="ts">
import { RefreshCw, Search, Trophy } from '@lucide/vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, nextTick, ref, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { LeagueDivision, LeagueSeason, LeagueSubdivision } from '../../../shared/contract.ts';
import { INTL_LOCALES } from '../../../shared/i18n/index.ts';
import { ru } from '../../../shared/i18n/ru.ts';
import FilterChip from '../components/FilterChip.vue';
import PageNav from '../components/PageNav.vue';
import PlayerName from '../components/PlayerName.vue';
import { useAuth } from '../composables/useAuth.ts';
import { errorMessage, formatDate, formatNumber, playersLabel } from '../format.ts';
import { locale, t } from '../lib/i18n.ts';
import { queries, queryState } from '../lib/queries.ts';

type DivisionKey = keyof typeof ru.leaderboards.divisions;

// Rows look like those of the list tables: the player's own row is marked green, the found player like a picked row.
const CELL =
  'h-10 border-b border-border/60 px-2.5 group-data-[mark=own]:bg-success/7 first:group-data-[mark=own]:shadow-[inset_3px_0_0_var(--color-success)] group-data-[mark=found]:bg-primary/10 first:group-data-[mark=found]:shadow-[inset_3px_0_0_var(--color-primary)]';

const auth = useAuth();
const leagueId = ref<string | null>(null);
const seasonId = ref<string | null>(null);
const subdivisionId = ref<string | null>(null);
const page = ref(1);
const highlightedPlayer = ref<number | null>(null);
const searchLogin = ref('');
const finding = ref(false);
const findMessage = ref<string | null>(null);

const queryClient = useQueryClient();
const leagues = queryState(useQuery(queries.leagues()));
const seasons = queryState(
  useQuery(() => ({ ...queries.leagueSeasons(leagueId.value ?? ''), enabled: leagueId.value !== null })),
);
const standing = queryState(
  useQuery(() => ({ ...queries.leagueStanding(seasonId.value ?? ''), enabled: seasonId.value !== null })),
);
const entries = queryState(
  useQuery(() => ({
    ...queries.leagueEntries(seasonId.value ?? '', subdivisionId.value ?? '', page.value),
    enabled: seasonId.value !== null && subdivisionId.value !== null,
  })),
);

const myId = computed(() => (auth.value?.status === 'signedIn' ? auth.value.user.id : null));
const divisions = computed(() => standing.data.value?.divisions ?? []);
const subdivisionsById = computed(() => {
  const result = new Map<string, { division: LeagueDivision; subdivision: LeagueSubdivision }>();
  for (const division of divisions.value) {
    for (const subdivision of division.subdivisions) {
      result.set(subdivision.id, { division, subdivision });
    }
  }
  return result;
});
const selected = computed(() => (subdivisionId.value ? (subdivisionsById.value.get(subdivisionId.value) ?? null) : null));
const mine = computed(() => {
  const me = standing.data.value?.me;
  return me?.subdivisionId ? (subdivisionsById.value.get(me.subdivisionId) ?? null) : null;
});
const largestDivision = computed(() => Math.max(1, ...divisions.value.map(divisionPlayers)));
const loadError = computed(
  () => leagues.error.value ?? seasons.error.value ?? standing.error.value ?? entries.error.value ?? null,
);
const percent = computed(() => new Intl.NumberFormat(INTL_LOCALES[locale.value], { style: 'percent', maximumFractionDigits: 1 }));

function isKnownDivision(nameKey: string): nameKey is DivisionKey {
  return Object.hasOwn(ru.leaderboards.divisions, nameKey);
}

function divisionName(division: LeagueDivision): string {
  return isKnownDivision(division.nameKey) ? t(`leaderboards.divisions.${division.nameKey}`) : division.nameKey;
}

function subdivisionName(division: LeagueDivision, subdivision: LeagueSubdivision): string {
  return `${divisionName(division)} ${subdivision.name}`.trim();
}

function divisionPlayers(division: LeagueDivision): number {
  return division.subdivisions.reduce((sum, subdivision) => sum + subdivision.players, 0);
}

function seasonLabel(season: LeagueSeason): string {
  const dates = [formatDate(season.startDate), formatDate(season.endDate)].filter(Boolean).join(' – ');
  return dates
    ? t('leaderboards.seasonWithDates', { number: season.number, dates })
    : t('leaderboards.seasonNumber', { number: season.number });
}

function percentOf(count: number): string {
  const total = standing.data.value?.players ?? 0;
  return percent.value.format(total > 0 ? count / total : 0);
}

function showSubdivision(id: string, nextPage = 1): void {
  subdivisionId.value = id;
  page.value = nextPage;
}

function showDivision(division: LeagueDivision): void {
  const target = division.subdivisions.find((subdivision) => subdivision.players > 0) ?? division.subdivisions[0];
  if (target) {
    highlightedPlayer.value = null;
    showSubdivision(target.id);
  }
}

function changePage(next: number): void {
  page.value = next;
}

/** Opens on the player's own subdivision, or on the top one that has players. */
function defaultSubdivision(): string | null {
  const own = standing.data.value?.me?.subdivisionId;
  if (own) {
    return own;
  }
  for (const division of divisions.value) {
    const withPlayers = division.subdivisions.find((subdivision) => subdivision.players > 0);
    if (withPlayers) {
      return withPlayers.id;
    }
  }
  return divisions.value[0]?.subdivisions[0]?.id ?? null;
}

async function find(): Promise<void> {
  const login = searchLogin.value.trim();
  if (!login || !seasonId.value) {
    return;
  }
  finding.value = true;
  findMessage.value = null;
  try {
    const location = await window.tfaf.leagues.find(seasonId.value, login);
    if (!location) {
      findMessage.value = t('leaderboards.find.notFound', { login });
      return;
    }
    // The page is loaded first, so the player's row is there to scroll to once it is shown.
    await queryClient.query(queries.leagueEntries(seasonId.value, location.subdivisionId, location.page));
    highlightedPlayer.value = location.playerId;
    showSubdivision(location.subdivisionId, location.page);
    await nextTick();
    document.querySelector('[data-mark="found"]')?.scrollIntoView({ block: 'center' });
  } catch (cause) {
    findMessage.value = errorMessage(cause);
  } finally {
    finding.value = false;
  }
}

function reloadAll(): void {
  if (leagues.error.value || !leagues.data.value) {
    void leagues.reload();
  } else if (seasons.error.value || !seasons.data.value) {
    void seasons.reload();
  } else {
    void standing.reload();
  }
}

watch(leagues.data, (list) => {
  if (list && !list.some((league) => league.id === leagueId.value)) {
    leagueId.value = list[0]?.id ?? null;
  }
});
watch(leagueId, () => {
  seasonId.value = null;
});
watch(seasons.data, (list) => {
  seasonId.value = list?.[0]?.id ?? null;
});
watch(seasonId, () => {
  subdivisionId.value = null;
  highlightedPlayer.value = null;
  findMessage.value = null;
});
watch(standing.data, () => {
  const target = defaultSubdivision();
  if (target) {
    showSubdivision(target);
  }
});
</script>

<template>
  <section class="flex min-h-full flex-col gap-4 px-7 pt-3 pb-8">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-2xl">{{ t('leaderboards.title') }}</h1>
      <div class="flex flex-wrap items-center gap-2">
        <Tabs
          v-if="leagues.data.value?.length"
          :model-value="leagueId ?? undefined"
          @update:model-value="(value) => (leagueId = String(value))"
        >
          <TabsList>
            <TabsTrigger v-for="league in leagues.data.value" :key="league.id" :value="league.id" class="px-4">
              {{ league.name }}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Select v-if="seasons.data.value?.length" v-model="seasonId">
          <SelectTrigger class="w-72" :aria-label="t('leaderboards.season')"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="season in seasons.data.value" :key="season.id" :value="season.id">{{ seasonLabel(season) }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </header>

    <Alert v-if="loadError" variant="destructive" class="flex items-center gap-3">
      <AlertDescription class="flex-1 selectable">{{ loadError }}</AlertDescription>
      <Button variant="outline" size="sm" @click="reloadAll"><RefreshCw />{{ t('common.retry') }}</Button>
    </Alert>

    <div v-if="!standing.data.value && !loadError" class="grid grid-cols-[320px_1fr] gap-4">
      <Skeleton class="h-44" />
      <Skeleton class="h-44" />
      <Skeleton class="col-span-2 h-96" />
    </div>

    <template v-else-if="standing.data.value">
      <div class="grid grid-cols-[320px_1fr] gap-4 transition-opacity" :class="{ 'opacity-60': standing.loading.value }">
        <div class="plate cut-lg flex flex-col gap-3 bg-card p-4">
          <h2 class="font-sans text-[13px] font-normal text-muted-foreground">{{ t('leaderboards.me.title') }}</h2>
          <template v-if="standing.data.value.me && mine">
            <button
              type="button"
              class="flex items-center gap-3 text-left outline-none focus-visible:underline"
              @click="showSubdivision(mine.subdivision.id)"
            >
              <img
                v-if="mine.subdivision.imageUrl"
                :src="mine.subdivision.imageUrl"
                alt=""
                class="size-16 shrink-0 object-contain"
                draggable="false"
              />
              <span class="flex flex-col">
                <span class="font-display text-xl font-semibold">{{ subdivisionName(mine.division, mine.subdivision) }}</span>
                <span v-if="standing.data.value.me.rank" class="text-sm text-muted-foreground tabular-nums">
                  {{
                    t('leaderboards.me.rank', {
                      rank: formatNumber(standing.data.value.me.rank),
                      total: formatNumber(standing.data.value.players),
                    })
                  }}
                </span>
              </span>
            </button>
            <div v-if="mine.subdivision.highestScore" class="flex flex-col gap-1.5">
              <div class="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{{ t('leaderboards.me.pointsToPromotion') }}</span>
                <span>{{ standing.data.value.me.score }} / {{ mine.subdivision.highestScore }}</span>
              </div>
              <Progress :model-value="Math.min(100, (standing.data.value.me.score / mine.subdivision.highestScore) * 100)" />
            </div>
            <span class="text-sm text-muted-foreground tabular-nums">
              {{ t('leaderboards.me.seasonGames', { count: standing.data.value.me.gameCount }) }}
            </span>
          </template>
          <template v-else-if="standing.data.value.me">
            <span class="font-display text-xl font-semibold">{{ t('leaderboards.me.placement') }}</span>
            <div class="flex flex-col gap-1.5">
              <div class="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{{ t('leaderboards.me.gamesPlayed') }}</span>
                <span>{{ standing.data.value.me.gameCount }} / {{ standing.data.value.me.placementGames }}</span>
              </div>
              <Progress
                :model-value="
                  standing.data.value.me.placementGames
                    ? Math.min(100, (standing.data.value.me.gameCount / standing.data.value.me.placementGames) * 100)
                    : 0
                "
              />
            </div>
            <span class="text-sm text-muted-foreground">{{ t('leaderboards.me.placementHint') }}</span>
          </template>
          <p v-else class="text-sm text-muted-foreground">{{ t('leaderboards.me.notInSeason') }}</p>
        </div>

        <div class="plate cut-lg flex flex-col gap-1.5 bg-card p-4">
          <h2 class="mb-0.5 flex items-baseline justify-between font-sans text-[13px] font-normal text-muted-foreground">
            {{ t('leaderboards.distribution') }}
            <span class="tabular-nums">{{ playersLabel(standing.data.value.players) }}</span>
          </h2>
          <button
            v-for="division in divisions"
            :key="division.index"
            type="button"
            class="plate plate-focus cut-xs relative grid grid-cols-[110px_1fr_88px] items-center gap-3 px-2 py-1 text-left text-sm [--plate-border:transparent]"
            :class="
              selected?.division.index === division.index
                ? 'bg-primary/8 text-primary before:absolute before:inset-y-1.5 before:left-0 before:w-0.75 before:bg-primary'
                : 'hover:bg-secondary'
            "
            :aria-pressed="selected?.division.index === division.index"
            @click="showDivision(division)"
          >
            <span class="truncate font-medium">{{ divisionName(division) }}</span>
            <span class="h-2 overflow-hidden bg-background">
              <span
                class="block h-full bg-primary/70"
                :style="{ width: `${(divisionPlayers(division) / largestDivision) * 100}%` }"
              />
            </span>
            <span class="text-right text-xs text-muted-foreground tabular-nums">
              {{ formatNumber(divisionPlayers(division)) }} · {{ percentOf(divisionPlayers(division)) }}
            </span>
          </button>
        </div>
      </div>

      <Empty v-if="divisions.length === 0">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Trophy /></EmptyMedia>
          <EmptyTitle>{{ t('leaderboards.noDivisions') }}</EmptyTitle>
        </EmptyHeader>
      </Empty>

      <div v-else class="plate cut-lg flex flex-col gap-3 bg-card p-4">
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex flex-wrap gap-0.75" role="group" :aria-label="t('leaderboards.subdivision')">
            <FilterChip
              v-for="subdivision in selected?.division.subdivisions ?? []"
              :key="subdivision.id"
              :pressed="subdivision.id === subdivisionId"
              @toggle="highlightedPlayer = null; showSubdivision(subdivision.id)"
            >
              {{ selected ? subdivisionName(selected.division, subdivision) : '' }}
              <span class="font-normal opacity-70">{{ subdivision.players }}</span>
            </FilterChip>
          </div>
          <form class="ml-auto flex items-center gap-2" @submit.prevent="find">
            <Input
              v-model="searchLogin"
              class="w-52"
              maxlength="100"
              :placeholder="t('leaderboards.find.login')"
              :aria-label="t('leaderboards.find.login')"
            />
            <Button type="submit" variant="outline" :disabled="finding || !searchLogin.trim()">
              <Spinner v-if="finding" />
              <Search v-else />
              {{ t('leaderboards.find.submit') }}
            </Button>
          </form>
        </div>
        <p v-if="findMessage" class="text-sm text-warning">{{ findMessage }}</p>
        <p v-if="selected" class="text-xs text-muted-foreground tabular-nums">
          {{
            selected.subdivision.highestScore
              ? t('leaderboards.ratingRangeWithPromotion', {
                  min: selected.subdivision.minRating ?? '…',
                  max: selected.subdivision.maxRating ?? '…',
                  score: selected.subdivision.highestScore,
                })
              : t('leaderboards.ratingRange', {
                  min: selected.subdivision.minRating ?? '…',
                  max: selected.subdivision.maxRating ?? '…',
                })
          }}
        </p>

        <Empty v-if="entries.data.value && entries.data.value.items.length === 0">
          <EmptyHeader>
            <EmptyTitle>{{ t('leaderboards.emptyDivision') }}</EmptyTitle>
            <EmptyDescription>{{ t('leaderboards.emptyDivisionHint') }}</EmptyDescription>
          </EmptyHeader>
        </Empty>
        <table
          v-else-if="entries.data.value"
          class="w-full border-separate border-spacing-0 text-[13px] transition-opacity"
          :class="{ 'opacity-60': entries.loading.value }"
          :aria-label="t('leaderboards.table.label')"
        >
          <thead class="text-left text-muted-foreground">
            <tr>
              <th class="h-9 w-20 border-b px-2.5 font-medium">{{ t('leaderboards.table.rank') }}</th>
              <th class="h-9 border-b px-2.5 font-medium">{{ t('leaderboards.table.player') }}</th>
              <th class="h-9 w-60 border-b px-2.5 font-medium">{{ t('leaderboards.table.score') }}</th>
              <th class="h-9 w-20 border-b px-2.5 text-right font-medium">{{ t('leaderboards.table.games') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="entry in entries.data.value.items"
              :key="entry.playerId"
              class="group"
              :data-mark="entry.playerId === highlightedPlayer ? 'found' : entry.playerId === myId ? 'own' : undefined"
            >
              <td :class="CELL" class="text-muted-foreground tabular-nums">{{ formatNumber(entry.rank) }}</td>
              <td :class="CELL" class="font-medium"><PlayerName :login="entry.login" :id="entry.playerId" /></td>
              <td :class="CELL">
                <div class="flex items-center gap-2.5 tabular-nums">
                  <span class="w-8 text-right">{{ entry.score }}</span>
                  <span v-if="selected?.subdivision.highestScore" class="h-1 w-32 overflow-hidden bg-background">
                    <span
                      class="block h-full bg-primary/70"
                      :style="{ width: `${Math.min(100, (entry.score / selected.subdivision.highestScore) * 100)}%` }"
                    />
                  </span>
                </div>
              </td>
              <td :class="CELL" class="text-right text-muted-foreground tabular-nums">{{ entry.gameCount }}</td>
            </tr>
          </tbody>
        </table>
        <Skeleton v-else-if="entries.loading.value" class="h-64" />
        <PageNav
          v-if="entries.data.value"
          :page="entries.data.value.page"
          :total-pages="entries.data.value.totalPages"
          :disabled="entries.loading.value"
          @change="changePage"
        />
      </div>
    </template>
  </section>
</template>
