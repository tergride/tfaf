<script setup lang="ts">
import {
  ChevronDown,
  CircleUser,
  Download,
  Film,
  Flag,
  FolderOpen,
  Gamepad2,
  GraduationCap,
  Handshake,
  Image,
  Info,
  LifeBuoy,
  LogOut,
  Map as MapIcon,
  Medal,
  Menu,
  MessagesSquare,
  Newspaper,
  Power,
  Puzzle,
  Settings,
  Shield,
  Swords,
  Target,
  Trophy,
} from '@lucide/vue';
import { useElementSize, useMediaQuery } from '@vueuse/core';
import { computed, defineAsyncComponent, nextTick, ref, shallowRef, useTemplateRef, watch, type AsyncComponentLoader, type Component } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { TooltipProvider } from '@/components/ui/tooltip';
import splashUrl from './assets/splash.jpg';
import AppTooltips from './components/AppTooltips.vue';
import AvatarImage from './components/AvatarImage.vue';
import FriendsPanel from './components/FriendsPanel.vue';
import GameSessionBanner from './components/GameSessionBanner.vue';
import LaunchCard from './components/LaunchCard.vue';
import NotificationBell from './components/NotificationBell.vue';
import NotificationToasts from './components/NotificationToasts.vue';
import SideNav from './components/SideNav.vue';
import TaskToasts from './components/TaskToasts.vue';
import TitleBar from './components/TitleBar.vue';
import ViewLoading from './components/ViewLoading.vue';
import { APP_FOLDERS, type AppFolder, type LobbyGame, type ToastPosition } from '../../shared/contract.ts';
import type { MessageKey } from '../../shared/i18n/index.ts';
import { useAppUpdate } from './composables/useAppUpdate.ts';
import { useAuth } from './composables/useAuth.ts';
import { useChat } from './composables/useChat.ts';
import { useCloseQuestion } from './composables/useCloseQuestion.ts';
import { useCurrentAvatar } from './composables/useCurrentAvatar.ts';
import { confirmAction, useConfirmDialog } from './composables/useConfirm.ts';
import { useGameFocus } from './composables/useGameFocus.ts';
import { useReplayFocus } from './composables/useReplayFocus.ts';
import { useGameSession } from './composables/useGameSession.ts';
import { useLaunch } from './composables/useLaunch.ts';
import { useImagePreview } from './composables/useImagePreview.ts';
import { useJoinPassword } from './composables/useJoinPassword.ts';
import { useLobby } from './composables/useLobby.ts';
import { useMatchmaker } from './composables/useMatchmaker.ts';
import { useMapView } from './composables/useMapView.ts';
import { useNotifications } from './composables/useNotifications.ts';
import { usePlayerDialogs } from './composables/usePlayerDialogs.ts';
import { useTaskbarBadge } from './composables/useTaskbarBadge.ts';
import { reduceGameLoad } from './lib/gameLoad.ts';
import { t } from './lib/i18n.ts';
import LoginView from './views/LoginView.vue';

function lazyView(loader: AsyncComponentLoader): Component {
  return defineAsyncComponent({ loader, loadingComponent: ViewLoading, delay: 0 });
}

const AboutView = lazyView(() => import('./views/AboutView.vue'));
const ChatView = lazyView(() => import('./views/ChatView.vue'));
const CoopView = lazyView(() => import('./views/CoopView.vue'));
const CurrentGameView = lazyView(() => import('./views/CurrentGameView.vue'));
const GamesView = lazyView(() => import('./views/GamesView.vue'));
const LeaderboardsView = lazyView(() => import('./views/LeaderboardsView.vue'));
const LinksView = lazyView(() => import('./views/LinksView.vue'));
const MapsView = lazyView(() => import('./views/MapsView.vue'));
const MatchmakerView = lazyView(() => import('./views/MatchmakerView.vue'));
const ModsView = lazyView(() => import('./views/ModsView.vue'));
const NewsView = lazyView(() => import('./views/NewsView.vue'));
const ReplaysView = lazyView(() => import('./views/ReplaysView.vue'));
const SettingsView = lazyView(() => import('./views/SettingsView.vue'));
const TournamentsView = lazyView(() => import('./views/TournamentsView.vue'));
const TutorialsView = lazyView(() => import('./views/TutorialsView.vue'));
const UnitsView = lazyView(() => import('./views/UnitsView.vue'));

