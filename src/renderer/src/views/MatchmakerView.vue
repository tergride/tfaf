<script setup lang="ts">
import { Crown, LogOut, Map as MapIcon, Search, Square, UserMinus, UserPlus, X } from '@lucide/vue';
import { computed, defineAsyncComponent, onActivated, onDeactivated, ref } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import {
  MATCHMAKER_FACTIONS,
  type MatchmakerFaction,
  type MatchmakerQueue,
  type MatchmakerQueueStatus,
  type PartyMember,
} from '../../../shared/contract.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import CountryFlag from '../components/CountryFlag.vue';
import DetailStats from '../components/DetailStats.vue';
import ListLayout from '../components/ListLayout.vue';
import MapPoolPanel from '../components/MapPoolPanel.vue';
import PartyChatPanel from '../components/PartyChatPanel.vue';
import { useMatchmaker } from '../composables/useMatchmaker.ts';
import { errorMessage, factionLabel, formatClock } from '../format.ts';
import { emoticonSrc } from '../lib/chatText.ts';
import { t } from '../lib/i18n.ts';

const PartyInviteDialog = defineAsyncComponent(() => import('../components/PartyInviteDialog.vue'));

const STATUS: Record<Exclude<MatchmakerQueueStatus, 'idle'>, { text: MessageKey; variant: 'accent' | 'success' | 'info' | 'warning' }> = {
  searching: { text: 'matchmaker.status.searching', variant: 'accent' },
  matchFound: { text: 'matchmaker.status.matchFound', variant: 'success' },
  launching: { text: 'matchmaker.status.launching', variant: 'info' },
  cancelled: { text: 'matchmaker.status.cancelled', variant: 'warning' },
};

const api = window.tfaf.matchmaker;
const { state, searchStartedAt } = useMatchmaker();
const now = ref(Date.now());
const error = ref<string | null>(null);
const busy = ref(false);
const inviting = ref(false);
const poolName = ref<string | null>(null);
let ticker: ReturnType<typeof setInterval> | null = null;

// The panel follows the queue's live state and closes when the queue is gone, e.g. after the lobby disconnects.
const poolQueue = computed(() => state.value.queues.find((queue) => queue.name === poolName.value) ?? null);
const party = computed(() => state.value.party);
const inParty = computed(() => party.value.length > 1);
const searchTime = computed(() => (searchStartedAt.value ? formatClock((now.value - searchStartedAt.value) / 1000) : null));
const searchingTitles = computed(() =>
  state.value.queues
    .filter((queue) => queue.status === 'searching')
    .map((queue) => queue.title)
    .join(', '),
);
const chosen = computed(() =>
  state.value.queues
    .filter((queue) => queue.selected && queue.fits)
    .map((queue) => queue.title)
    .join(', '),
);

