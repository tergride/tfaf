<script setup lang="ts">
import { Check, Handshake, Play, RefreshCw, Swords } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  COOP_MAX_PLAYERS,
  type CoopMission,
  type CoopScenario,
  HOST_GAME_LIMITS,
  type LobbyGame,
} from '../../../shared/contract.ts';
import CountryFlag from '../components/CountryFlag.vue';
import DetailPanel from '../components/DetailPanel.vue';
import DetailPreview from '../components/DetailPreview.vue';
import DetailStats from '../components/DetailStats.vue';
import FilterChips from '../components/FilterChips.vue';
import GameCard from '../components/GameCard.vue';
import ListLayout from '../components/ListLayout.vue';
import PlayerName from '../components/PlayerName.vue';
import TeamList from '../components/TeamList.vue';
import VaultCard from '../components/VaultCard.vue';
import { useGameFocus } from '../composables/useGameFocus.ts';
import { useGameSession } from '../composables/useGameSession.ts';
import { useLobby } from '../composables/useLobby.ts';
import { errorMessage, formatClock, formatDateTime, isCancelled, mapDisplayName, playersLabel } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { queries, queryState } from '../lib/queries.ts';

const JoinPasswordDialog = defineAsyncComponent(() => import('../components/JoinPasswordDialog.vue'));

type Selection = { kind: 'mission'; mission: CoopMission; scenario: CoopScenario } | { kind: 'game'; game: LobbyGame };

const playerCounts = computed(() =>
  Array.from({ length: COOP_MAX_PLAYERS + 1 }, (_, count) => ({
    value: String(count),
    label: count === 0 ? t('coop.leaderboard.anyPlayers') : count === 1 ? t('coop.leaderboard.onePlayer') : playersLabel(count),
  })),
);
// Game titles are limited to printable ASCII by the server.
const NON_ASCII = /[^\x20-\x7e]/g;

const { data: scenarios, loading, error, reload } = queryState(useQuery(queries.coopScenarios()));
const { state: lobby, games } = useLobby();
const { state: session } = useGameSession();
const gameFocus = useGameFocus();

const scenarioId = ref('');
const selection = ref<Selection | null>(null);
const actionError = ref<string | null>(null);
const busy = ref(false);
const title = ref('');
const password = ref('');
/** The game whose password the dialog asks for. */
const passwordGame = ref<LobbyGame | null>(null);

const playerCount = ref('0');
const {
  data: leaderboard,
  loading: leaderboardLoading,
  error: leaderboardError,
} = queryState(
  useQuery(() => {
    const current = selection.value;
    const missionId = current?.kind === 'mission' ? current.mission.id : '';
    return { ...queries.coopLeaderboard(missionId, Number(playerCount.value)), enabled: missionId !== '' };
  }),
);

const canStart = computed(() => lobby.value.status === 'connected' && session.value.phase === 'idle');
const scenarioOptions = computed(() => (scenarios.value ?? []).map((scenario) => ({ value: scenario.id, label: scenario.name })));
const scenarioChoice = computed<string[]>({
  get: () => [scenarioId.value],
  set: ([value]) => {
    scenarioId.value = value ?? '';
  },
});
const currentScenario = computed(() => scenarios.value?.find((scenario) => scenario.id === scenarioId.value) ?? null);

watch(scenarios, (list) => {
  if (list && !list.some((scenario) => scenario.id === scenarioId.value)) {
    scenarioId.value = list[0]?.id ?? '';
  }
});

const missionsByFolder = computed(
  () =>
    new Map(
      (scenarios.value ?? []).flatMap((scenario) =>
        scenario.missions.map((mission) => [mission.folderName.toLowerCase(), { mission, scenario }] as const),
      ),
    ),
);

function missionOf(game: LobbyGame): { mission: CoopMission; scenario: CoopScenario } | null {
  return missionsByFolder.value.get(game.mapFolderName.toLowerCase()) ?? null;
}

