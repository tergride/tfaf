<script setup lang="ts">
import { ChevronDown, StickyNote } from '@lucide/vue';
import { computed, ref, shallowRef, watch } from 'vue';
import type { ChatUser, ChatUserGroup, LiveGame, LobbyGame } from '../../../shared/contract.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import { useChatPrefs } from '../composables/useChatPrefs.ts';
import type { PlayerGame } from '../composables/usePlayerGames.ts';
import { usePlayerNotes } from '../composables/usePlayerNotes.ts';
import { t } from '../lib/i18n.ts';
import { chatUserGroup, nickColorFor } from '../lib/nickColors.ts';
import { playerActivity } from '../lib/playerActivity.ts';
import AvatarImage from './AvatarImage.vue';
import CountryFlag from './CountryFlag.vue';
import PlayerMenu from './PlayerMenu.vue';
import SearchInput from './SearchInput.vue';
import TfafBadge from './TfafBadge.vue';

// `games` tells where each player is: in an open lobby or in a running game. `channel` keeps the collapsed groups apart.
const props = defineProps<{ users: ChatUser[]; games: ReadonlyMap<number, PlayerGame>; channel: string }>();
const emit = defineEmits<{
  message: [nick: string];
  mention: [nick: string];
  relation: [user: ChatUser, relation: 'friend' | 'foe' | null];
  join: [game: LobbyGame];
  show: [game: LobbyGame];
  watch: [game: LiveGame];
  invite: [playerId: number];
  inviteToGame: [playerId: number];
  replays: [login: string];
  clan: [tag: string, target: 'website' | 'leader'];
  note: [user: ChatUser];
  color: [nick: string];
  mute: [nick: string, muted: boolean];
}>();

// The groups and their order follow the official client's user list.
const GROUPS: { id: ChatUserGroup; label: MessageKey }[] = [
  { id: 'self', label: 'chat.users.categories.self' },
  { id: 'moderators', label: 'chat.users.categories.moderators' },
  { id: 'friends', label: 'chat.users.categories.friends' },
  { id: 'players', label: 'chat.users.categories.players' },
  { id: 'foes', label: 'chat.users.categories.foes' },
  { id: 'chat', label: 'chat.users.categories.chat' },
  { id: 'away', label: 'chat.users.categories.away' },
];

// Collapsed groups by channel, a per-user convenience kept in the browser storage.
const COLLAPSED_KEY = 'tfaf.chat.collapsedGroups';

const search = ref('');
const collapsed = ref(new Set<ChatUserGroup>());
const menuUser = shallowRef<ChatUser | null>(null);
const menuAnchor = shallowRef<HTMLElement | null>(null);
const menuOpen = ref(false);
const { prefs } = useChatPrefs();
const { noteOf } = usePlayerNotes();
const collator = new Intl.Collator('ru', { sensitivity: 'base' });

function readCollapsed(): Record<string, ChatUserGroup[]> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}');
    return typeof stored === 'object' && stored !== null ? (stored as Record<string, ChatUserGroup[]>) : {};
  } catch {
    return {};
  }
}

watch(
  () => props.channel.toLowerCase(),
  (channel) => {
    const stored = readCollapsed()[channel];
    collapsed.value = new Set(Array.isArray(stored) ? stored.filter((group) => GROUPS.some((known) => known.id === group)) : []);
  },
  { immediate: true },
);

function gameOf(user: ChatUser): PlayerGame | null {
  return user.player ? (props.games.get(user.player.id) ?? null) : null;
}

const menuGame = computed(() => (menuUser.value ? gameOf(menuUser.value) : null));

const groups = computed(() => {
  const query = search.value.trim().toLowerCase();
  const byGroup = new Map<ChatUserGroup, ChatUser[]>();
  for (const user of props.users) {
    if (query && !user.nick.toLowerCase().includes(query) && !user.player?.clan?.toLowerCase().includes(query)) {
      continue;
    }
    const group = chatUserGroup(user);
    byGroup.set(group, [...(byGroup.get(group) ?? []), user]);
  }
  return GROUPS.flatMap((group) => {
    const users = byGroup.get(group.id);
    if (!users) {
      return [];
    }
    const entries = users
      .sort((a, b) => collator.compare(a.nick, b.nick))
      .map((user) => ({
        user,
        activity: playerActivity(gameOf(user)),
        color: nickColorFor(user.nick, group.id, prefs.value),
        note: noteOf(user.player?.id),
      }));
    return [{ ...group, entries }];
  });
});