const AvatarDialog = defineAsyncComponent(() => import('./components/AvatarDialog.vue'));
const CloseToTrayDialog = defineAsyncComponent(() => import('./components/CloseToTrayDialog.vue'));
const ConfirmDialog = defineAsyncComponent(() => import('./components/ConfirmDialog.vue'));
const ImagePreviewDialog = defineAsyncComponent(() => import('./components/ImagePreviewDialog.vue'));
const JoinPasswordDialog = defineAsyncComponent(() => import('./components/JoinPasswordDialog.vue'));
const MapViewDialog = defineAsyncComponent(() => import('./components/MapViewDialog.vue'));
const LaunchDialog = defineAsyncComponent(() => import('./components/LaunchDialog.vue'));
const ProfileDialog = defineAsyncComponent(() => import('./components/ProfileDialog.vue'));
const ReportDialog = defineAsyncComponent(() => import('./components/ReportDialog.vue'));
const WhatsNewDialog = defineAsyncComponent(() => import('./components/WhatsNewDialog.vue'));

/** Keep an opened global dialog mounted so it can finish closing and retain its existing state. */
function onceRequested(requested: () => boolean) {
  const mounted = ref(false);
  watch(requested, (active) => { mounted.value ||= active; }, { immediate: true });
  return mounted;
}

type ViewId =
  | 'current'
  | 'games'
  | 'matchmaker'
  | 'coop'
  | 'chat'
  | 'replays'
  | 'maps'
  | 'mods'
  | 'news'
  | 'leaderboards'
  | 'tournaments'
  | 'units'
  | 'tutorials'
  | 'links'
  | 'about'
  | 'settings';

interface NavigationItem {
  id: ViewId;
  label: MessageKey;
  icon: Component;
  view: Component;
}

interface NavigationGroup {
  title: MessageKey | null;
  items: NavigationItem[];
}

// Shown only while Forged Alliance runs.
const CURRENT_GAME: NavigationItem = { id: 'current', label: 'app.nav.current', icon: Gamepad2, view: CurrentGameView };

// The last group stays at the bottom of the sidebar.
const NAVIGATION: NavigationGroup[] = [
  {
    title: null,
    items: [
      { id: 'games', label: 'app.nav.games', icon: Swords, view: GamesView },
      { id: 'matchmaker', label: 'app.nav.matchmaker', icon: Target, view: MatchmakerView },
      { id: 'coop', label: 'app.nav.coop', icon: Handshake, view: CoopView },
      { id: 'chat', label: 'app.nav.chat', icon: MessagesSquare, view: ChatView },
      { id: 'replays', label: 'app.nav.replays', icon: Film, view: ReplaysView },
      { id: 'maps', label: 'app.nav.maps', icon: MapIcon, view: MapsView },
      { id: 'mods', label: 'app.nav.mods', icon: Puzzle, view: ModsView },
    ],
  },
  {
    title: 'app.nav.community',
    items: [
      { id: 'news', label: 'app.nav.news', icon: Newspaper, view: NewsView },
      { id: 'leaderboards', label: 'app.nav.leaderboards', icon: Medal, view: LeaderboardsView },
      { id: 'tournaments', label: 'app.nav.tournaments', icon: Trophy, view: TournamentsView },
    ],
  },
  {
    title: 'app.nav.help',
    items: [
      { id: 'units', label: 'app.nav.units', icon: Shield, view: UnitsView },
      { id: 'tutorials', label: 'app.nav.tutorials', icon: GraduationCap, view: TutorialsView },
      { id: 'links', label: 'app.nav.links', icon: LifeBuoy, view: LinksView },
    ],
  },
  {
    title: null,
    items: [
      { id: 'about', label: 'app.nav.about', icon: Info, view: AboutView },
      { id: 'settings', label: 'app.nav.settings', icon: Settings, view: SettingsView },
    ],
  },
];

