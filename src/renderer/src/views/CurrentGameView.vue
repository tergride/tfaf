<script setup lang="ts">
import { Check, Gamepad2, Minus, Puzzle, Send, TriangleAlert, X } from '@lucide/vue';
import { type Component, computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  FilesComparison,
  GamePeer,
  LobbyGamePlayer,
  LocalCheckState,
  PlayerFiles,
  PlayerFilesCheck,
} from '../../../shared/contract.ts';
import logoUrl from '../assets/logo.png';
import CountryFlag from '../components/CountryFlag.vue';
import DetailPreview from '../components/DetailPreview.vue';
import TfafLobbyRoom from '../components/tfafLobby/TfafLobbyRoom.vue';
import { useAuth } from '../composables/useAuth.ts';
import { useCloseGame } from '../composables/useCloseGame.ts';
import { useGameSession } from '../composables/useGameSession.ts';
import { formatDuration, mapDisplayName, teamLabel } from '../format.ts';
import { canInviteToGame } from '../lib/gameInvites.ts';
import { t } from '../lib/i18n.ts';

const GameInviteDialog = defineAsyncComponent(() => import('../components/GameInviteDialog.vue'));
const GameModsDialog = defineAsyncComponent(() => import('../components/GameModsDialog.vue'));

/** `brief`: what is needed at a glance; `full`: everything the launcher knows about the game. */
type Detail = 'brief' | 'full';
/** Why a player's files cannot be compared with the host's. */
type MissingFiles = 'host' | 'tfaf' | 'otherClient' | 'waiting';

interface PlayerRow {
  key: string;
  id: number | null;
  login: string;
  clan: string | null;
  country: string | null;
  rating: number | null;
  self: boolean;
  peer: GamePeer | null;
  /** The player's files against the host's; null for the host and while the game does not compare. */
  check: PlayerFilesCheck | null;
  /** The check, when at least one part of it is known. */
  known: PlayerFilesCheck | null;
  /** What differs from the host's files, shown under the player. */
  differs: string[];
  /** TFAF features of our game the player lacks; disconnected players are listed above the players instead. */
  lacks: readonly string[];
  host: boolean;
}

interface Fact {
  label: string;
  value: string;
  /** How it compared with the vault before the start. */
  check: { state: LocalCheckState; text: string } | null;
}

interface Problem {
  key: string;
  text: string;
  /** Shown in the brief view only. */
  hint: string | null;
  /** Shown in the detailed view, and as a tooltip in the brief one. */
  detail: string | null;
  severe: boolean;
}

const DETAIL_KEY = 'tfaf.currentGame.detail';
const CHECK_TONES: Record<LocalCheckState, string> = {
  matches: 'text-success',
  repaired: 'text-info',
  notInVault: 'text-warning',
  unchecked: 'text-warning',
  official: 'text-muted-foreground',
};
const PARTS: readonly (keyof PlayerFiles)[] = ['gameFiles', 'map', 'mods'];
const MARKS: Record<FilesComparison, { icon: Component; tone: string }> = {
  same: { icon: Check, tone: 'text-success' },
  different: { icon: X, tone: 'text-destructive' },
  unknown: { icon: Minus, tone: 'text-faint' },
};
// The brief view marks a connection as poor above this ping or from this loss, and only then names the loss.
const SLOW_PING_MS = 150;
const NOTICEABLE_LOSS_PERCENT = 2;
// A team number that FA does not use, for players the lobby has not placed yet.
const UNPLACED_TEAM = 0;

const { state } = useGameSession();
const auth = useAuth();
const { close: closeGame, error: closeError } = useCloseGame();
const now = ref(Date.now());
const changingMods = ref(false);
const inviting = ref(false);
const ticker = setInterval(() => {
  now.value = Date.now();
}, 15_000);
onBeforeUnmount(() => clearInterval(ticker));