function toggle(group: ChatUserGroup): void {
  const next = new Set(collapsed.value);
  if (next.has(group)) {
    next.delete(group);
  } else {
    next.add(group);
  }
  collapsed.value = next;
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify({ ...readCollapsed(), [props.channel.toLowerCase()]: [...next] }));
  } catch {
    // Unavailable storage only forgets the groups.
  }
}

function openMenu(event: MouseEvent, user: ChatUser): void {
  menuAnchor.value = event.currentTarget as HTMLElement;
  menuUser.value = user;
  menuOpen.value = true;
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2 py-3">
    <div class="px-3">
      <SearchInput v-model="search" :placeholder="t('chat.users.search')" :maxlength="50" />
    </div>
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-2">
      <div v-for="group in groups" :key="group.id" class="flex flex-col">
        <button
          type="button"
          class="flex h-7 items-center gap-1 px-1 text-xs text-faint outline-none hover:text-foreground focus-visible:text-foreground"
          :aria-expanded="!collapsed.has(group.id)"
          @click="toggle(group.id)"
        >
          <ChevronDown class="size-3.5 transition-transform" :class="{ '-rotate-90': collapsed.has(group.id) }" />
          {{ t(group.label) }}
          <span class="ml-auto tabular-nums">{{ group.entries.length }}</span>
        </button>
        <template v-if="!collapsed.has(group.id)">
          <button
            v-for="{ user, activity, color, note } in group.entries"
            :key="user.nick"
            type="button"
            class="plate plate-focus cut-xs flex h-7 shrink-0 items-center gap-2 px-2 text-left text-[13px] [--plate-border:transparent] hover:bg-secondary"
            :class="{ 'opacity-55': group.id === 'away' || group.id === 'foes', 'bg-accent!': menuOpen && menuUser === user }"
            @contextmenu.prevent="openMenu($event, user)"
          >
            <CountryFlag :country="user.player?.country" />
            <AvatarImage v-if="user.player?.avatar" :avatar="user.player.avatar" />
            <span class="min-w-0 flex-1 truncate">
              <span v-if="user.player?.clan" class="text-primary">[{{ user.player.clan }}] </span>
              <span :style="color ? { color } : undefined">{{ user.nick }}</span>
              <span v-if="prefs.showGameMap && activity" class="ml-1.5 text-[11px] text-faint">{{ activity.map }}</span>
            </span>
            <TfafBadge :login="user.nick" />
            <span v-if="note" class="flex shrink-0" :data-tooltip="note" role="img" :aria-label="t('chat.users.hasNote', { note })">
              <StickyNote class="size-3.5 text-warning" />
            </span>
            <span v-if="activity" class="flex shrink-0" :data-tooltip="activity.hint" role="img" :aria-label="activity.hint">
              <component :is="activity.icon" class="size-3.5" :class="activity.tone" />
            </span>
            <!-- A fixed width keeps the game marks of all rows in one column. -->
            <span v-if="user.player" class="w-8 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {{ user.player.rating ?? '' }}
            </span>
          </button>
        </template>
      </div>
      <p v-if="groups.length === 0" class="px-2 py-4 text-center text-xs text-muted-foreground">
        {{ search ? t('chat.users.noneFound') : t('chat.users.loading') }}
      </p>
    </div>

    <PlayerMenu
      v-model:open="menuOpen"
      :user="menuUser"
      :game="menuGame"
      :anchor="menuAnchor"
      mentionable
      @message="(nick) => emit('message', nick)"
      @mention="(nick) => emit('mention', nick)"
      @relation="(user, relation) => emit('relation', user, relation)"
      @join="(game) => emit('join', game)"
      @show="(game) => emit('show', game)"
      @watch="(game) => emit('watch', game)"
      @invite="(playerId) => emit('invite', playerId)"
      @invite-to-game="(playerId) => emit('inviteToGame', playerId)"
      @replays="(login) => emit('replays', login)"
      @clan="(tag, target) => emit('clan', tag, target)"
      @note="(user) => emit('note', user)"
      @color="(nick) => emit('color', nick)"
      @mute="(nick, muted) => emit('mute', nick, muted)"
    />
  </div>
</template>