const LOBBY_STATUS = {
  connected: { text: 'app.lobbyStatus.connected', dot: 'bg-success shadow-[0_0_6px_var(--color-success)]' },
  connecting: { text: 'app.lobbyStatus.connecting', dot: 'bg-warning shadow-[0_0_6px_var(--color-warning)] animate-pulse' },
  disconnected: { text: 'app.lobbyStatus.disconnected', dot: 'bg-destructive shadow-[0_0_6px_var(--color-destructive)]' },
} as const satisfies Record<string, { text: MessageKey; dot: string }>;

const auth = useAuth();
const { state: lobby, games } = useLobby();
const { state: session } = useGameSession();
const { active: starting, visible: launchVisible, minimized: startMinimized } = useLaunch();
const { current: imagePreview } = useImagePreview();
const { current: mapView } = useMapView();
const { pending: confirmation } = useConfirmDialog();
const mountLaunchDialog = onceRequested(() => launchVisible.value);
const mountImagePreview = onceRequested(() => imagePreview.value !== null);
const mountMapView = onceRequested(() => mapView.value !== null);
const mountConfirmDialog = onceRequested(() => confirmation.value !== null);
const { open: closeQuestion } = useCloseQuestion();
const mountCloseQuestion = onceRequested(() => closeQuestion.value);
const joinPassword = useJoinPassword();
// Like the games list, the dialog keeps the game it opened for, so a change of the game does not close it.
const passwordGame = shallowRef<LobbyGame | null>(null);
// A request for a game that has not come into the list by then is dropped.
const JOIN_PASSWORD_WAIT_MS = 60_000;
watch(
  [joinPassword.request, games],
  ([request, list]) => {
    if (!request) {
      return;
    }
    const game = list.find((item) => item.id === request.gameId);
    if (game) {
      passwordGame.value = game;
      joinPassword.done();
    } else if (Date.now() - request.at > JOIN_PASSWORD_WAIT_MS) {
      joinPassword.done();
    }
  },
  { immediate: true },
);
// The section left last opens again, as the official client does; the current game tab opens by itself instead.
const LAST_VIEW_KEY = 'tfaf.lastView';
const startItem = (() => {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LAST_VIEW_KEY);
  } catch {
    // Unavailable storage starts on the games list.
  }
  return NAVIGATION.flatMap((group) => group.items).find((item) => item.id === stored) ?? NAVIGATION[0]!.items[0]!;
})();
const current = ref<ViewId>(startItem.id);
const currentView = shallowRef<Component>(startItem.view);
const loggingOut = ref(false);
const appUpdate = useAppUpdate();
const { attention: chatAttention, focusRequest: chatFocusRequest, focus: focusChat } = useChat();
const { state: matchmaker, focusRequest: matchmakerFocusRequest } = useMatchmaker();
const { request: gameFocusRequest, focus: focusGame } = useGameFocus();
const { request: replayFocusRequest, focusGame: focusReplay } = useReplayFocus();
const playerDialogs = usePlayerDialogs();
const userMenuOpen = ref(false);
const foldersOpen = ref(false);
const currentAvatar = useCurrentAvatar();
const { unread: unreadNotifications, prefs: notificationPrefs } = useNotifications();
useTaskbarBadge(computed(() => unreadNotifications.value + chatAttention.value));

// Toasts in the bottom right corner share the column of the start and download cards.
const TOAST_CORNERS: Record<Exclude<ToastPosition, 'bottomRight'>, string> = {
  bottomLeft: 'bottom-5 left-5',
  topRight: 'top-[calc(var(--titlebar-height)+1rem)] right-5',
  topLeft: 'top-[calc(var(--titlebar-height)+1rem)] left-5',
};