function storedDetail(): Detail {
  try {
    return localStorage.getItem(DETAIL_KEY) === 'full' ? 'full' : 'brief';
  } catch {
    return 'brief';
  }
}

const detail = ref<Detail>(storedDetail());
watch(detail, (value) => {
  try {
    localStorage.setItem(DETAIL_KEY, value);
  } catch {
    // Ignore unavailable storage.
  }
});
const full = computed(() => detail.value === 'full');

const current = computed(() => state.value.current);
// The room of a TFAF lobby stays until its match begins; only then this tab shows the running game.
const inRoom = computed(() => state.value.tfafLobby !== null && current.value?.launched === false);
const lobbyGame = computed(() => current.value?.lobbyGame ?? null);
const invitable = computed(() => canInviteToGame(state.value));
const localFiles = computed(() => current.value?.localFiles ?? null);
const self = computed(() => (auth.value?.status === 'signedIn' ? auth.value.user : null));
const elapsed = computed(() =>
  current.value ? formatDuration((now.value - Date.parse(current.value.startedAt)) / 1000) : null,
);
const mapName = computed(() => {
  const folder = lobbyGame.value?.mapFolderName ?? current.value?.map?.folderName ?? null;
  return folder ? mapDisplayName(folder) : null;
});
const heading = computed(() => {
  const title = lobbyGame.value?.title || state.value.title;
  return title ? t('currentGame.quoted', { title }) : t('currentGame.title');
});
const subtitle = computed(() =>
  [t(`currentGame.kinds.${state.value.kind}`), elapsed.value ? t('currentGame.elapsed', { duration: elapsed.value }) : null]
    .filter((part) => part !== null)
    .join(' · '),
);

const files = computed(() => state.value.files);
const checks = computed(() => new Map((files.value?.players ?? []).map((check) => [check.playerId, check])));
const hostWithoutFiles = computed(() => (files.value?.host && !files.value.host.known ? files.value.host.login : null));
const issues = computed(
  () => new Map(state.value.featureIssues.filter((issue) => !issue.kicked).map((issue) => [issue.playerId, issue.features])),
);

function row(player: Pick<LobbyGamePlayer, 'id' | 'login' | 'clan' | 'country' | 'rating'>, peer: GamePeer | null): PlayerRow {
  const user = self.value;
  const host = files.value?.host?.login.toLowerCase() === player.login.toLowerCase();
  const check = player.id === null || host ? null : (checks.value.get(player.id) ?? null);
  return {
    key: String(player.id ?? player.login),
    id: player.id,
    login: player.login,
    clan: player.clan,
    country: player.country,
    rating: player.rating,
    self: user !== null && (player.id === user.id || player.login.toLowerCase() === user.login.toLowerCase()),
    peer,
    check,
    known: check && PARTS.some((part) => check[part] !== 'unknown') ? check : null,
    differs: check ? differences(check) : [],
    lacks: (player.id === null ? null : issues.value.get(player.id)) ?? [],
    host,
  };
}

/** Teams as the lobby knows them, with the connection to each player; players the lobby has not placed yet go last. */
const teams = computed(() => {
  const peers = new Map(state.value.peers.map((peer) => [peer.playerId, peer]));
  const placed = new Set<number>();
  const groups = (lobbyGame.value?.teams ?? []).map((team) => ({
    team: team.team,
    players: team.players.map((player) => {
      if (player.id !== null) {
        placed.add(player.id);
      }
      return row(player, player.id === null ? null : (peers.get(player.id) ?? null));
    }),
  }));
  const unplaced = state.value.peers
    .filter((peer) => !placed.has(peer.playerId))
    .map((peer) => row({ id: peer.playerId, login: peer.login, clan: null, country: null, rating: null }, peer));
  if (unplaced.length > 0) {
    groups.push({ team: UNPLACED_TEAM, players: unplaced });
  }
  return groups;
});
// Player, connection, ping and loss, then a column per part of the files; the brief view folds them into three.
const columnCount = computed(() => (full.value ? 4 + PARTS.length : 3));
const connected = computed(() => state.value.peers.filter((peer) => peer.state === 'connected').length);
const differing = computed(() =>
  (files.value?.players ?? []).filter((check) => PARTS.some((part) => check[part] === 'different')),
);

