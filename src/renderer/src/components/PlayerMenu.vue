<script setup lang="ts">
import {
  AtSign,
  Ban,
  Bell,
  CircleUser,
  Copy,
  Film,
  Flag,
  Globe,
  List,
  LogIn,
  MessageSquare,
  Palette,
  Play,
  Send,
  StickyNote,
  UserMinus,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  X,
} from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { type ChatUser, LIVE_REPLAY_DELAY_SECONDS, type LiveGame, type LiveReplayAction, type LobbyGame } from '../../../shared/contract.ts';
import { useChat } from '../composables/useChat.ts';
import { useChatPrefs } from '../composables/useChatPrefs.ts';
import { useGameSession } from '../composables/useGameSession.ts';
import { useLiveReplayTracking } from '../composables/useLiveReplayTracking.ts';
import { useLobby } from '../composables/useLobby.ts';
import { useMatchmaker } from '../composables/useMatchmaker.ts';
import type { PlayerGame } from '../composables/usePlayerGames.ts';
import { usePlayerDialogs } from '../composables/usePlayerDialogs.ts';
import { usePlayerNotes } from '../composables/usePlayerNotes.ts';
import { errorMessage } from '../format.ts';
import { canInviteToGame } from '../lib/gameInvites.ts';
import { t } from '../lib/i18n.ts';
import { gameTitle, JOIN_TONES } from '../lib/playerActivity.ts';

// The menu of a player in the chat's user list or the friend list. Actions that cannot be taken now are left out, not
// disabled. `offline` leaves out what needs the player online, `mentionable` offers to mention them in the message
// being written.
const props = defineProps<{
  user: ChatUser | null;
  game: PlayerGame | null;
  anchor: HTMLElement | null;
  offline?: boolean;
  mentionable?: boolean;
}>();
const open = defineModel<boolean>('open', { required: true });
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

const MENU_ITEM =
  'flex h-8 w-full items-center gap-2 px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground';

const openedAt = ref(0);
const { tracking, track, untrack } = useLiveReplayTracking();
const trackingBusy = ref(false);
const trackingError = ref<string | null>(null);
const { prefs } = useChatPrefs();
const { noteOf } = usePlayerNotes();
const { state: matchmaker } = useMatchmaker();
const { state: session } = useGameSession();
const { state: chat } = useChat();
const { state: lobby } = useLobby();
const { openProfile, openReport } = usePlayerDialogs();

watch([open, () => props.user], ([isOpen]) => {
  if (isOpen) {
    openedAt.value = Date.now();
    trackingError.value = null;
  }
});

const muted = computed(() => (props.user ? prefs.value.mutedUsers.includes(props.user.nick.toLowerCase()) : false));
/** An online game of ours is starting or waits in its lobby, so an invitation should be to that game. */
const inGameLobby = computed(
  () => session.value.kind === 'online' && session.value.phase !== 'idle' && session.value.current?.launched !== true,
);
/**
 * Only the party leader invites, and not during a search, as the matchmaker requires. In a game lobby the party
 * invitation is left out, so it is not taken for an invitation to that game.
 */
const canInvite = computed(() => {
  const player = props.user?.player;
  const state = matchmaker.value;
  return (
    player !== null &&
    player !== undefined &&
    !props.offline &&
    props.user?.relation !== 'self' &&
    !inGameLobby.value &&
    state.connected &&
    state.isOwner &&
    !state.searching &&
    state.preparing === null &&
    !state.party.some((member) => member.playerId === player.id)
  );
});

/**
 * We are in a lobby and the player is not in it yet. Only a TFAF launcher takes an invitation, and the chat knows who
 * runs one (ChatState.tfafPlayers). The launcher checks the rest when the invitation goes out.
 */
const canInviteHere = computed(() => {
  const user = props.user;
  return (
    user?.player !== null &&
    user?.player !== undefined &&
    !props.offline &&
    user.relation !== 'self' &&
    Object.hasOwn(chat.value.tfafPlayers, user.nick.toLowerCase()) &&
    canInviteToGame(session.value) &&
    props.game?.game.id !== session.value.gameId
  );
});
/** Friends and foes are kept by the lobby server, so they change only while it is connected. */
const canSetRelation = computed(() => lobby.value.status === 'connected');