// A click on a notification of the main process or in the tray menu: a private chat, an open game, a finished game,
// the current game, the matchmaker or the launcher's update.
window.tfaf.onNavigate((target) => {
  if (target.view === 'chat') {
    focusChat(target.channel);
  } else if (target.view === 'game') {
    focusGame(target.gameId);
  } else if (target.view === 'joinPassword') {
    focusGame(target.gameId);
    joinPassword.ask(target.gameId);
  } else if (target.view === 'replay') {
    focusReplay(target.gameId);
  } else {
    navigate(target.view);
  }
});
// In a narrower window the sidebar keeps only the icons, so lists and their side panels have room; in a narrow one
// it hides and opens over the page from the title bar. ListLayout.vue keeps its side panel docked from 72rem as well.
const compactNav = useMediaQuery('(width < 72rem)');
const drawerNav = useMediaQuery('(width < 60rem)');
const drawerOpen = ref(false);

const signedIn = computed(() => (auth.value?.status === 'signedIn' ? auth.value : null));
const inGame = computed(() => session.value.phase !== 'idle');
// The start window shows a start in progress and a failed start; the banner the running game and its exit.
const showBanner = computed(() => session.value.phase === 'running' || (session.value.error !== null && session.value.stages.length === 0));
// The current game tab has its own header with the same title and exit.
const showPageBanner = computed(() => showBanner.value && !(current.value === 'current' && session.value.current !== null));
const navigation = computed(() =>
  session.value.current ? [{ title: null, items: [CURRENT_GAME] }, ...NAVIGATION] : NAVIGATION,
);
const navigationGroups = computed(() =>
  navigation.value.map((group) => ({
    title: group.title && t(group.title),
    items: group.items.map((item) => ({ ...item, label: t(item.label) })),
  })),
);
const openGames = computed<Partial<Record<ViewId, number>>>(() => ({
  games: games.value.filter((game) => game.gameType === 'custom').length,
  coop: games.value.filter((game) => game.gameType === 'coop').length,
}));
const attention = computed<Partial<Record<ViewId, { count: number; title: string }>>>(() => ({
  matchmaker: matchmaker.value.invites.length ? { count: matchmaker.value.invites.length, title: t('app.partyInvites') } : undefined,
  chat: chatAttention.value ? { count: chatAttention.value, title: t('app.mentions') } : undefined,
}));
const matchmakerBusy = computed(() => matchmaker.value.searching || matchmaker.value.preparing !== null);
const busy = computed<Partial<Record<ViewId, boolean>>>(() => ({ matchmaker: matchmakerBusy.value }));
// The hidden menu's button carries the mark of the sections that wait for the user.
const navNeedsAttention = computed(() => Object.values(attention.value).some(Boolean) || matchmakerBusy.value);

// All views share one scroll container, so each view's position is kept separately.
const scrollPositions = new Map<ViewId, number>();
const mainElement = useTemplateRef<HTMLElement>('main');
// Sticky view headers stop under the game banner instead of hiding behind it.
const { height: pageBannerHeight } = useElementSize(useTemplateRef<HTMLElement>('pageBanner'), undefined, { box: 'border-box' });

// Views left behind stay alive and keep following the lobby and the chat off screen, so a game that plays with the
// load setting on lets go of them, and until it ends only the last views the user opened are kept. The dialogs that
// are always there start anew with them: each remembers the element that had the focus when it opened, and through it
// a view and all the views kept beside it.
const MAX_KEPT_VIEWS_IN_GAME = 2;
const lightweight = computed(() => reduceGameLoad.value && session.value.current?.launched === true);
const keptViews = ref(0);

watch(lightweight, async (light) => {
  if (light) {
    keptViews.value++;
    await nextTick();
    // Removed elements stay in the animation timeline until the next frame, and a window behind the game draws none.
    // Reading the animations brings the timeline up to date without one.
    document.getAnimations();
    window.tfaf.releaseMemory();
  }
});

function navigate(id: ViewId): void {
  const target = navigation.value.flatMap((group) => group.items).find((item) => item.id === id);
  if (!target) {
    return;
  }
  if (mainElement.value) {
    scrollPositions.set(current.value, mainElement.value.scrollTop);
  }
  current.value = id;
  currentView.value = target.view;
  if (id !== 'current') {
    try {
      localStorage.setItem(LAST_VIEW_KEY, id);
    } catch {
      // Unavailable storage only forgets the section.
    }
  }
  drawerOpen.value = false;
  void nextTick(() => mainElement.value?.scrollTo({ top: scrollPositions.get(id) ?? 0 }));
}

