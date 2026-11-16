<script setup lang="ts">
import { ChevronDown, StickyNote, UserPlus, Users, X } from '@lucide/vue';
import { computed, defineAsyncComponent, ref, shallowRef, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import type { ChatUser, FoundPlayer, Friend, LiveGame, LobbyGame } from '../../../shared/contract.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import { useChat } from '../composables/useChat.ts';
import { useChatPrefs } from '../composables/useChatPrefs.ts';
import { useFriends } from '../composables/useFriends.ts';
import { useGameFocus } from '../composables/useGameFocus.ts';
import { useJoinPassword } from '../composables/useJoinPassword.ts';
import { useLobby } from '../composables/useLobby.ts';
import { type PlayerGame, usePlayerGames } from '../composables/usePlayerGames.ts';
import { usePlayerNotes } from '../composables/usePlayerNotes.ts';
import { useReplayFocus } from '../composables/useReplayFocus.ts';
import { useSettledText } from '../composables/useSettledText.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { openExternal } from '../lib/links.ts';
import { nickColorFor } from '../lib/nickColors.ts';
import { gameTitle, playerActivity } from '../lib/playerActivity.ts';
import AvatarImage from './AvatarImage.vue';
import CountryFlag from './CountryFlag.vue';
import PlayerMenu from './PlayerMenu.vue';
import SearchInput from './SearchInput.vue';
import TfafBadge from './TfafBadge.vue';

const NickColorDialog = defineAsyncComponent(() => import('./NickColorDialog.vue'));
const PlayerNoteDialog = defineAsyncComponent(() => import('./PlayerNoteDialog.vue'));

type FriendGroup = 'playing' | 'lobby' | 'online' | 'offline';

const GROUPS: { id: FriendGroup; label: MessageKey }[] = [
  { id: 'playing', label: 'friends.groups.playing' },
  { id: 'lobby', label: 'friends.groups.lobby' },
  { id: 'online', label: 'friends.groups.online' },
  { id: 'offline', label: 'friends.groups.offline' },
];
// Collapsed groups, a per-user convenience kept in the browser storage; those offline start collapsed.
const COLLAPSED_KEY = 'tfaf.friends.collapsedGroups';

const { state: friendsState } = useFriends();
const { state: lobby } = useLobby();
const chat = useChat();
const { prefs, updateChatPrefs } = useChatPrefs();
const { noteOf } = usePlayerNotes();
const gameFocus = useGameFocus();
const joinPassword = useJoinPassword();
const replayFocus = useReplayFocus();
const collator = new Intl.Collator('ru', { sensitivity: 'base' });

const open = ref(false);
// Running games are looked up only while the list is on screen.
const playerGames = usePlayerGames(open);
const search = ref('');
const { settled } = useSettledText(() => search.value);
const found = ref<FoundPlayer[]>([]);
const error = ref<string | null>(null);
const collapsed = ref(readCollapsed());
const menuFriend = shallowRef<Friend | null>(null);
const menuAnchor = shallowRef<HTMLElement | null>(null);
const menuOpen = ref(false);
const noteFor = ref<{ playerId: number; login: string } | null>(null);
const colorFor = ref<string | null>(null);
let findRequest = 0;

const connected = computed(() => lobby.value.status === 'connected');
const total = computed(() => friendsState.value.friends.length);
const onlineCount = computed(() => friendsState.value.friends.filter((friend) => friend.online).length);
const friendIds = computed(() => new Set(friendsState.value.friends.map((friend) => friend.id)));

function readCollapsed(): Set<FriendGroup> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '["offline"]');
    return new Set(Array.isArray(stored) ? stored.filter((group) => GROUPS.some((known) => known.id === group)) : []);
  } catch {
    return new Set(['offline']);
  }
}

function toggle(group: FriendGroup): void {
  const next = new Set(collapsed.value);
  if (next.has(group)) {
    next.delete(group);
  } else {
    next.add(group);
  }
  collapsed.value = next;
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
  } catch {
    // Unavailable storage only forgets the groups.
  }
}

/** The friend as the chat's user list knows a player, for the player menu they share. */
function asChatUser(friend: Friend): ChatUser {
  const { id, login, clan, country, rating, avatar } = friend;
  return { nick: login ?? `#${id}`, moderator: false, away: false, relation: 'friend', player: { id, clan, country, rating, avatar } };
}

function groupOf(friend: Friend, game: PlayerGame | null): FriendGroup {
  if (!friend.online) {
    return 'offline';
  }
  return game?.kind === 'playing' ? 'playing' : game?.kind === 'lobby' ? 'lobby' : 'online';
}