/** A lobby one cannot join says why, since its join item is left out. */
const lobbyStatus = computed(() => {
  const game = props.game;
  if (game?.kind !== 'lobby') {
    return '';
  }
  const title = gameTitle(game);
  return game.join === 'closed'
    ? t(game.host ? 'chat.users.hostingHint' : 'chat.users.inLobbyHint', { title, reason: game.reason })
    : t(game.host ? 'chat.users.hosting' : 'chat.users.inLobby', { title });
});

/** Seconds until a running game can be watched, counted when the menu opened. */
const watchableIn = computed(() => {
  const game = props.game;
  if (game?.kind !== 'playing' || !game.game.launchedAt) {
    return 0;
  }
  const seconds = (Date.parse(game.game.launchedAt) + LIVE_REPLAY_DELAY_SECONDS * 1000 - openedAt.value) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0;
});

// The host asks for the password when the game needs one; for a TFAF lobby only the host's launcher knows that.
function joinGame(): void {
  const game = props.game;
  if (game?.kind === 'lobby' && game.join !== 'closed') {
    emit('join', game.game);
  }
}

function act(action: () => void): void {
  open.value = false;
  action();
}

// A failure (the game has just ended) stays in the menu, which closes only when the launcher accepted the request.
async function runTracking(action: () => Promise<void>): Promise<void> {
  trackingError.value = null;
  trackingBusy.value = true;
  try {
    await action();
    open.value = false;
  } catch (cause) {
    trackingError.value = errorMessage(cause);
  } finally {
    trackingBusy.value = false;
  }
}

function trackGame(action: LiveReplayAction): void {
  const game = props.game;
  if (game?.kind === 'playing') {
    void runTracking(() => track(game.game.id, action));
  }
}