const coopGames = computed(() =>
  games.value
    .filter((game) => game.gameType === 'coop')
    .sort((a, b) => (b.hostedAt ?? '').localeCompare(a.hostedAt ?? '') || a.id - b.id),
);
const liveGame = computed(() => {
  const current = selection.value;
  return current?.kind === 'game' ? (coopGames.value.find((game) => game.id === current.game.id) ?? null) : null;
});

watch(liveGame, (game) => {
  if (game && selection.value?.kind === 'game') {
    selection.value = { kind: 'game', game };
  }
});

const canHost = computed(() => canStart.value && !busy.value && title.value.trim().length > 0);
const canJoin = computed(() => liveGame.value !== null && canStart.value && !busy.value);

function openMission(mission: CoopMission, scenario: CoopScenario): void {
  selection.value = { kind: 'mission', mission, scenario };
  actionError.value = null;
  title.value = mission.name.replace(NON_ASCII, '').trim().slice(0, HOST_GAME_LIMITS.titleMaxLength);
  password.value = '';
}

// A game shown from the chat opens here once the app has switched to this tab.
watch(
  () => gameFocus.request.value,
  (request) => {
    const game = request ? coopGames.value.find((item) => item.id === request.gameId) : null;
    if (game) {
      openGame(game);
      gameFocus.done();
    }
  },
  { immediate: true },
);

function openGame(game: LobbyGame): void {
  selection.value = { kind: 'game', game };
  actionError.value = null;
}

function close(): void {
  selection.value = null;
}

// The game banner shows the rest, so the panel closes once the launcher has accepted the request.
async function run(action: () => Promise<void>): Promise<void> {
  actionError.value = null;
  busy.value = true;
  try {
    await action();
    selection.value = null;
  } catch (cause) {
    actionError.value = isCancelled(cause) ? null : errorMessage(cause);
  } finally {
    busy.value = false;
  }
}

function host(mission: CoopMission): void {
  if (canHost.value) {
    void run(() => window.tfaf.coop.host({ missionId: mission.id, title: title.value.trim(), password: password.value || null }));
  }
}

// Coop games are never TFAF lobbies, so the server's flag tells whether a game needs a password.
function joinOpen(game: LobbyGame): Promise<void> {
  return run(async () => {
    await window.tfaf.game.join(game.id, null);
  });
}

function join(game: LobbyGame): void {
  if (game.passwordProtected) {
    passwordGame.value = game;
  } else {
    void joinOpen(game);
  }
}

/** A double click joins right away, a game with a password asks for it in a dialog; a failure opens the game's panel. */
async function quickJoin(game: LobbyGame): Promise<void> {
  if (!canStart.value || busy.value) {
    openGame(game);
    return;
  }
  if (game.passwordProtected) {
    passwordGame.value = game;
    return;
  }
  await joinOpen(game);
  const failure = actionError.value;
  if (failure) {
    openGame(game);
    actionError.value = failure;
  }
}

function submitJoin(): void {
  if (liveGame.value && canJoin.value) {
    join(liveGame.value);
  }
}

function watchReplay(replayId: number): void {
  void run(() => window.tfaf.replays.watch(replayId));
}
</script>