const groups = computed(() => {
  const query = search.value.trim().toLowerCase();
  const byGroup = new Map<FriendGroup, { friend: Friend; game: PlayerGame | null }[]>();
  for (const friend of friendsState.value.friends) {
    if (query && !friend.login?.toLowerCase().includes(query) && !friend.clan?.toLowerCase().includes(query)) {
      continue;
    }
    const game = friend.online ? (playerGames.value.get(friend.id) ?? null) : null;
    const group = groupOf(friend, game);
    byGroup.set(group, [...(byGroup.get(group) ?? []), { friend, game }]);
  }
  return GROUPS.flatMap((group) => {
    const members = byGroup.get(group.id);
    if (!members) {
      return [];
    }
    const entries = members
      // Friends whose login is unknown go last.
      .sort(
        (a, b) =>
          Number(a.friend.login === null) - Number(b.friend.login === null) ||
          collator.compare(a.friend.login ?? '', b.friend.login ?? '') ||
          a.friend.id - b.friend.id,
      )
      .map(({ friend, game }) => {
        const activity = playerActivity(game);
        return {
          friend,
          game,
          activity,
          status: game && activity ? [gameTitle(game), activity.map].filter(Boolean).join(' · ') : '',
          color: friend.login ? nickColorFor(friend.login, 'friends', prefs.value) : null,
          note: noteOf(friend.id),
        };
      });
    return [{ ...group, entries }];
  });
});

const menuUser = computed(() => (menuFriend.value ? asChatUser(menuFriend.value) : null));
const menuGame = computed(() =>
  menuFriend.value?.online ? (playerGames.value.get(menuFriend.value.id) ?? null) : null,
);
const foundPlayers = computed(() => found.value.filter((player) => !player.friend && !friendIds.value.has(player.id)));

watch(settled, async (text) => {
  const request = ++findRequest;
  if (!text) {
    found.value = [];
    return;
  }
  try {
    const players = await window.tfaf.friends.find(text);
    if (request === findRequest) {
      found.value = players;
    }
  } catch (cause) {
    if (request === findRequest) {
      found.value = [];
      error.value = errorMessage(cause);
    }
  }
});

// A list opened again starts without the last search and its failure.
watch(open, (isOpen) => {
  if (!isOpen) {
    search.value = '';
    error.value = null;
  }
});

function openMenu(event: MouseEvent, friend: Friend): void {
  menuAnchor.value = event.currentTarget as HTMLElement;
  menuFriend.value = friend;
  menuOpen.value = true;
}