watch(drawerNav, (drawer) => {
  if (!drawer) {
    drawerOpen.value = false;
  }
});

// The tab opens once when the game starts; when the game is over, its tab gives way to the games list.
watch(
  () => Boolean(session.value.current),
  (running, wasRunning) => {
    if (running && !wasRunning) {
      navigate('current');
    } else if (!running && current.value === 'current') {
      navigate('games');
    }
  },
);

// A click on a chat notification brings the chat forward; the chat itself then shows the channel.
watch(chatFocusRequest, (request) => {
  if (request) {
    navigate('chat');
  }
});

watch(matchmakerFocusRequest, (request) => {
  if (request) {
    navigate('matchmaker');
  }
});

// A game shown from elsewhere, e.g. the chat, opens in its list: coop games in the coop tab, the others in games.
watch(gameFocusRequest, (request) => {
  const game = request ? games.value.find((item) => item.id === request.gameId) : null;
  if (game) {
    navigate(game.gameType === 'coop' ? 'coop' : 'games');
  }
});

watch(replayFocusRequest, (request) => {
  if (request) {
    navigate('replays');
  }
});

function openFolder(folder: AppFolder): void {
  userMenuOpen.value = false;
  window.tfaf.folders.open(folder).catch((error: unknown) => console.warn('Folder could not be opened', error));
}

function openFromUserMenu(open: () => void): void {
  userMenuOpen.value = false;
  open();
}

// The question and the warning about a running game come from the main process, as in the tray menu.
function quit(): void {
  userMenuOpen.value = false;
  window.tfaf.appWindow.quit().catch((error: unknown) => console.warn('Quit failed', error));
}

