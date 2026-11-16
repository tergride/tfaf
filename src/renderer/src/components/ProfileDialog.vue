<script setup lang="ts">
import { Film, Flag, MessageSquare, StickyNote } from '@lucide/vue';
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { PlayerProfile } from '../../../shared/contract.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import { useAuth } from '../composables/useAuth.ts';
import { useChat } from '../composables/useChat.ts';
import { useDeferredClose } from '../composables/useDeferredClose.ts';
import { usePlayerDialogs } from '../composables/usePlayerDialogs.ts';
import { usePlayerNotes } from '../composables/usePlayerNotes.ts';
import { useReplayFocus } from '../composables/useReplayFocus.ts';
import { errorMessage, formatDate, formatNumber } from '../format.ts';
import { t } from '../lib/i18n.ts';
import AvatarImage from './AvatarImage.vue';
import CountryFlag from './CountryFlag.vue';
import DetailStats from './DetailStats.vue';
import PlayerNoteDialog from './PlayerNoteDialog.vue';
import ProfileAchievementsTab from './ProfileAchievementsTab.vue';
import ProfileRatingTab from './ProfileRatingTab.vue';
import ProfileStatisticsTab from './ProfileStatisticsTab.vue';

type ProfileTab = 'overview' | 'rating' | 'achievements' | 'statistics' | 'names';

const TABS: { id: ProfileTab; label: MessageKey }[] = [
  { id: 'overview', label: 'profile.tabs.overview' },
  { id: 'rating', label: 'profile.tabs.rating' },
  { id: 'achievements', label: 'profile.tabs.achievements' },
  { id: 'statistics', label: 'profile.tabs.statistics' },
  { id: 'names', label: 'profile.tabs.names' },
];

const props = defineProps<{ player: number | string }>();
const emit = defineEmits<{ close: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));
const auth = useAuth();
const chat = useChat();
const replayFocus = useReplayFocus();
const { openReport } = usePlayerDialogs();
const { noteOf } = usePlayerNotes();

const profile = shallowRef<PlayerProfile | null>(null);
const error = ref<string | null>(null);
const actionError = ref<string | null>(null);
const tab = ref<ProfileTab>('overview');
// A tab loads its data the first time it is shown and keeps it while the profile is open.
const visited = ref(new Set<ProfileTab>(['overview']));
const editingNote = ref(false);

watch(tab, (value) => {
  visited.value = new Set([...visited.value, value]);
});

onMounted(async () => {
  try {
    profile.value = await window.tfaf.profile.get(props.player);
  } catch (cause) {
    error.value = errorMessage(cause);
  }
});

const self = computed(() => auth.value?.status === 'signedIn' && auth.value.user.id === profile.value?.id);
const note = computed(() => noteOf(profile.value?.id));
const totalGames = computed(() => profile.value?.ratings.find((rating) => rating.technicalName === 'global')?.totalGames ?? null);

const status = computed(() => {
  const online = profile.value?.online;
  if (!online) {
    return { text: t('profile.status.offline'), variant: 'muted' as const };
  }
  if (online.game) {
    const title = online.game.title || t('profile.status.untitled');
    return online.game.playing
      ? { text: t('profile.status.playing', { title }), variant: 'info' as const }
      : { text: t('profile.status.inLobby', { title }), variant: 'accent' as const };
  }
  return { text: t('profile.status.online'), variant: 'success' as const };
});

function winRate(won: number, total: number): string {
  return total > 0 ? `${Math.round((won / total) * 100)} %` : '—';
}

async function message(): Promise<void> {
  const login = profile.value?.login;
  if (!login) {
    return;
  }
  actionError.value = null;
  try {
    chat.focus(await window.tfaf.chat.openPrivate(login));
    close();
  } catch (cause) {
    actionError.value = errorMessage(cause);
  }
}

function showReplays(): void {
  if (profile.value) {
    replayFocus.focusPlayer(profile.value.login);
    close();
  }
}