function checked(check: LocalCheckState | null): Fact['check'] {
  return check ? { state: check, text: t(`currentGame.checks.${check}`) } : null;
}

const facts = computed<Fact[]>(() => {
  const game = lobbyGame.value;
  const local = localFiles.value;
  const featuredMod = game?.featuredModName ?? current.value?.featuredMod ?? null;
  return [
    mapName.value ? { label: t('currentGame.stats.map'), value: mapName.value, check: checked(local?.map ?? null) } : null,
    featuredMod
      ? {
          label: t('currentGame.stats.featuredMod'),
          value: featuredMod,
          check:
            local && local.gameVersion !== null
              ? { state: 'matches' as const, text: t('currentGame.checks.gameFiles', { version: local.gameVersion }) }
              : null,
        }
      : null,
    game ? { label: t('currentGame.stats.host'), value: game.host, check: null } : null,
    game
      ? {
          label: t('currentGame.stats.players'),
          value: t('currentGame.stats.playersOfMax', { players: game.numPlayers, max: game.maxPlayers }),
          check: null,
        }
      : null,
    full.value && state.value.gameId ? { label: t('currentGame.stats.gameId'), value: String(state.value.gameId), check: null } : null,
  ].filter((fact) => fact !== null);
});

/** The game's sim mods with how ours compared with the vault: the lobby names them, the start check adds the rest. */
const mods = computed(() => {
  const ours = new Map((localFiles.value?.mods ?? []).map((mod) => [mod.uid, mod]));
  const listed = (lobbyGame.value?.simMods ?? []).map((mod) => ({ ...mod, state: ours.get(mod.uid)?.state ?? null }));
  const uids = new Set(listed.map((mod) => mod.uid));
  return [...listed, ...[...ours.values()].filter((mod) => !uids.has(mod.uid))];
});

/** The brief view names a check only when something went wrong; the detailed one names every check. */
function showsCheck(check: LocalCheckState): boolean {
  return full.value || (check !== 'matches' && check !== 'official');
}

/** What needs attention; a lacking feature of a listed player is shown under the player instead. */
const problems = computed<Problem[]>(() => {
  const list: Problem[] = [];
  const desyncs = current.value?.desyncs ?? 0;
  if (desyncs > 0) {
    list.push({
      key: 'desync',
      text: t('currentGame.desyncs', { count: desyncs }),
      hint: null,
      detail: t('currentGame.desyncsDetail'),
      severe: true,
    });
  }
  if (differing.value.length > 0) {
    list.push({
      key: 'files',
      text: t('currentGame.filesDiffer', {
        host: files.value?.host?.login ?? '',
        players: differing.value.map((check) => check.login).join(', '),
      }),
      hint: t('currentGame.filesDifferHint'),
      detail: t('currentGame.filesDifferDetail'),
      severe: false,
    });
  }
  const listed = new Set(teams.value.flatMap((team) => team.players.map((player) => player.id)));
  for (const issue of state.value.featureIssues) {
    if (issue.kicked || !listed.has(issue.playerId)) {
      list.push({
        key: `feature-${issue.playerId}`,
        text: t(issue.kicked ? 'currentGame.featureIssues.kicked' : 'currentGame.featureIssues.missing', {
          login: issue.login,
          features: quotedList(issue.features),
        }),
        hint: null,
        detail: t('currentGame.featureIssues.detail'),
        severe: false,
      });
    }
  }
  return list;
});