async function logout(): Promise<void> {
  const login = signedIn.value?.user.login;
  if (!login) {
    return;
  }
  userMenuOpen.value = false;
  const confirmed = await confirmAction({
    title: t('app.confirmLogout.message', { login }),
    description: t('app.confirmLogout.detail'),
    confirmText: t('app.confirmLogout.confirm'),
  });
  // A game that started meanwhile keeps the session: it reports its results through the lobby connection.
  if (!confirmed || inGame.value) {
    return;
  }
  loggingOut.value = true;
  try {
    await window.tfaf.auth.logout();
  } finally {
    loggingOut.value = false;
  }
}
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div class="flex h-full flex-col">
      <TitleBar>
        <template v-if="signedIn && drawerNav" #start>
          <!-- Marked as a window control, so a click on it does not first close the open menu as a click outside. -->
          <Button
            variant="ghost"
            size="icon-sm"
            class="no-drag relative"
            data-window-controls
            :aria-label="drawerOpen ? t('app.hideSections') : t('app.sections')"
            :aria-expanded="drawerOpen"
            @click="drawerOpen = !drawerOpen"
          >
            <Menu />
            <span v-if="navNeedsAttention && !drawerOpen" class="absolute top-1 right-1 size-2 bg-primary" />
          </Button>
        </template>
        <template v-if="signedIn">
          <Button v-if="starting" variant="ghost" size="sm" class="no-drag text-primary" @click="startMinimized = false">
            <Spinner />
            {{ t('app.preparingGame') }}
          </Button>
          <Button v-else-if="session.current" variant="ghost" size="sm" class="no-drag text-primary" @click="navigate('current')">
            <Gamepad2 />
            {{ session.phase === 'lobby' ? t('app.inLobby') : t('app.gameRunning') }}
          </Button>
          <Button v-else-if="matchmakerBusy" variant="ghost" size="sm" class="no-drag text-primary" @click="navigate('matchmaker')">
            <Spinner />
            {{ t('app.searchingMatch') }}
          </Button>
          <Button
            v-if="appUpdate?.status === 'ready'"
            size="xs"
            class="no-drag"
            :data-tooltip="t('app.restartToVersion', { version: appUpdate.version ?? '' })"
            @click="navigate('about')"
          >
            <Download />
            <span class="max-[60rem]:sr-only">{{ t('app.updateAvailable') }}</span>
          </Button>
          <!-- A narrow window keeps only the lamp; the words stay in its tooltip. -->
          <span class="flex items-center gap-2 text-xs text-muted-foreground" :data-tooltip="t(LOBBY_STATUS[lobby.status].text)">
            <span class="size-1.75 rounded-full" :class="LOBBY_STATUS[lobby.status].dot" />
            <span class="max-[60rem]:sr-only">{{ t(LOBBY_STATUS[lobby.status].text) }}</span>
          </span>
          <FriendsPanel />
          <NotificationBell />
          <Popover v-model:open="userMenuOpen">
            <PopoverTrigger as-child>
              <Button variant="ghost" size="sm" class="no-drag gap-2 font-medium">
                <AvatarImage v-if="currentAvatar" :avatar="currentAvatar" />
                {{ signedIn.user.login }}
                <Badge :variant="signedIn.server === 'test' ? 'warning' : 'success'">
                  {{ signedIn.server === 'test' ? t('app.testServerBadge') : 'FAF' }}
                </Badge>
                <ChevronDown v-if="!currentAvatar" class="text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" class="flex w-64 flex-col gap-3">
              <div class="flex flex-col gap-0.5">
                <span class="font-display text-base font-semibold selectable">{{ signedIn.user.login }}</span>
                <span class="text-xs text-muted-foreground">
                  {{ signedIn.server === 'test' ? t('app.testServer') : t('app.prodServer') }}
                </span>
              </div>
              <div class="-mx-1 flex flex-col">
                <Button variant="ghost" size="sm" class="justify-start" @click="openFromUserMenu(() => playerDialogs.openProfile(signedIn!.user.id))">
                  <CircleUser />{{ t('app.userMenu.profile') }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="justify-start"
                  :disabled="lobby.status !== 'connected'"
                  @click="openFromUserMenu(playerDialogs.openAvatars)"
                >
                  <Image />{{ t('app.userMenu.avatar') }}
                </Button>
                <Button variant="ghost" size="sm" class="justify-start" @click="openFromUserMenu(() => playerDialogs.openReport({}, 'list'))">
                  <Flag />{{ t('app.userMenu.reports') }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="justify-start"
                  :aria-expanded="foldersOpen"
                  @click="foldersOpen = !foldersOpen"
                >
                  <FolderOpen />{{ t('app.userMenu.folders') }}
                  <ChevronDown class="ml-auto transition-transform" :class="{ 'rotate-180': foldersOpen }" />
                </Button>
                <div v-if="foldersOpen" class="ml-6 flex flex-col">
                  <Button
                    v-for="folder in APP_FOLDERS"
                    :key="folder"
                    variant="ghost"
                    size="xs"
                    class="justify-start text-muted-foreground"
                    :data-tooltip="folder === 'gamePrefs' ? t('app.folderHints.gamePrefs') : undefined"
                    @click="openFolder(folder)"
                  >
                    {{ t(`app.folders.${folder}`) }}
                  </Button>
                </div>
              </div>
              <div class="flex flex-col gap-2">
                <Button variant="outline" size="sm" :disabled="loggingOut || inGame" @click="logout">
                  <LogOut />
                  {{ t('app.logout') }}
                </Button>
                <span v-if="inGame" class="text-xs text-muted-foreground">{{ t('app.closeGameToLogout') }}</span>
                <Button variant="outline" size="sm" @click="quit">
                  <Power />
                  {{ t('app.userMenu.quit') }}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </template>
      </TitleBar>

      <div class="min-h-0 flex-1">
        <div v-if="!auth" class="grid h-full place-items-center bg-[#081016]">
          <div class="flex flex-col items-center gap-4">
            <img :src="splashUrl" alt="TFAF" class="size-72" draggable="false" />
            <Spinner class="size-5 text-primary" />
          </div>
        </div>
        <div v-else-if="!signedIn" class="relative h-full">
          <LoginView :state="auth" />
          <!-- The game outlives the session, and closing it must stay possible from here. -->
          <div v-if="showBanner" class="absolute inset-x-0 top-0 p-4">
            <GameSessionBanner />
          </div>
        </div>
        <div v-else class="flex h-full">
          <aside
            v-if="!drawerNav"
            class="flex min-h-0 shrink-0 flex-col border-r bg-card py-3"
            :class="compactNav ? 'w-14 px-2' : 'w-52 px-2.5'"
          >
            <SideNav
              :groups="navigationGroups"
              :current="current"
              :compact="compactNav"
              :attention="attention"
              :counts="openGames"
              :busy="busy"
              @navigate="navigate"
            />
          </aside>
          <Sheet v-else v-model:open="drawerOpen">
            <SheetContent
              side="left"
              :show-close-button="false"
              class="w-56 gap-0 px-2.5 py-3 data-[state=closed]:duration-150 data-[state=open]:duration-200 sm:max-w-56"
            >
              <SheetTitle class="sr-only">{{ t('app.sections') }}</SheetTitle>
              <SheetDescription class="sr-only">{{ t('app.sectionsDescription') }}</SheetDescription>
              <SideNav
                :groups="navigationGroups"
                :current="current"
                :compact="false"
                :attention="attention"
                :counts="openGames"
                :busy="busy"
                @navigate="navigate"
              />
            </SheetContent>
          </Sheet>
          <main ref="main" class="flex min-w-0 flex-1 flex-col overflow-y-auto" :style="{ '--page-banner-height': `${pageBannerHeight}px` }">
            <div v-if="showPageBanner" ref="pageBanner" class="sticky top-0 z-10 bg-background/90 px-7 pt-4 backdrop-blur">
              <GameSessionBanner :details="current !== 'current'" @details="navigate('current')" />
            </div>
            <KeepAlive :key="keptViews" :max="lightweight ? MAX_KEPT_VIEWS_IN_GAME : undefined">
              <component :is="currentView" />
            </KeepAlive>
          </main>
        </div>
      </div>
    </div>
    <div v-if="auth" class="fixed right-5 bottom-5 z-40 flex w-90 flex-col gap-2" aria-live="polite">
      <NotificationToasts v-if="notificationPrefs.toastPosition === 'bottomRight'" />
      <LaunchCard />
      <TaskToasts />
    </div>
    <div
      v-if="auth && notificationPrefs.toastPosition !== 'bottomRight'"
      class="fixed z-40 flex w-90 flex-col gap-2"
      :class="TOAST_CORNERS[notificationPrefs.toastPosition]"
      aria-live="polite"
    >
      <NotificationToasts />
    </div>
    <LaunchDialog v-if="mountLaunchDialog" :key="keptViews" />
    <ImagePreviewDialog v-if="mountImagePreview" />
    <MapViewDialog v-if="mountMapView" />
    <template v-if="signedIn">
      <ProfileDialog
        v-if="playerDialogs.profile.value"
        :key="playerDialogs.profile.value.at"
        :player="playerDialogs.profile.value.player"
        @close="playerDialogs.closeProfile"
      />
      <ReportDialog
        v-if="playerDialogs.report.value"
        :key="playerDialogs.report.value.at"
        :prefill="playerDialogs.report.value.prefill"
        :tab="playerDialogs.report.value.tab"
        @close="playerDialogs.closeReport"
      />
      <AvatarDialog v-if="playerDialogs.avatars.value" @close="playerDialogs.closeAvatars" />
      <JoinPasswordDialog v-if="passwordGame" :key="passwordGame.id" :game="passwordGame" @close="passwordGame = null" />
      <WhatsNewDialog @history="navigate('about')" />
    </template>
    <ConfirmDialog v-if="mountConfirmDialog" :key="keptViews" />
    <CloseToTrayDialog v-if="mountCloseQuestion" />
    <AppTooltips />
  </TooltipProvider>
</template>