function report(): void {
  if (profile.value) {
    openReport({ players: [{ id: profile.value.id, login: profile.value.login }] });
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && close()">
    <DialogContent
      class="flex h-[min(720px,calc(100vh-var(--titlebar-height)-3rem))] max-w-[860px] flex-col gap-0 p-0 sm:max-w-[860px]"
      @close-auto-focus="onContentClosed"
    >
      <DialogHeader class="flex-row items-center gap-4 border-b px-6 py-4 pr-14">
        <AvatarImage v-if="profile?.online?.avatar" :avatar="profile.online.avatar" large />
        <div class="flex min-w-0 flex-col gap-0.5">
          <DialogTitle class="flex items-baseline gap-2 font-display text-xl">
            <span v-if="profile?.clan" class="text-primary">[{{ profile.clan.tag }}]</span>
            <span class="truncate selectable">{{ profile?.login ?? (typeof player === 'string' ? player : '') }}</span>
            <CountryFlag v-if="profile?.online?.country" :country="profile.online.country" class="self-center" />
          </DialogTitle>
          <DialogDescription>
            {{ profile?.clan ? profile.clan.name : t('profile.description') }}
          </DialogDescription>
        </div>
        <Badge v-if="profile" :variant="status.variant" class="ml-auto max-w-64 truncate">{{ status.text }}</Badge>
      </DialogHeader>

      <div v-if="error" class="p-6">
        <Alert variant="destructive"><AlertDescription class="selectable">{{ error }}</AlertDescription></Alert>
      </div>
      <div v-else-if="!profile" class="grid flex-1 place-items-center"><Spinner class="size-5 text-primary" /></div>

      <Tabs v-else v-model="tab" class="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList class="mx-6 mt-4 grid grid-cols-5">
          <TabsTrigger v-for="item in TABS" :key="item.id" :value="item.id">{{ t(item.label) }}</TabsTrigger>
        </TabsList>

        <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <TabsContent value="overview" class="flex flex-col gap-4">
            <DetailStats
              :items="[
                { label: t('profile.overview.registered'), value: formatDate(profile.registeredAt) },
                { label: t('profile.overview.games'), value: totalGames === null ? null : formatNumber(totalGames) },
              ]"
            />
            <section class="flex flex-col gap-1.5">
              <h3 class="font-sans text-xs font-normal text-muted-foreground">{{ t('profile.overview.ratings') }}</h3>
              <table v-if="profile.ratings.length" class="w-full border text-[13px]">
                <thead class="bg-secondary text-xs text-muted-foreground">
                  <tr>
                    <th class="px-3 py-1.5 text-left font-normal">{{ t('profile.overview.leaderboard') }}</th>
                    <th class="px-3 py-1.5 text-right font-normal">{{ t('profile.overview.rating') }}</th>
                    <th class="px-3 py-1.5 text-right font-normal">{{ t('profile.overview.gamesColumn') }}</th>
                    <th class="px-3 py-1.5 text-right font-normal">{{ t('profile.overview.winRate') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="rating in profile.ratings" :key="rating.leaderboardId" class="border-t">
                    <td class="px-3 py-1.5">{{ rating.name }}</td>
                    <td class="px-3 py-1.5 text-right font-medium tabular-nums">{{ formatNumber(rating.rating) }}</td>
                    <td class="px-3 py-1.5 text-right tabular-nums">{{ formatNumber(rating.totalGames) }}</td>
                    <td class="px-3 py-1.5 text-right tabular-nums">{{ winRate(rating.wonGames, rating.totalGames) }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="text-sm text-muted-foreground">{{ t('profile.overview.noRatings') }}</p>
            </section>
            <section class="flex flex-col gap-1.5">
              <h3 class="font-sans text-xs font-normal text-muted-foreground">{{ t('profile.overview.note') }}</h3>
              <p v-if="note" class="text-sm whitespace-pre-line selectable">{{ note }}</p>
              <p v-else class="text-sm text-faint">{{ t('profile.overview.noNote') }}</p>
            </section>
            <Alert v-if="actionError" variant="destructive"><AlertDescription class="selectable">{{ actionError }}</AlertDescription></Alert>
            <div class="flex flex-wrap gap-2 border-t pt-4">
              <Button v-if="!self" variant="outline" size="sm" @click="message"><MessageSquare />{{ t('profile.actions.message') }}</Button>
              <Button variant="outline" size="sm" @click="showReplays"><Film />{{ t('profile.actions.replays') }}</Button>
              <Button v-if="!self" variant="outline" size="sm" @click="editingNote = true">
                <StickyNote />{{ note ? t('profile.actions.editNote') : t('profile.actions.addNote') }}
              </Button>
              <Button v-if="!self" variant="ghost" size="sm" class="ml-auto text-destructive" @click="report">
                <Flag />{{ t('profile.actions.report') }}
              </Button>
            </div>
          </TabsContent>

          <TabsContent v-if="visited.has('rating')" value="rating" force-mount class="data-[state=inactive]:hidden">
            <ProfileRatingTab :profile="profile" />
          </TabsContent>
          <TabsContent v-if="visited.has('achievements')" value="achievements" force-mount class="data-[state=inactive]:hidden">
            <ProfileAchievementsTab :player-id="profile.id" />
          </TabsContent>
          <TabsContent v-if="visited.has('statistics')" value="statistics" force-mount class="data-[state=inactive]:hidden">
            <ProfileStatisticsTab :player-id="profile.id" />
          </TabsContent>

          <TabsContent value="names">
            <table v-if="profile.names.length" class="w-full border text-[13px]">
              <thead class="bg-secondary text-xs text-muted-foreground">
                <tr>
                  <th class="px-3 py-1.5 text-left font-normal">{{ t('profile.names.name') }}</th>
                  <th class="px-3 py-1.5 text-right font-normal">{{ t('profile.names.changed') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(record, index) in profile.names" :key="index" class="border-t">
                  <td class="px-3 py-1.5 selectable">{{ record.name }}</td>
                  <td class="px-3 py-1.5 text-right text-muted-foreground tabular-nums">{{ formatDate(record.changedAt) ?? '—' }}</td>
                </tr>
              </tbody>
            </table>
            <p v-else class="text-sm text-muted-foreground">{{ t('profile.names.none') }}</p>
          </TabsContent>
        </div>
      </Tabs>
    </DialogContent>
  </Dialog>

  <PlayerNoteDialog v-if="editingNote && profile" :player-id="profile.id" :login="profile.login" @close="editingNote = false" />
</template>