onActivated(() => {
  now.value = Date.now();
  ticker = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onDeactivated(() => {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
});

function popIn(queue: MatchmakerQueue): string {
  if (!queue.popAt) {
    return '—';
  }
  const seconds = (Date.parse(queue.popAt) - now.value) / 1000;
  return seconds > 0 ? formatClock(seconds) : t('matchmaker.queues.popNow');
}

function queueStats(queue: MatchmakerQueue): { label: string; value: string | number }[] {
  return [
    { label: t('matchmaker.queues.rating'), value: queue.rating ?? '—' },
    { label: t('matchmaker.queues.popIn'), value: popIn(queue) },
    { label: t('matchmaker.queues.playersInQueue'), value: queue.playersInQueue },
    { label: t('matchmaker.queues.activeGames'), value: queue.activeGames },
  ];
}

function togglePool(queue: MatchmakerQueue): void {
  poolName.value = poolName.value === queue.name ? null : queue.name;
}

function factionIcon(faction: MatchmakerFaction): string | null {
  return emoticonSrc(`:${faction}:`);
}

async function run(action: () => Promise<unknown>): Promise<void> {
  error.value = null;
  busy.value = true;
  try {
    await action();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}

function toggleFaction(faction: MatchmakerFaction): void {
  const current = state.value.factions;
  const next = current.includes(faction) ? current.filter((entry) => entry !== faction) : [...current, faction];
  // One faction always stays, as in the official client.
  if (next.length > 0) {
    void run(() => api.setFactions(MATCHMAKER_FACTIONS.filter((entry) => next.includes(entry))));
  }
}

function setSelected(queue: MatchmakerQueue, selected: boolean): void {
  void run(() => api.setQueueSelected(queue.name, selected));
}

function kick(member: Pick<PartyMember, 'playerId'>): void {
  void run(() => api.kick(member.playerId));
}
</script>

<template>
  <ListLayout :panel-open="poolQueue !== null" :placeholder="t('vault.detailPanel.placeholder.mapPool')" @close-panel="poolName = null">
    <template #header>
      <h1 class="mb-2 text-2xl">{{ t('matchmaker.title') }}</h1>
      <p class="mb-4 max-w-200 text-sm text-muted-foreground">
        {{ t('matchmaker.intro') }}
      </p>
    </template>

    <div class="flex flex-col gap-4">
      <Alert v-if="error" variant="destructive" class="flex items-center gap-3">
        <AlertDescription class="flex-1 selectable">{{ error }}</AlertDescription>
        <Button
          variant="ghost"
          size="icon-xs"
          :data-tooltip="t('matchmaker.hideError')"
          :aria-label="t('matchmaker.hideError')"
          @click="error = null"
        >
          <X />
        </Button>
      </Alert>

      <div
        v-for="invite in state.invites"
        :key="invite.playerId"
        class="plate flex items-center gap-3 bg-primary/8 px-4 py-3 [--plate-border:color-mix(in_srgb,var(--color-primary)_45%,transparent)]"
      >
        <UserPlus class="size-5 shrink-0 text-primary" />
        <span class="min-w-0 flex-1"><span class="font-semibold">{{ invite.login }}</span> {{ t('matchmaker.invite.invitesYou') }}</span>
        <Button
          size="sm"
          :disabled="busy || state.searching || state.preparing !== null"
          :data-tooltip="state.searching ? t('matchmaker.invite.stopSearchFirst') : undefined"
          @click="run(() => api.acceptInvite(invite.playerId))"
        >
          {{ t('matchmaker.invite.accept') }}
        </Button>
        <Button size="sm" variant="ghost" @click="run(() => api.declineInvite(invite.playerId))">{{ t('matchmaker.invite.decline') }}</Button>
      </div>

      <div
        class="plate cut-lg flex flex-wrap items-center gap-4 px-5 py-4"
        :class="
          state.searching || state.preparing
            ? 'bg-[color-mix(in_srgb,var(--color-primary)_6%,var(--color-card))] [--plate-border:var(--color-primary)]'
            : 'bg-card'
        "
      >
        <template v-if="state.searching">
          <Spinner class="size-5 text-primary" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="font-display text-lg font-semibold">
              {{ t('matchmaker.search.searching') }}
              <span class="font-sans text-base font-normal text-muted-foreground tabular-nums">{{ searchTime }}</span>
            </span>
            <span class="truncate text-sm text-muted-foreground">{{ searchingTitles }}</span>
          </div>
          <Button v-if="state.isOwner" variant="destructive" @click="run(() => api.stopSearch())">
            <Square />{{ t('matchmaker.search.stop') }}
          </Button>
          <span v-else class="text-sm text-muted-foreground">{{ t('matchmaker.search.onlyLeaderStops') }}</span>
        </template>
        <template v-else-if="state.preparing">
          <Spinner class="size-5 text-primary" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="font-display text-lg font-semibold">{{ t('matchmaker.search.preparing') }}</span>
            <span class="truncate text-sm text-muted-foreground">{{ state.preparing }}</span>
          </div>
          <Button variant="outline" @click="run(() => api.stopSearch())">{{ t('matchmaker.search.cancel') }}</Button>
        </template>
        <template v-else>
          <Button size="lg" :disabled="busy || state.blocker !== null" @click="run(() => api.startSearch())">
            <Search />{{ t('matchmaker.search.start') }}
          </Button>
          <span class="min-w-0 flex-1 text-sm" :class="{ 'text-muted-foreground': state.blocker }">
            {{ state.blocker ?? t('matchmaker.search.chosenQueues', { queues: chosen }) }}
          </span>
        </template>
      </div>

      <div class="grid items-start gap-5 @4xl:grid-cols-[minmax(0,1fr)_320px]">
        <div class="flex flex-col gap-3">
          <p v-if="!state.connected" class="text-sm text-muted-foreground">{{ t('matchmaker.queues.notConnected') }}</p>
          <p v-else-if="state.queues.length === 0" class="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />{{ t('matchmaker.queues.loading') }}
          </p>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4.5 pt-1.5">
            <div v-for="queue in state.queues" :key="queue.name" class="min-w-0" :class="{ brackets: poolName === queue.name }">
              <div
                class="plate cut-lg flex h-full flex-col gap-3.5 bg-card p-4 transition-colors"
                :class="[
                  queue.selected && queue.fits ? '[--plate-border:var(--color-primary)]' : 'hover:[--plate-border:var(--color-input)]',
                  { 'opacity-60': !queue.fits },
                ]"
              >
                <label class="flex cursor-pointer items-center gap-3">
                  <Checkbox
                    :model-value="queue.selected && queue.fits"
                    :disabled="!queue.fits || busy || !state.isOwner"
                    @update:model-value="(value) => setSelected(queue, value === true)"
                  />
                  <span class="truncate font-display text-xl font-semibold">{{ queue.title }}</span>
                  <Badge v-if="queue.status !== 'idle'" :variant="STATUS[queue.status].variant" class="ml-auto">
                    {{ t(STATUS[queue.status].text) }}
                  </Badge>
                </label>
                <DetailStats :items="queueStats(queue)" />
                <p v-if="!queue.fits" class="text-xs text-warning">{{ t('matchmaker.queues.partyTooLarge') }}</p>
                <Button
                  :variant="poolName === queue.name ? 'secondary' : 'outline'"
                  size="sm"
                  class="mt-auto self-start"
                  :aria-pressed="poolName === queue.name"
                  @click="togglePool(queue)"
                >
                  <MapIcon />{{ t('matchmaker.queues.mapPool') }}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <section class="plate cut-lg flex flex-col bg-card" aria-labelledby="party-title">
          <div class="flex h-12 items-center gap-2 border-b px-5">
            <h2 id="party-title" class="text-base">{{ inParty ? t('matchmaker.party.party') : t('matchmaker.party.you') }}</h2>
            <span v-if="inParty" class="text-sm text-muted-foreground tabular-nums">{{ party.length }}</span>
          </div>
          <div class="flex flex-col gap-4 px-5 py-4">
            <ul class="flex flex-col gap-px border bg-border">
              <li v-for="member in party" :key="member.playerId" class="flex h-9 items-center gap-2 bg-background px-2.5 text-[13px]">
                <Crown v-if="inParty && member.owner" class="size-4 shrink-0 text-warning" :aria-label="t('matchmaker.party.leader')" />
                <CountryFlag :country="member.country" />
                <span class="min-w-0 flex-1 truncate">
                  <span v-if="member.clan" class="text-primary">[{{ member.clan }}] </span>{{ member.login }}
                </span>
                <Badge v-if="member.self && inParty" variant="muted">{{ t('matchmaker.party.youBadge') }}</Badge>
                <Badge v-if="member.inGame" variant="warning">{{ t('matchmaker.party.inGame') }}</Badge>
                <span class="flex shrink-0 items-center gap-0.5">
                  <img
                    v-for="faction in member.factions"
                    :key="faction"
                    :src="factionIcon(faction) ?? undefined"
                    :alt="factionLabel(faction)"
                    :data-tooltip="factionLabel(faction)"
                    class="size-4"
                    draggable="false"
                  />
                </span>
                <Button
                  v-if="state.isOwner && inParty && !member.self"
                  variant="ghost"
                  size="icon-xs"
                  :data-tooltip="t('matchmaker.party.kick')"
                  :aria-label="t('matchmaker.party.kick')"
                  :disabled="busy"
                  @click="kick(member)"
                >
                  <UserMinus />
                </Button>
              </li>
            </ul>

            <div class="flex flex-col gap-2" role="group" aria-labelledby="factions-title">
              <span id="factions-title" class="text-[13px] text-muted-foreground">{{ t('matchmaker.party.factions') }}</span>
              <div class="grid grid-cols-4 gap-1">
                <button
                  v-for="faction in MATCHMAKER_FACTIONS"
                  :key="faction"
                  type="button"
                  class="plate plate-focus cut-sm flex flex-col items-center gap-1 px-1 py-2 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50"
                  :class="
                    state.factions.includes(faction)
                      ? 'bg-primary/12 text-foreground [--plate-border:var(--color-primary)]'
                      : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground'
                  "
                  :aria-pressed="state.factions.includes(faction)"
                  :disabled="busy"
                  @click="toggleFaction(faction)"
                >
                  <img
                    :src="factionIcon(faction) ?? undefined"
                    alt=""
                    class="size-6 transition-opacity"
                    :class="{ 'opacity-45 grayscale': !state.factions.includes(faction) }"
                    draggable="false"
                  />
                  {{ factionLabel(faction) }}
                </button>
              </div>
              <span class="text-xs text-muted-foreground">{{ t('matchmaker.party.factionsHint') }}</span>
            </div>

            <div class="flex flex-wrap gap-2 border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                :disabled="!state.connected || !state.isOwner || state.searching || state.preparing !== null"
                @click="inviting = true"
              >
                <UserPlus />{{ t('matchmaker.party.invite') }}
              </Button>
              <Button v-if="inParty" variant="ghost" size="sm" :disabled="busy" @click="run(() => api.leaveParty())">
                <LogOut />{{ t('matchmaker.party.leave') }}
              </Button>
            </div>
          </div>
          <PartyChatPanel v-if="state.partyChannel" :channel="state.partyChannel" />
        </section>
      </div>

      <PartyInviteDialog v-if="inviting" @close="inviting = false" />
    </div>

    <template #panel>
      <MapPoolPanel v-if="poolQueue" :queue="poolQueue" @close="poolName = null" />
    </template>
  </ListLayout>
</template>