/** `карта «Setons», мод «Exp Shields»`: what differs from the host's files. */
function differences(check: PlayerFilesCheck): string[] {
  const parts: string[] = [];
  if (check.gameFiles === 'different') {
    parts.push(t('currentGame.differs.gameFiles'));
  }
  if (check.map === 'different') {
    parts.push(mapName.value ? t('currentGame.differs.map', { map: mapName.value }) : t('currentGame.differs.mapUnnamed'));
  }
  if (check.mods === 'different') {
    if (check.differentMods.length === 0) {
      parts.push(t('currentGame.differs.mods'));
    }
    for (const mod of check.differentMods) {
      parts.push(mod === null ? t('currentGame.differs.unknownMod') : t('currentGame.differs.mod', { mod }));
    }
  }
  return parts;
}

function quotedList(names: readonly string[]): string {
  return names.map((name) => t('currentGame.quoted', { title: name })).join(', ');
}

function connectionLabel(peer: GamePeer): string {
  if (peer.state === 'connecting') {
    return t('currentGame.connection.connecting');
  }
  if (peer.state === 'reconnecting') {
    return t('currentGame.connection.reconnecting');
  }
  return peer.route === 'relay'
    ? t('currentGame.connection.relay')
    : peer.route === 'direct'
      ? t('currentGame.connection.direct')
      : t('currentGame.connection.connected');
}

function noticeableLoss(peer: GamePeer): boolean {
  return peer.loss !== null && Math.max(peer.loss.out, peer.loss.in) >= NOTICEABLE_LOSS_PERCENT;
}

function connectionDot(peer: GamePeer): string {
  if (peer.state === 'connecting') {
    return 'animate-pulse bg-primary shadow-[0_0_6px_var(--color-primary)]';
  }
  if (peer.state === 'reconnecting') {
    return 'animate-pulse bg-destructive shadow-[0_0_6px_var(--color-destructive)]';
  }
  const poor = (peer.rttMs !== null && peer.rttMs > SLOW_PING_MS) || noticeableLoss(peer) || peer.duplication;
  return poor ? 'bg-warning shadow-[0_0_6px_var(--color-warning)]' : 'bg-success shadow-[0_0_6px_var(--color-success)]';
}

function connectionTone(peer: GamePeer): string {
  return peer.state === 'reconnecting' ? 'text-destructive' : peer.state === 'connecting' ? 'text-muted-foreground' : '';
}

function lossTone(peer: GamePeer): string {
  if (!peer.loss) {
    return 'text-faint';
  }
  if (!noticeableLoss(peer)) {
    return '';
  }
  return peer.state === 'reconnecting' ? 'text-destructive' : 'text-warning';
}