function copyNick(nick: string): void {
  void navigator.clipboard.writeText(nick).catch(() => undefined);
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverAnchor :reference="anchor ?? undefined" />
    <PopoverContent v-if="user" side="left" align="start" class="flex max-h-[80vh] w-60 flex-col overflow-y-auto p-1">
      <div class="truncate px-2 py-1.5 text-sm font-semibold selectable">
        <span v-if="user.player?.clan" class="text-primary">[{{ user.player.clan }}] </span>{{ user.nick }}
      </div>
      <p v-if="noteOf(user.player?.id)" class="px-2 pb-1.5 text-xs whitespace-pre-line text-muted-foreground selectable">
        {{ noteOf(user.player?.id) }}
      </p>
      <template v-if="game?.kind === 'lobby'">
        <p class="px-2 pb-1 text-xs text-muted-foreground">{{ lobbyStatus }}</p>
        <button v-if="game.join !== 'closed'" type="button" :class="MENU_ITEM" @click="act(joinGame)">
          <LogIn :class="JOIN_TONES[game.join]" />
          {{ game.join === 'password' ? t('chat.users.menu.joinWithPassword') : t('chat.users.menu.join') }}
        </button>
        <button type="button" :class="MENU_ITEM" @click="act(() => game?.kind === 'lobby' && emit('show', game.game))">
          <List />{{ t('chat.users.menu.showInGames') }}
        </button>
        <div class="my-1 h-px bg-border" />
      </template>
      <template v-else-if="game?.kind === 'playing'">
        <p class="px-2 pb-1 text-xs text-muted-foreground">{{ t('chat.users.playing', { title: gameTitle(game) }) }}</p>
        <button
          v-if="watchableIn === 0"
          type="button"
          :class="MENU_ITEM"
          @click="act(() => game?.kind === 'playing' && emit('watch', game.game))"
        >
          <Play />{{ t('chat.users.menu.watch') }}
        </button>
        <template v-else-if="tracking?.gameId === game.game.id">
          <p class="px-2 pb-1 text-xs text-info">
            {{
              t(tracking.action === 'notify' ? 'chat.users.menu.trackingNotify' : 'chat.users.menu.trackingWatch', {
                minutes: Math.ceil(watchableIn / 60),
              })
            }}
          </p>
          <button type="button" :class="MENU_ITEM" :disabled="trackingBusy" @click="runTracking(untrack)">
            <X />{{ t('chat.users.menu.cancelTracking') }}
          </button>
        </template>
        <template v-else>
          <p class="px-2 pb-1 text-xs text-muted-foreground">
            {{ t('chat.users.menu.watchableIn', { minutes: Math.ceil(watchableIn / 60) }) }}
          </p>
          <button type="button" :class="MENU_ITEM" :disabled="trackingBusy" @click="trackGame('notify')">
            <Bell />{{ t('chat.users.menu.notifyWhenWatchable') }}
          </button>
          <button type="button" :class="MENU_ITEM" :disabled="trackingBusy" @click="trackGame('watch')">
            <Play />{{ t('chat.users.menu.watchWhenWatchable') }}
          </button>
        </template>
        <p v-if="trackingError" class="px-2 pb-1 text-xs text-destructive selectable">{{ trackingError }}</p>
        <div class="my-1 h-px bg-border" />
      </template>
      <button v-if="user.player" type="button" :class="MENU_ITEM" @click="act(() => openProfile(user!.player!.id))">
        <CircleUser />{{ t('chat.users.menu.profile') }}
      </button>
      <button v-if="user.relation !== 'self' && !offline" type="button" :class="MENU_ITEM" @click="act(() => emit('message', user!.nick))">
        <MessageSquare />{{ t('chat.users.menu.message') }}
      </button>
      <button v-if="mentionable" type="button" :class="MENU_ITEM" @click="act(() => emit('mention', user!.nick))">
        <AtSign />{{ t('chat.users.menu.mention') }}
      </button>
      <button v-if="canInvite" type="button" :class="MENU_ITEM" @click="act(() => emit('invite', user!.player!.id))">
        <Users />{{ t('chat.users.menu.inviteToParty') }}
      </button>
      <button v-if="canInviteHere" type="button" :class="MENU_ITEM" @click="act(() => emit('inviteToGame', user!.player!.id))">
        <Send />{{ t('chat.users.menu.inviteToGame') }}
      </button>
      <button v-if="user.player" type="button" :class="MENU_ITEM" @click="act(() => emit('replays', user!.nick))">
        <Film />{{ t('chat.users.menu.replays') }}
      </button>
      <template v-if="user.player?.clan">
        <button type="button" :class="MENU_ITEM" @click="act(() => emit('clan', user!.player!.clan!, 'website'))">
          <Globe />{{ t('chat.users.menu.clanWebsite') }}
        </button>
        <button type="button" :class="MENU_ITEM" @click="act(() => emit('clan', user!.player!.clan!, 'leader'))">
          <MessageSquare />{{ t('chat.users.menu.clanLeader') }}
        </button>
      </template>
      <template v-if="user.player && user.relation !== 'self'">
        <div class="my-1 h-px bg-border" />
        <template v-if="canSetRelation">
          <button
            type="button"
            :class="MENU_ITEM"
            @click="act(() => emit('relation', user!, user!.relation === 'friend' ? null : 'friend'))"
          >
            <component :is="user.relation === 'friend' ? UserMinus : UserPlus" />
            {{ user.relation === 'friend' ? t('chat.users.menu.removeFriend') : t('chat.users.menu.addFriend') }}
          </button>
          <button type="button" :class="MENU_ITEM" @click="act(() => emit('relation', user!, user!.relation === 'foe' ? null : 'foe'))">
            <Ban />
            {{ user.relation === 'foe' ? t('chat.users.menu.removeFoe') : t('chat.users.menu.addFoe') }}
          </button>
        </template>
        <button type="button" :class="MENU_ITEM" @click="act(() => emit('note', user!))">
          <StickyNote />{{ noteOf(user.player.id) ? t('chat.users.menu.editNote') : t('chat.users.menu.addNote') }}
        </button>
      </template>
      <button type="button" :class="MENU_ITEM" @click="act(() => emit('color', user!.nick))">
        <Palette />{{ t('chat.users.menu.nickColor') }}
      </button>
      <button v-if="user.relation !== 'self'" type="button" :class="MENU_ITEM" @click="act(() => emit('mute', user!.nick, !muted))">
        <component :is="muted ? Volume2 : VolumeX" />
        {{ muted ? t('chat.users.menu.unmute') : t('chat.users.menu.mute') }}
      </button>
      <button type="button" :class="MENU_ITEM" @click="act(() => copyNick(user!.nick))">
        <Copy />{{ t('chat.users.menu.copyNick') }}
      </button>
      <button
        v-if="user.player && user.relation !== 'self'"
        type="button"
        :class="MENU_ITEM"
        class="text-destructive"
        @click="act(() => openReport({ players: [{ id: user!.player!.id, login: user!.nick }] }))"
      >
        <Flag class="text-destructive!" />{{ t('chat.users.menu.report') }}
      </button>
    </PopoverContent>
  </Popover>
</template>
