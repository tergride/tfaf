<script setup lang="ts">
import { CircleUser, StickyNote } from '@lucide/vue';
import { computed, ref, shallowRef, watch } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { PlayerProfile } from '../../../shared/contract.ts';
import { usePlayerDialogs } from '../composables/usePlayerDialogs.ts';
import { usePlayerNotes } from '../composables/usePlayerNotes.ts';
import { errorMessage, formatNumber } from '../format.ts';
import { t } from '../lib/i18n.ts';
import AvatarImage from './AvatarImage.vue';
import CountryFlag from './CountryFlag.vue';
import PlayerNoteDialog from './PlayerNoteDialog.vue';

// Who the private conversation is with, as the official client shows it beside the messages.
const props = defineProps<{ login: string }>();
const { openProfile } = usePlayerDialogs();
const { noteOf } = usePlayerNotes();

const profile = shallowRef<PlayerProfile | null>(null);
const error = ref<string | null>(null);
const editingNote = ref(false);
let request = 0;

watch(
  () => props.login,
  async (login) => {
    const current = ++request;
    profile.value = null;
    error.value = null;
    try {
      const next = await window.tfaf.profile.get(login);
      if (current === request) {
        profile.value = next;
      }
    } catch (cause) {
      if (current === request) {
        error.value = errorMessage(cause);
      }
    }
  },
  { immediate: true },
);

const note = computed(() => noteOf(profile.value?.id));
const totalGames = computed(() => profile.value?.ratings.find((rating) => rating.technicalName === 'global')?.totalGames ?? null);
const game = computed(() => profile.value?.online?.game ?? null);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 text-[13px]">
    <p v-if="error" class="text-xs text-muted-foreground selectable">{{ error }}</p>
    <div v-else-if="!profile" class="grid h-24 place-items-center"><Spinner class="size-5 text-primary" /></div>
    <template v-else>
      <div class="flex flex-col gap-1.5">
        <AvatarImage v-if="profile.online?.avatar" :avatar="profile.online.avatar" large />
        <span class="font-display text-base font-semibold wrap-anywhere selectable">
          <span v-if="profile.clan" class="text-primary">[{{ profile.clan.tag }}] </span>{{ profile.login }}
        </span>
        <span v-if="profile.clan" class="text-xs text-muted-foreground">{{ profile.clan.name }}</span>
        <div class="flex flex-wrap items-center gap-1.5">
          <Badge :variant="profile.online ? 'success' : 'muted'">
            {{ profile.online ? t('profile.status.online') : t('profile.status.offline') }}
          </Badge>
          <CountryFlag v-if="profile.online?.country" :country="profile.online.country" />
        </div>
        <span v-if="game" class="text-xs text-info">
          {{
            game.playing
              ? t('profile.status.playing', { title: game.title || t('profile.status.untitled') })
              : t('profile.status.inLobby', { title: game.title || t('profile.status.untitled') })
          }}
        </span>
      </div>

      <dl v-if="profile.ratings.length" class="flex flex-col gap-1">
        <div v-for="rating in profile.ratings" :key="rating.leaderboardId" class="flex items-baseline gap-2">
          <dt class="min-w-0 flex-1 truncate text-muted-foreground">{{ rating.name }}</dt>
          <dd class="font-medium tabular-nums">{{ formatNumber(rating.rating) }}</dd>
        </div>
        <div v-if="totalGames !== null" class="flex items-baseline gap-2 border-t pt-1">
          <dt class="min-w-0 flex-1 truncate text-muted-foreground">{{ t('profile.overview.games') }}</dt>
          <dd class="tabular-nums">{{ formatNumber(totalGames) }}</dd>
        </div>
      </dl>

      <div class="flex flex-col gap-1">
        <span class="text-xs text-muted-foreground">{{ t('profile.overview.note') }}</span>
        <p v-if="note" class="whitespace-pre-line selectable">{{ note }}</p>
        <Button variant="ghost" size="xs" class="self-start" @click="editingNote = true">
          <StickyNote />{{ note ? t('profile.actions.editNote') : t('profile.actions.addNote') }}
        </Button>
      </div>

      <Button variant="outline" size="sm" @click="openProfile(profile.id)"><CircleUser />{{ t('chat.users.menu.profile') }}</Button>
    </template>
    <PlayerNoteDialog v-if="editingNote && profile" :player-id="profile.id" :login="profile.login" @close="editingNote = false" />
  </div>
</template>