/** The whole connection in one line, for the tooltip of the brief view. */
function connectionTitle(peer: GamePeer): string {
  return [
    connectionLabel(peer),
    peer.rttMs !== null ? t('currentGame.players.ping', { ms: peer.rttMs }) : null,
    peer.loss ? t('currentGame.players.loss', { out: peer.loss.out, in: peer.loss.in }) : null,
    peer.duplication ? t('currentGame.players.duplication') : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

/** The player's files have something to show: a comparison or the reason there is none. */
function showsFiles(player: PlayerRow): boolean {
  return player.peer !== null || player.check !== null;
}

function filesSummary(player: PlayerRow): FilesComparison {
  const check = player.known;
  if (!check) {
    return 'unknown';
  }
  if (PARTS.some((part) => check[part] === 'different')) {
    return 'different';
  }
  return PARTS.every((part) => check[part] === 'same') ? 'same' : 'unknown';
}

function missingFiles(player: PlayerRow): MissingFiles {
  if (hostWithoutFiles.value) {
    return 'host';
  }
  if (player.peer?.tfaf === true) {
    return 'tfaf';
  }
  return player.peer?.tfaf === false ? 'otherClient' : 'waiting';
}

function filesTitle(player: PlayerRow): string {
  const check = player.known;
  if (!check) {
    return t(`currentGame.noFingerprints.${missingFiles(player)}`);
  }
  const comparisons = PARTS.map((part) =>
    t('currentGame.partComparison', {
      part: t(`currentGame.parts.${part}`),
      comparison: t(`currentGame.comparison.${check[part]}`),
    }),
  ).join(', ');
  return player.differs.length > 0 ? `${comparisons}\n${player.differs.join(', ')}` : comparisons;
}
</script>

<template>
  <TfafLobbyRoom v-if="inRoom" />
  <section v-else class="@container flex min-h-full flex-col gap-5 px-7 pt-3 pb-8">
    <Empty v-if="!current">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Gamepad2 /></EmptyMedia>
        <EmptyTitle>{{ t('currentGame.notRunning') }}</EmptyTitle>
      </EmptyHeader>
    </Empty>

    <template v-else>
      <header class="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div class="min-w-0 flex-1">
          <h1 class="text-2xl wrap-anywhere selectable">{{ heading }}</h1>
          <p class="mt-0.5 text-sm text-muted-foreground tabular-nums">{{ subtitle }}</p>
        </div>
        <div class="flex shrink-0 flex-wrap items-center gap-2">
          <Tabs v-model="detail">
            <TabsList :aria-label="t('currentGame.detail.label')">
              <TabsTrigger value="brief" class="px-3">{{ t('currentGame.detail.brief') }}</TabsTrigger>
              <TabsTrigger value="full" class="px-3">{{ t('currentGame.detail.full') }}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button v-if="invitable" variant="secondary" size="sm" @click="inviting = true">
            <Send />
            {{ t('games.inviteDialog.open') }}
          </Button>
          <Button v-if="current.hostedMods" variant="secondary" size="sm" @click="changingMods = true">
            <Puzzle />
            {{ t('currentGame.changeMods.button') }}
          </Button>
          <Button variant="destructive" size="sm" @click="closeGame">
            {{ state.kind === 'replay' ? t('currentGame.banner.closeReplay') : t('currentGame.banner.closeGame') }}
          </Button>
        </div>
      </header>
      <p v-if="closeError" class="-mt-3 text-sm text-destructive selectable">{{ closeError }}</p>
      <GameModsDialog v-if="changingMods && current.hostedMods" :mod-uids="current.hostedMods" @close="changingMods = false" />
      <GameInviteDialog v-if="inviting" @close="inviting = false" />

      <div class="grid items-start gap-6 @4xl:grid-cols-[240px_minmax(0,1fr)] @4xl:gap-7">
        <!-- In a narrow window the facts and the mods stand next to the map instead of under it. -->
        <aside class="flex items-start gap-6 @4xl:flex-col @4xl:items-stretch @4xl:gap-5">
          <DetailPreview
            v-if="current.map"
            class="w-40 shrink-0 @4xl:w-auto"
            :preview="{
              title: mapName ?? current.map.folderName,
              details: current.map.folderName,
              src: current.map.previewLargeUrl,
              fallbackSrc: current.map.previewUrl,
            }"
            :fallback="current.map.previewUrl ? '?' : 'GEN'"
            :map-folder="current.map.folderName"
          />

          <div class="grid w-full min-w-0 items-start gap-5 @2xl:grid-cols-2 @2xl:gap-x-8 @4xl:flex @4xl:flex-col @4xl:items-stretch">
            <dl v-if="facts.length > 0" class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
              <template v-for="fact in facts" :key="fact.label">
                <dt class="text-muted-foreground">{{ fact.label }}</dt>
                <dd class="text-right font-medium wrap-anywhere selectable">
                  {{ fact.value }}
                  <span v-if="!full && fact.check?.state === 'matches'" class="text-success" :data-tooltip="fact.check.text">
                    <Check class="inline size-3.5 align-[-2px]" />
                  </span>
                </dd>
                <dd
                  v-if="fact.check && showsCheck(fact.check.state)"
                  class="col-span-2 -mt-1 text-right text-xs"
                  :class="CHECK_TONES[fact.check.state]"
                >
                  {{ fact.check.text }}
                </dd>
              </template>
            </dl>

            <div v-if="mods.length > 0 || (full && current.lobbyFeatures)" class="flex flex-col gap-5">
              <div v-if="mods.length > 0" class="flex flex-col gap-1.5">
                <h3 class="font-sans text-xs font-normal text-muted-foreground">
                  {{ t('currentGame.mods') }} <span class="tabular-nums">{{ mods.length }}</span>
                </h3>
                <ul class="flex flex-col gap-1.5 text-[13px] leading-snug">
                  <li v-for="mod in mods" :key="mod.uid">
                    <span class="selectable">{{ mod.name }}</span>
                    <span v-if="mod.state && showsCheck(mod.state)" class="block text-xs" :class="CHECK_TONES[mod.state]">
                      {{ t(`currentGame.checks.${mod.state}`) }}
                    </span>
                  </li>
                </ul>
              </div>

              <div v-if="full && current.lobbyFeatures" class="flex flex-col gap-1.5">
                <h3 class="font-sans text-xs font-normal text-muted-foreground">{{ t('currentGame.lobbyFeatures.title') }}</h3>
                <p class="text-[13px]" :class="{ 'text-muted-foreground': current.lobbyFeatures.length === 0 }">
                  {{ current.lobbyFeatures.length > 0 ? current.lobbyFeatures.join(', ') : t('currentGame.lobbyFeatures.none') }}
                </p>
              </div>
            </div>
          </div>
        </aside>

        <div class="flex min-w-0 flex-col gap-5">
          <Alert v-if="problems.length > 0" :variant="problems.some((problem) => problem.severe) ? 'destructive' : 'warning'">
            <TriangleAlert />
            <AlertDescription class="flex flex-col gap-1 text-foreground/80">
              <p v-for="problem in problems" :key="problem.key" class="selectable" :data-tooltip="full ? undefined : (problem.detail ?? undefined)">
                <span class="font-semibold" :class="problem.severe ? 'text-destructive' : 'text-warning'">{{ problem.text }}</span>
                <span v-if="!full && problem.hint" class="ml-1 text-muted-foreground">{{ problem.hint }}</span>
                <span v-if="full && problem.detail" class="block text-muted-foreground">{{ problem.detail }}</span>
              </p>
            </AlertDescription>
          </Alert>

          <section v-if="state.kind === 'online'" class="flex flex-col gap-2">
            <div class="flex items-baseline gap-3">
              <h2 class="text-lg">{{ t('currentGame.players.title') }}</h2>
              <span class="text-sm text-muted-foreground tabular-nums">
                {{ t('currentGame.players.connected', { connected, total: state.peers.length }) }}
              </span>
            </div>
            <p v-if="teams.length === 0" class="text-sm text-muted-foreground">{{ t('currentGame.players.waiting') }}</p>
            <p v-if="full && hostWithoutFiles" class="text-sm text-muted-foreground">
              {{ t('currentGame.hostFilesUnknown', { host: hostWithoutFiles }) }}
            </p>

            <table v-if="teams.length > 0" class="w-full border-collapse text-sm">
              <thead>
                <tr class="text-left text-xs text-muted-foreground *:px-2 *:pb-1 *:font-normal *:whitespace-nowrap">
                  <th>{{ t('currentGame.players.columns.player') }}</th>
                  <template v-if="full">
                    <th>{{ t('currentGame.players.columns.connection') }}</th>
                    <th class="text-right">{{ t('currentGame.players.columns.ping') }}</th>
                    <th class="text-right" :data-tooltip="t('currentGame.players.lossHint')">{{ t('currentGame.players.columns.loss') }}</th>
                    <th
                      v-for="part in PARTS"
                      :key="part"
                      class="w-12 text-center"
                      :class="{ 'border-l': part === 'gameFiles' }"
                      :data-tooltip="t('currentGame.players.filesHint')"
                    >
                      {{ t(`currentGame.parts.${part}`) }}
                    </th>
                  </template>
                  <template v-else>
                    <th>{{ t('currentGame.players.columns.link') }}</th>
                    <th class="w-16 text-center" :data-tooltip="t('currentGame.players.filesHint')">
                      {{ t('currentGame.players.columns.files') }}
                    </th>
                  </template>
                </tr>
              </thead>
              <tbody v-for="team in teams" :key="team.team">
                <tr>
                  <td :colspan="columnCount" class="px-2 pt-3 pb-1 text-xs text-muted-foreground">
                    {{ team.team === UNPLACED_TEAM ? t('currentGame.players.unplaced') : teamLabel(team.team) }}
                  </td>
                </tr>
                <template v-for="player in team.players" :key="player.key">
                  <tr class="border-t">
                    <td class="w-full max-w-0 px-2 py-2" :class="{ 'shadow-[inset_3px_0_0_var(--color-info)]': player.self }">
                      <div class="flex min-w-0 items-center gap-2">
                        <CountryFlag :country="player.country" />
                        <span class="truncate font-medium selectable" :data-tooltip="player.login">
                          <span v-if="player.clan" class="mr-1 text-primary">[{{ player.clan }}]</span>{{ player.login }}
                        </span>
                        <span v-if="player.rating !== null" class="shrink-0 text-muted-foreground tabular-nums">{{ player.rating }}</span>
                        <span v-if="player.self" class="shrink-0 text-xs text-info">{{ t('currentGame.players.self') }}</span>
                        <img
                          v-else-if="player.peer?.tfaf"
                          :src="logoUrl"
                          :alt="t('currentGame.players.viaTfaf')"
                          :data-tooltip="t('currentGame.players.viaTfaf')"
                          class="size-4 shrink-0"
                          draggable="false"
                        />
                      </div>
                    </td>

                    <template v-if="full">
                      <td class="px-2 py-2 whitespace-nowrap">
                        <span v-if="player.peer" class="flex items-center gap-2" :class="connectionTone(player.peer)">
                          <span class="size-1.5 shrink-0 rounded-full" :class="connectionDot(player.peer)" />
                          {{ connectionLabel(player.peer) }}
                        </span>
                        <span v-else-if="!player.self" class="text-xs text-muted-foreground">{{ t('currentGame.players.noAdapter') }}</span>
                      </td>
                      <td class="px-2 py-2 text-right whitespace-nowrap tabular-nums">
                        <template v-if="player.peer">
                          <template v-if="player.peer.rttMs !== null">
                            {{ t('currentGame.players.pingValue', { ms: player.peer.rttMs }) }}
                          </template>
                          <span v-else class="text-faint">—</span>
                        </template>
                      </td>
                      <td class="px-2 py-2 text-right whitespace-nowrap tabular-nums" :class="player.peer ? lossTone(player.peer) : ''">
                        <template v-if="player.peer">
                          {{ player.peer.loss ? t('currentGame.players.lossValue', { out: player.peer.loss.out, in: player.peer.loss.in }) : '—' }}
                          <span
                            v-if="player.peer.duplication"
                            class="ml-1 rounded-sm border border-warning/50 px-1 text-[11px] text-warning"
                            :data-tooltip="t('currentGame.players.duplicationHint')"
                          >
                            {{ t('currentGame.players.duplicationMark') }}
                          </span>
                        </template>
                      </td>
                      <td
                        v-if="player.host"
                        :colspan="PARTS.length"
                        class="border-l px-2 py-2 text-center text-xs text-muted-foreground"
                        :data-tooltip="t('currentGame.players.hostHint')"
                      >
                        {{ t('currentGame.players.host') }}
                      </td>
                      <template v-else-if="player.known">
                        <td
                          v-for="part in PARTS"
                          :key="part"
                          class="px-1 py-2"
                          :class="{ 'border-l': part === 'gameFiles' }"
                          :data-tooltip="filesTitle(player)"
                        >
                          <span class="flex justify-center" :class="MARKS[player.known[part]].tone">
                            <component :is="MARKS[player.known[part]].icon" class="size-4" />
                            <span class="sr-only">{{ t(`currentGame.comparison.${player.known[part]}`) }}</span>
                          </span>
                        </td>
                      </template>
                      <td
                        v-else
                        :colspan="PARTS.length"
                        class="border-l px-2 py-2 text-center text-xs whitespace-nowrap text-muted-foreground"
                        :data-tooltip="showsFiles(player) ? filesTitle(player) : undefined"
                      >
                        <template v-if="showsFiles(player)">{{ t(`currentGame.noFingerprintsShort.${missingFiles(player)}`) }}</template>
                      </td>
                    </template>

                    <template v-else>
                      <td class="px-2 py-2 whitespace-nowrap">
                        <span v-if="player.peer" class="flex items-center gap-2" :data-tooltip="connectionTitle(player.peer)">
                          <span class="size-1.5 shrink-0 rounded-full" :class="connectionDot(player.peer)" />
                          <template v-if="player.peer.state === 'connected' && player.peer.rttMs !== null">
                            <span class="tabular-nums">{{ t('currentGame.players.pingValue', { ms: player.peer.rttMs }) }}</span>
                            <span v-if="player.peer.route === 'relay'" class="text-xs text-muted-foreground">
                              {{ t('currentGame.players.relay') }}
                            </span>
                          </template>
                          <span v-else :class="connectionTone(player.peer)">{{ connectionLabel(player.peer) }}</span>
                          <span v-if="noticeableLoss(player.peer)" class="text-xs tabular-nums" :class="lossTone(player.peer)">
                            {{ t('currentGame.players.loss', { out: player.peer.loss?.out ?? 0, in: player.peer.loss?.in ?? 0 }) }}
                          </span>
                        </span>
                        <span v-else-if="!player.self" class="text-xs text-muted-foreground">{{ t('currentGame.players.noAdapter') }}</span>
                      </td>
                      <td
                        class="px-2 py-2 text-center whitespace-nowrap"
                        :data-tooltip="player.host ? t('currentGame.players.hostHint') : showsFiles(player) ? filesTitle(player) : undefined"
                      >
                        <span v-if="player.host" class="text-xs text-muted-foreground">{{ t('currentGame.players.host') }}</span>
                        <span v-else-if="showsFiles(player)" class="flex justify-center" :class="MARKS[filesSummary(player)].tone">
                          <component :is="MARKS[filesSummary(player)].icon" class="size-4" />
                          <span class="sr-only">{{ t(`currentGame.comparison.${filesSummary(player)}`) }}</span>
                        </span>
                      </td>
                    </template>
                  </tr>
                  <tr v-if="player.differs.length > 0 || player.lacks.length > 0">
                    <td :colspan="columnCount" class="px-2 pb-2 pl-8 text-xs">
                      <p v-if="player.differs.length > 0" class="text-destructive selectable">{{ player.differs.join(', ') }}</p>
                      <p v-if="player.lacks.length > 0" class="text-warning" :data-tooltip="t('currentGame.featureIssues.detail')">
                        {{ t('currentGame.featureIssues.row', { features: quotedList(player.lacks) }) }}
                      </p>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
            <p v-if="full && teams.length > 0" class="text-xs text-muted-foreground">{{ t('currentGame.players.legend') }}</p>
          </section>
          <p v-else class="text-sm text-muted-foreground">
            {{ state.kind === 'replay' ? t('currentGame.replaySolo') : t('currentGame.offlineSolo') }}
          </p>
        </div>
      </div>
    </template>
  </section>
</template>