<template>
  <ListLayout :panel-open="selection !== null" :placeholder="t('vault.detailPanel.placeholder.coop')" @close-panel="close">
    <template #header>
      <div class="mb-2 flex items-center gap-5">
        <h1 class="text-2xl">{{ t('coop.title') }}</h1>
        <Button
          variant="ghost"
          size="icon"
          class="ml-auto"
          :data-tooltip="t('coop.refresh')"
          :aria-label="t('coop.refresh')"
          :disabled="loading"
          @click="reload"
        >
          <RefreshCw :class="{ 'animate-spin': loading }" />
        </Button>
      </div>
      <p class="mb-4 max-w-200 text-sm text-muted-foreground">
        {{ t('coop.intro', { count: COOP_MAX_PLAYERS }) }}
      </p>
    </template>

    <section class="flex flex-col gap-3 pb-6">
      <h2 class="flex items-center gap-2 text-lg">
        {{ t('coop.openGames.title') }}
        <span v-if="coopGames.length" class="font-sans text-sm font-normal text-muted-foreground tabular-nums">
          {{ coopGames.length }}
        </span>
      </h2>
      <p v-if="lobby.status !== 'connected'" class="text-sm text-muted-foreground">{{ t('coop.openGames.noLobby') }}</p>
      <p v-else-if="coopGames.length === 0" class="text-sm text-muted-foreground">{{ t('coop.openGames.empty') }}</p>
      <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4.5 pt-1.5">
        <GameCard
          v-for="game in coopGames"
          :key="game.id"
          :game="game"
          :map-name="missionOf(game)?.mission.name ?? null"
          :selected="selection?.kind === 'game' && selection.game.id === game.id"
          @open="openGame(game)"
          @quick-join="quickJoin(game)"
        />
      </div>
    </section>

    <section class="flex flex-col gap-3">
      <h2 class="text-lg">{{ t('coop.missions.title') }}</h2>
      <Alert v-if="error" variant="destructive" class="flex items-center gap-3">
        <AlertDescription class="flex-1 selectable">{{ error }}</AlertDescription>
        <Button variant="outline" size="sm" @click="reload"><RefreshCw />{{ t('common.retry') }}</Button>
      </Alert>
      <div v-if="!scenarios && loading" class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4.5">
        <Skeleton v-for="index in 6" :key="index" class="aspect-square" />
      </div>
      <Empty v-else-if="scenarios && scenarios.length === 0">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Handshake /></EmptyMedia>
          <EmptyTitle>{{ t('coop.missions.empty') }}</EmptyTitle>
        </EmptyHeader>
      </Empty>
      <template v-else-if="currentScenario">
        <div class="flex flex-wrap gap-y-2">
          <FilterChips
            v-model="scenarioChoice"
            :label="t('coop.missions.scenario')"
            :options="scenarioOptions"
            required
            class="flex-wrap"
          />
        </div>
        <div v-if="currentScenario.type || currentScenario.description" class="flex max-w-200 items-start gap-3 text-sm text-muted-foreground">
          <Badge v-if="currentScenario.type" variant="muted" class="shrink-0">
            {{ t(`coop.campaignTypes.${currentScenario.type}`) }}
          </Badge>
          <p class="whitespace-pre-line selectable">{{ currentScenario.description }}</p>
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4.5 pt-1.5">
          <VaultCard
            v-for="(mission, index) in currentScenario.missions"
            :key="mission.id"
            square
            :title="mission.name"
            :image="mission.previewUrl"
            :subtitle="t('coop.missions.number', { number: index + 1 })"
            :meta="[mission.version !== null ? t('coop.missions.version', { version: mission.version }) : null]"
            :selected="selection?.kind === 'mission' && selection.mission.id === mission.id"
            @open="currentScenario && openMission(mission, currentScenario)"
          />
        </div>
      </template>
    </section>

    <template #panel>
      <DetailPanel
        v-if="selection?.kind === 'mission'"
        :title="selection.mission.name"
        :kind="t('coop.mission.kind')"
        :item-key="`mission-${selection.mission.id}`"
        @close="close"
      >
        <template #media>
          <DetailPreview
            :preview="{
              title: selection.mission.name,
              details: selection.scenario.name,
              src: selection.mission.previewLargeUrl,
              fallbackSrc: selection.mission.previewUrl,
            }"
            fallback="?"
            :map-folder="selection.mission.folderName"
          />
        </template>
        <div class="flex flex-wrap gap-1.5">
          <Badge variant="muted">{{ selection.scenario.name }}</Badge>
          <Badge v-if="selection.mission.version !== null" variant="muted">
            {{ t('coop.missions.version', { version: selection.mission.version }) }}
          </Badge>
        </div>
        <p class="text-sm leading-relaxed whitespace-pre-line text-foreground/85 wrap-anywhere selectable">
          {{ selection.mission.description || t('coop.mission.noDescription') }}
        </p>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-base">{{ t('coop.leaderboard.title') }}</h3>
            <Select v-model="playerCount">
              <SelectTrigger size="sm" class="w-40" :aria-label="t('coop.leaderboard.playerCount')"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="option in playerCounts" :key="option.value" :value="option.value">{{ option.label }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p class="text-xs text-muted-foreground">{{ t('coop.leaderboard.rules') }}</p>
          <Alert v-if="leaderboardError" variant="destructive">
            <AlertDescription class="selectable">{{ leaderboardError }}</AlertDescription>
          </Alert>
          <div v-else-if="!leaderboard" class="flex flex-col gap-1.5">
            <Skeleton v-for="index in 5" :key="index" class="h-7" />
          </div>
          <p v-else-if="leaderboard.length === 0" class="py-2 text-sm text-muted-foreground">{{ t('coop.leaderboard.empty') }}</p>
          <table v-else class="w-full table-fixed text-[13px] transition-opacity" :class="{ 'opacity-50': leaderboardLoading }">
            <thead class="text-left text-xs text-muted-foreground">
              <tr class="border-b">
                <th class="w-8 py-2 font-medium">#</th>
                <th class="py-2 font-medium">{{ t('coop.leaderboard.players') }}</th>
                <th class="w-18 py-2 text-right font-medium">{{ t('coop.leaderboard.time') }}</th>
                <th class="w-10 py-2 text-center font-medium" :data-tooltip="t('coop.leaderboard.secondaryHint')">
                  {{ t('coop.leaderboard.secondary') }}
                </th>
                <th class="w-9 py-2"><span class="sr-only">{{ t('coop.leaderboard.replay') }}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="result in leaderboard" :key="result.replayId" class="border-b border-border/50">
                <td class="py-1 text-muted-foreground tabular-nums">{{ result.rank }}</td>
                <td class="truncate py-1 selectable" :data-tooltip="result.players.join(', ')">{{ result.players.join(', ') || '—' }}</td>
                <td class="py-1 text-right tabular-nums" :data-tooltip="formatDateTime(result.endedAt) ?? undefined">
                  {{ formatClock(result.durationSeconds) }}
                </td>
                <td class="py-1 text-center">
                  <Check v-if="result.secondaryObjectives" class="inline size-4 text-success" :aria-label="t('common.yes')" />
                </td>
                <td class="py-1 text-right">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    :data-tooltip="t('coop.leaderboard.watchReplay')"
                    :aria-label="t('coop.leaderboard.watchReplay')"
                    :disabled="busy || session.phase !== 'idle'"
                    @click="watchReplay(result.replayId)"
                  >
                    <Play />
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <Alert v-if="actionError" variant="destructive">
          <AlertDescription class="selectable">{{ actionError }}</AlertDescription>
        </Alert>

        <template #actions>
          <form class="flex flex-col gap-2" @submit.prevent="selection?.kind === 'mission' && host(selection.mission)">
            <div class="flex gap-2">
              <Input
                v-model="title"
                class="flex-1"
                :maxlength="HOST_GAME_LIMITS.titleMaxLength"
                :placeholder="t('coop.mission.gameTitle')"
                :aria-label="t('coop.mission.gameTitle')"
              />
              <Input
                v-model="password"
                class="w-32"
                type="password"
                :maxlength="HOST_GAME_LIMITS.passwordMaxLength"
                :placeholder="t('coop.mission.password')"
                :aria-label="t('coop.mission.gamePassword')"
              />
            </div>
            <Button type="submit" size="lg" :disabled="!canHost">
              <Spinner v-if="busy" />
              <Handshake v-else />
              {{ t('coop.mission.host') }}
            </Button>
          </form>
          <p class="text-xs text-muted-foreground">
            {{
              session.phase !== 'idle'
                ? t('coop.anotherGameRunning')
                : lobby.status !== 'connected'
                  ? t('coop.noLobby')
                  : t('coop.mission.downloadNotice')
            }}
          </p>
        </template>
      </DetailPanel>

      <DetailPanel
        v-else-if="selection?.kind === 'game'"
        :title="selection.game.title || t('coop.game.untitled')"
        :kind="t('coop.game.kind')"
        :item-key="`game-${selection.game.id}`"
        @close="close"
      >
        <template #media>
          <DetailPreview
            :preview="{
              title: missionOf(selection.game)?.mission.name ?? mapDisplayName(selection.game.mapFolderName),
              details: selection.game.mapFolderName,
              src: missionOf(selection.game)?.mission.previewLargeUrl ?? selection.game.mapPreviewLargeUrl,
              fallbackSrc: selection.game.mapPreviewUrl,
            }"
            fallback="?"
            :map-folder="selection.game.mapFolderName"
          />
        </template>
        <Alert v-if="!liveGame" variant="warning">
          <AlertDescription>{{ t('coop.game.gone') }}</AlertDescription>
        </Alert>
        <div class="flex flex-wrap gap-1.5">
          <Badge v-if="missionOf(selection.game)" variant="muted">{{ missionOf(selection.game)?.scenario.name }}</Badge>
          <Badge v-if="selection.game.passwordProtected" variant="warning">{{ t('coop.game.password') }}</Badge>
          <Badge v-if="selection.game.friendsOnly" variant="info">{{ t('coop.game.friendsOnly') }}</Badge>
        </div>
        <DetailStats
          :items="[
            {
              label: t('coop.game.mission'),
              value: missionOf(selection.game)?.mission.name ?? mapDisplayName(selection.game.mapFolderName),
            },
            { label: t('coop.game.host'), value: selection.game.host },
            {
              label: t('coop.game.players'),
              value: t('coop.game.playersValue', { current: selection.game.numPlayers, max: selection.game.maxPlayers }),
            },
          ]"
        />
        <TeamList :teams="selection.game.teams" :player-key="(one) => String(one.id ?? one.login)">
          <template #default="{ player: one }">
            <CountryFlag v-if="one.country" :country="one.country" />
            <PlayerName :login="one.login" :id="one.id" :clan="one.clan" :avatar="one.avatar" />
            <span v-if="one.friend" class="text-xs text-info">{{ t('coop.game.friend') }}</span>
          </template>
        </TeamList>
        <div v-if="selection.game.simMods.length" class="flex flex-col gap-1">
          <h3 class="font-sans text-xs font-normal text-muted-foreground">{{ t('coop.game.mods') }}</h3>
          <ul class="flex flex-col gap-px border bg-border">
            <li v-for="mod in selection.game.simMods" :key="mod.uid" class="bg-background px-2.5 py-1.5 text-[13px] selectable">
              {{ mod.name }}
            </li>
          </ul>
        </div>
        <Alert v-if="actionError" variant="destructive">
          <AlertDescription class="selectable">{{ actionError }}</AlertDescription>
        </Alert>

        <template #actions>
          <Button size="lg" :disabled="!canJoin" @click="submitJoin">
            <Spinner v-if="busy" />
            <Swords v-else />
            {{ t('coop.game.join') }}
          </Button>
          <p v-if="session.phase !== 'idle'" class="text-xs text-muted-foreground">{{ t('coop.anotherGameRunning') }}</p>
          <p v-else-if="lobby.status !== 'connected'" class="text-xs text-muted-foreground">{{ t('coop.noLobby') }}</p>
        </template>
      </DetailPanel>
    </template>

    <JoinPasswordDialog v-if="passwordGame" :game="passwordGame" @joined="close" @close="passwordGame = null" />
  </ListLayout>
</template>