async function run(action: () => Promise<unknown>): Promise<void> {
  error.value = null;
  try {
    await action();
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}

/** Leaves the list for the chat, which shows the conversation. */
async function showConversation(nick: string): Promise<void> {
  const channel = await window.tfaf.chat.openPrivate(nick);
  open.value = false;
  chat.focus(channel);
}

function addFriend(player: FoundPlayer): void {
  void run(() => window.tfaf.chat.setRelation(player.id, 'friend'));
}

function setRelation(user: ChatUser, relation: 'friend' | 'foe' | null): void {
  const player = user.player;
  if (player) {
    void run(() => window.tfaf.chat.setRelation(player.id, relation));
  }
}

// A game with a password asks for it in the app's dialog, as from the chat.
function joinGame(game: LobbyGame): void {
  open.value = false;
  void run(async () => {
    if ((await window.tfaf.game.join(game.id, null)) === 'passwordRequired') {
      joinPassword.ask(game.id);
    }
  });
}

function showGame(game: LobbyGame): void {
  open.value = false;
  gameFocus.focus(game.id);
}

function watchGame(game: LiveGame): void {
  open.value = false;
  void run(() => window.tfaf.replays.watchLive(game.id));
}

function inviteToParty(playerId: number): void {
  void run(() => window.tfaf.matchmaker.invite(playerId));
}

function inviteToGame(playerId: number): void {
  void run(() => window.tfaf.game.invite(playerId));
}

function showReplays(login: string): void {
  open.value = false;
  replayFocus.focusPlayer(login);
}

function openClan(tag: string, target: 'website' | 'leader'): void {
  void run(async () => {
    const clan = await window.tfaf.chat.clan(tag);
    if (!clan) {
      throw new Error(t('chat.clan.notFound', { tag }));
    }
    if (target === 'website') {
      if (!clan.websiteUrl) {
        throw new Error(t('chat.clan.noWebsite', { tag }));
      }
      openExternal(clan.websiteUrl);
    } else {
      if (!clan.leader) {
        throw new Error(t('chat.clan.noLeader', { tag }));
      }
      await showConversation(clan.leader);
    }
  });
}

function editNote(user: ChatUser): void {
  if (user.player) {
    noteFor.value = { playerId: user.player.id, login: user.nick };
  }
}

function setMuted(nick: string, muted: boolean): void {
  const key = nick.toLowerCase();
  void run(() =>
    updateChatPrefs((current) => ({
      ...current,
      mutedUsers: muted ? [...current.mutedUsers.filter((entry) => entry !== key), key] : current.mutedUsers.filter((entry) => entry !== key),
    })),
  );
}
</script>

<template>
  <!-- Marked as a window control, so a click on it does not first close the open list as a click outside. -->
  <Button
    variant="ghost"
    size="sm"
    class="no-drag"
    data-window-controls
    :aria-label="t('friends.title')"
    :aria-expanded="open"
    :data-tooltip="connected ? t('friends.buttonHint', { online: onlineCount, total }) : t('friends.title')"
    @click="open = !open"
  >
    <Users />
    <span v-if="connected" class="text-xs text-muted-foreground tabular-nums">{{ onlineCount }}</span>
  </Button>
  <Sheet v-model:open="open">
    <SheetContent
      side="right"
      :show-close-button="false"
      class="w-80 gap-0 data-[state=closed]:duration-150 data-[state=open]:duration-200 sm:max-w-80"
    >
      <div class="flex items-center gap-2 border-b py-3 pr-3 pl-4">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <SheetTitle class="font-display text-base">{{ t('friends.title') }}</SheetTitle>
          <SheetDescription class="text-xs">{{ t('friends.summary', { online: onlineCount, total }) }}</SheetDescription>
        </div>
        <Button variant="ghost" size="icon-sm" :aria-label="t('common.close')" @click="open = false">
          <X />
        </Button>
      </div>
      <div class="flex flex-col gap-2 px-3 pt-3">
        <SearchInput v-model="search" :placeholder="t('friends.search')" :maxlength="50" />
        <p v-if="!connected" class="text-xs text-warning">{{ t('friends.noLobby') }}</p>
        <p v-if="error" class="text-xs text-destructive selectable">{{ error }}</p>
      </div>
      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2">
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
              v-for="{ friend, activity, status, color, note } in group.entries"
              :key="friend.id"
              type="button"
              class="plate plate-focus cut-xs flex min-h-8 shrink-0 items-center gap-2 px-2 py-1 text-left text-[13px] [--plate-border:transparent] hover:bg-secondary"
              :class="{ 'opacity-55': group.id === 'offline', 'bg-accent!': menuOpen && menuFriend?.id === friend.id }"
              @contextmenu.prevent="openMenu($event, friend)"
            >
              <CountryFlag :country="friend.country" />
              <AvatarImage v-if="friend.avatar" :avatar="friend.avatar" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate">
                  <span v-if="friend.clan" class="text-primary">[{{ friend.clan }}] </span>
                  <span v-if="friend.login" :style="color ? { color } : undefined">{{ friend.login }}</span>
                  <span v-else class="text-muted-foreground">{{ t('friends.unknownLogin', { id: friend.id }) }}</span>
                </span>
                <span v-if="status" class="truncate text-[11px] text-faint">{{ status }}</span>
              </span>
              <TfafBadge v-if="friend.login" :login="friend.login" />
              <span v-if="note" class="flex shrink-0" :data-tooltip="note" role="img" :aria-label="t('chat.users.hasNote', { note })">
                <StickyNote class="size-3.5 text-warning" />
              </span>
              <span v-if="activity" class="flex shrink-0" :data-tooltip="activity.hint" role="img" :aria-label="activity.hint">
                <component :is="activity.icon" class="size-3.5" :class="activity.tone" />
              </span>
            </button>
          </template>
        </div>
        <p v-if="groups.length === 0" class="px-2 py-4 text-center text-xs text-muted-foreground">
          {{ search.trim() ? t('friends.noFriendsFound') : t('friends.empty') }}
        </p>
        <template v-if="settled">
          <div class="mt-2 flex h-7 items-center px-1 text-xs text-faint">{{ t('friends.found') }}</div>
          <div v-for="player in foundPlayers" :key="player.id" class="flex h-8 shrink-0 items-center gap-2 px-2 text-[13px]">
            <CountryFlag :country="player.country" />
            <span class="min-w-0 flex-1 truncate">
              <span v-if="player.clan" class="text-primary">[{{ player.clan }}] </span>{{ player.login }}
            </span>
            <TfafBadge :login="player.login" />
            <Button
              variant="ghost"
              size="icon-xs"
              :data-tooltip="t('friends.add')"
              :aria-label="t('friends.addLogin', { login: player.login })"
              @click="addFriend(player)"
            >
              <UserPlus />
            </Button>
          </div>
          <p v-if="foundPlayers.length === 0" class="px-2 py-1 text-xs text-muted-foreground">{{ t('friends.noneOnline') }}</p>
        </template>
      </div>

      <PlayerMenu
        v-model:open="menuOpen"
        :user="menuUser"
        :game="menuGame"
        :anchor="menuAnchor"
        :offline="menuFriend?.online === false"
        @message="(nick) => run(() => showConversation(nick))"
        @relation="setRelation"
        @join="joinGame"
        @show="showGame"
        @watch="watchGame"
        @invite="inviteToParty"
        @invite-to-game="inviteToGame"
        @replays="showReplays"
        @clan="openClan"
        @note="editNote"
        @color="(nick) => (colorFor = nick)"
        @mute="setMuted"
      />
    </SheetContent>
  </Sheet>
  <PlayerNoteDialog v-if="noteFor" :player-id="noteFor.playerId" :login="noteFor.login" @close="noteFor = null" />
  <NickColorDialog v-if="colorFor" :nick="colorFor" @close="colorFor = null" />
</template>
