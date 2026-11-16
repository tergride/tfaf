<script setup lang="ts">
import { Ban, Bookmark, CircleCheck, Eye, FileCheck, Map as MapIcon, Pencil, Puzzle, RotateCcw, Send, SlidersHorizontal, X } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { LOBBY_LIMITS, LOCKED_LOBBY_OPTIONS, type LobbyResetPart } from '../../../../shared/contract.ts';
import { confirmAction } from '../../composables/useConfirm.ts';
import { useLobbyCatalog } from '../../composables/useLobbyCatalog.ts';
import { useMapView } from '../../composables/useMapView.ts';
import { useTfafLobby } from '../../composables/useTfafLobby.ts';
import { t } from '../../lib/i18n.ts';
import { queries } from '../../lib/queries.ts';
import CountryFlag from '../CountryFlag.vue';
import MapViewButton from '../MapViewButton.vue';
import PreviewImage from '../PreviewImage.vue';
import ProgressLine from '../ProgressLine.vue';
import LobbyBoard from './LobbyBoard.vue';
import LobbyChat from './LobbyChat.vue';
import LobbyHostTools from './LobbyHostTools.vue';
import LobbyMapDialog from './LobbyMapDialog.vue';
import LobbyModsDialog from './LobbyModsDialog.vue';
import LobbyOptionsDialog from './LobbyOptionsDialog.vue';
import LobbyPresetsDialog from './LobbyPresetsDialog.vue';
import LobbySlotRow from './LobbySlotRow.vue';
import LobbySpawnMarkers from './LobbySpawnMarkers.vue';
import LobbyStartBar from './LobbyStartBar.vue';
import LobbyTextDialog from './LobbyTextDialog.vue';
import LobbyUnitsDialog from './LobbyUnitsDialog.vue';
import { ROSTER_GRID } from './rosterGrid.ts';

const GameInviteDialog = defineAsyncComponent(() => import('../GameInviteDialog.vue'));

const { state, view, room, hosting, selfId, members, peers, starting, spotLocked, heldByReady, hoveredSpot, act, run } = useTfafLobby();
const { query: catalogQuery, catalog, colors, ais, restrictionPresets } = useLobbyCatalog();
const mapView = useMapView();
const featuredModsQuery = useQuery(queries.featuredMods());
// Plain FAF goes without saying; another featured mod is named as the server names it.
const featuredModName = computed(() => {
  const name = room.value?.featuredMod;
  if (!name || name === 'faf') {
    return null;
  }
  return featuredModsQuery.data.value?.find((mod) => mod.technicalName === name)?.displayName ?? name;
});

const choosingMap = ref(false);
const choosingMods = ref(false);
const showingOptions = ref(false);
const showingUnits = ref(false);
const choosingUiMods = ref(false);
const showingPresets = ref(false);
const editingTitle = ref(false);
const editingRules = ref(false);
const inviting = ref(false);
const GAME_TITLE = /^[\x20-\x7e]+$/;

/** The big map shows this room's positions, so it goes when they stop being true. */
function closeRoomMap(): void {
  if (mapView.current.value?.spawnLayer === LobbySpawnMarkers) {
    mapView.close();
  }
}
watch([() => room.value?.map.folderName, starting], closeRoomMap);
onBeforeUnmount(closeRoomMap);

const observers = computed(() => (room.value?.observers ?? []).map((id) => members.value.get(id)).filter((member) => member !== undefined));
const isObserver = computed(() => selfId.value !== null && room.value?.observers.includes(selfId.value) === true);
const differing = computed(() => {
  const files = state.value.files?.players ?? [];
  return new Set(files.filter((player) => player.gameFiles === 'different' || player.map === 'different' || player.mods === 'different').map((player) => player.playerId));
});

/** The options the host moved away from the defaults, by their names in the game. */
const changedOptions = computed(() => {
  const options = room.value?.options ?? {};
  return (catalog.value?.groups ?? []).flatMap((group) =>
    group.options.flatMap((option) => {
      const value = options[option.key];
      const choice = value === undefined || value === option.defaultValue ? null : option.choices.find((candidate) => candidate.value === value);
      return choice ? [{ key: option.key, label: option.label, value: choice.label }] : [];
    }),
  );
});

const editable = computed(() => hosting.value && !starting.value);
const quality = computed(() => (view.value?.quality == null ? null : Math.round(view.value.quality * 100)));

function pingOf(id: number): string | null {
  const rttMs = peers.value.get(id)?.rttMs ?? null;
  return id === selfId.value || rttMs === null ? null : t('tfafLobby.roster.pingValue', { ms: rttMs });
}

const restrictedPresets = computed(() => restrictionPresets.value.filter((preset) => room.value?.restrictions.includes(preset.key)));
const restrictedUnits = computed(() => (room.value?.restrictions.length ?? 0) - restrictedPresets.value.length);

// The room's mods are downloaded into the mods folder, so their icons appear once the files are ready.
const installedModsQuery = useQuery(queries.installedMods());
const modIcons = computed(() => new Map((installedModsQuery.data.value ?? []).map((mod) => [mod.uid, mod.iconDataUrl])));

const optionsChanged = computed(() => Object.keys(room.value?.options ?? {}).some((key) => !Object.hasOwn(LOCKED_LOBBY_OPTIONS, key)));

async function reset(part: LobbyResetPart): Promise<void> {
  const options = part === 'options';
  const confirmed = await confirmAction({
    title: options ? t('tfafLobby.options.resetOnlyTitle') : t('tfafLobby.units.resetTitle'),
    description: options ? t('tfafLobby.options.resetOnlyDescription') : t('tfafLobby.units.resetDescription'),
    confirmText: options ? t('tfafLobby.options.reset') : t('tfafLobby.units.reset'),
    destructive: true,
  });
  if (confirmed) {
    void act({ type: 'resetOptions', part });
  }
}

async function leave(): Promise<void> {
  const confirmed = await confirmAction({
    title: t('tfafLobby.leaveTitle'),
    description: hosting.value ? t('tfafLobby.leaveHostWarning') : t('tfafLobby.leavePlayerWarning'),
    confirmText: t('tfafLobby.leave'),
    destructive: true,
  });
  if (confirmed) {
    await run(() => window.tfaf.game.kill());
  }
}
</script>

<template>
  <div v-if="!room" class="grid min-h-full place-items-center">
    <span class="flex items-center gap-3 text-muted-foreground"><Spinner class="text-primary" />{{ t('tfafLobby.waitingForRoom') }}</span>
  </div>
  <!-- A narrow page stacks the map over the roster: the two side by side need 63.25rem. -->
  <div v-else class="@container h-full">
    <section class="flex min-h-[44rem] flex-col gap-4 px-6 pt-5 pb-5 @[63.25rem]:h-full">
      <header class="flex items-center gap-3">
        <h1 class="min-w-0 truncate text-2xl selectable">{{ room.title }}</h1>
        <Button v-if="editable" variant="ghost" size="icon-xs" :aria-label="t('tfafLobby.title.change')" :data-tooltip="t('tfafLobby.title.change')" @click="editingTitle = true"><Pencil /></Button>
        <Badge v-if="featuredModName" variant="accent">{{ featuredModName }}</Badge>
        <Badge variant="accent">{{ t('tfafLobby.badges.tfafOnly') }}</Badge>
        <Badge variant="muted">{{ t('tfafLobby.badges.unrated') }}</Badge>
        <Badge variant="warning" :data-tooltip="t('tfafLobby.badges.experimentalHint')">{{ t('tfafLobby.badges.experimental') }}</Badge>
        <Badge v-if="quality !== null" variant="muted">{{ t('tfafLobby.quality', { percent: quality }) }}</Badge>
        <Button v-if="!starting" variant="ghost" size="sm" class="ml-auto" @click="inviting = true"><Send />{{ t('games.inviteDialog.open') }}</Button>
        <Button variant="ghost" size="sm" :class="starting && 'ml-auto'" @click="leave"><X />{{ t('tfafLobby.leave') }}</Button>
      </header>

      <div v-if="room.rules || editable" class="-mt-2 flex min-w-0 items-center gap-1.5 text-sm">
        <span class="min-w-0 truncate selectable" :class="room.rules ? 'text-muted-foreground' : 'text-faint'" :data-tooltip="room.rules || undefined">
          {{ room.rules ? t('tfafLobby.rules.line', { rules: room.rules }) : t('tfafLobby.rules.none') }}
        </span>
        <Button v-if="editable" variant="ghost" size="icon-xs" :aria-label="t('tfafLobby.rules.change')" :data-tooltip="t('tfafLobby.rules.change')" @click="editingRules = true"><Pencil /></Button>
      </div>

      <div class="grid min-h-0 flex-1 gap-5 @[63.25rem]:grid-cols-[minmax(19rem,27rem)_minmax(40rem,1fr)]">
        <aside
          class="grid grid-cols-[minmax(0,20rem)_minmax(0,1fr)] gap-4 @[63.25rem]:flex @[63.25rem]:min-h-0 @[63.25rem]:flex-col @[63.25rem]:gap-3 @[63.25rem]:overflow-y-auto @[63.25rem]:pr-1"
        >
          <div class="flex flex-col gap-3">
            <LobbyBoard />
            <div class="flex gap-2">
              <MapViewButton class="flex-1" :disabled="starting" :folder-name="room.map.folderName" :title="room.map.name" :spawn-layer="LobbySpawnMarkers" />
              <Button v-if="hosting" variant="outline" size="sm" class="flex-1" :disabled="starting" @click="choosingMap = true">
                <MapIcon />{{ t('tfafLobby.board.changeMap') }}
              </Button>
            </div>
          </div>

          <div class="flex min-w-0 flex-col gap-3">
            <Button v-if="hosting" variant="outline" size="sm" :disabled="starting" @click="showingPresets = true"><Bookmark />{{ t('tfafLobby.presets.open') }}</Button>

            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between gap-2">
                <h2 class="text-sm font-medium">{{ t('tfafLobby.mods.title') }}</h2>
                <Button v-if="hosting" variant="outline" size="sm" :disabled="starting || !catalog" @click="choosingMods = true"><Puzzle />{{ t('tfafLobby.mods.change') }}</Button>
                <Button v-else variant="outline" size="sm" :disabled="starting || !catalog" @click="choosingUiMods = true"><Puzzle />{{ t('tfafLobby.mods.changeUi') }}</Button>
              </div>
              <p v-if="room.simMods.length === 0" class="text-sm text-faint">{{ t('tfafLobby.mods.none') }}</p>
              <ul v-else class="flex flex-col gap-1.5 text-sm">
                <li v-for="mod in room.simMods" :key="mod.uid" class="flex min-w-0 items-center gap-2.5" :data-tooltip="mod.name">
                  <span class="plate cut-xs size-8 shrink-0 overflow-hidden bg-secondary [--plate-border:transparent]">
                    <PreviewImage small :src="modIcons.get(mod.uid)" :fallback="mod.name.slice(0, 1).toUpperCase()" />
                  </span>
                  <span class="min-w-0 truncate">{{ mod.name }}</span>
                </li>
              </ul>
            </div>

            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between gap-2">
                <h2 class="text-sm font-medium">{{ t('tfafLobby.options.title') }}</h2>
                <div class="flex gap-2">
                  <Button
                    v-if="hosting"
                    variant="outline"
                    size="icon-sm"
                    :disabled="starting || !optionsChanged"
                    :aria-label="t('tfafLobby.options.resetOnly')"
                    :data-tooltip="t('tfafLobby.options.resetOnly')"
                    @click="reset('options')"
                  >
                    <RotateCcw />
                  </Button>
                  <Button variant="outline" size="sm" :disabled="!catalog" @click="showingOptions = true"><SlidersHorizontal />{{ t('tfafLobby.options.open') }}</Button>
                </div>
              </div>
              <p v-if="catalogQuery.isLoading.value" class="text-sm text-faint">{{ t('tfafLobby.options.loading') }}</p>
              <p v-else-if="catalogQuery.error.value" class="text-sm text-warning">{{ t('tfafLobby.options.failed', { error: String(catalogQuery.error.value.message) }) }}</p>
              <p v-else-if="changedOptions.length === 0" class="text-sm text-faint">{{ t('tfafLobby.options.defaults') }}</p>
              <dl v-else class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
                <template v-for="option in changedOptions" :key="option.key">
                  <dt class="text-muted-foreground">{{ option.label }}</dt>
                  <dd class="truncate">{{ option.value }}</dd>
                </template>
              </dl>
            </div>

            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between gap-2">
                <h2 class="text-sm font-medium">{{ t('tfafLobby.units.title') }}</h2>
                <div class="flex gap-2">
                  <Button
                    v-if="hosting"
                    variant="outline"
                    size="icon-sm"
                    :disabled="starting || room.restrictions.length === 0"
                    :aria-label="t('tfafLobby.units.reset')"
                    :data-tooltip="t('tfafLobby.units.reset')"
                    @click="reset('restrictions')"
                  >
                    <RotateCcw />
                  </Button>
                  <Button variant="outline" size="sm" :disabled="!catalog" @click="showingUnits = true">
                    <Ban />{{ hosting && !starting ? t('tfafLobby.units.change') : t('tfafLobby.units.open') }}
                  </Button>
                </div>
              </div>
              <p v-if="room.restrictions.length === 0" class="text-sm text-faint">{{ t('tfafLobby.units.none') }}</p>
              <ul v-else class="flex flex-col gap-0.5 text-sm">
                <li v-for="preset in restrictedPresets" :key="preset.key" class="truncate" :data-tooltip="preset.help">{{ preset.name }}</li>
                <li v-if="restrictedUnits > 0" class="text-muted-foreground">{{ t('tfafLobby.units.single', { count: restrictedUnits }) }}</li>
              </ul>
            </div>
          </div>
        </aside>

        <div class="flex min-h-0 min-w-0 flex-col gap-4">
          <div class="plate cut-lg flex min-h-0 flex-[3] flex-col bg-card pb-2">
            <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              <div class="sticky top-0 z-10 h-8 border-b border-l-transparent bg-card text-xs text-faint" :class="ROSTER_GRID">
                <span class="col-span-2 col-start-2 flex items-center gap-2" role="status">
                  {{ t('tfafLobby.roster.title') }}
                  <span v-if="spotLocked" class="text-info">{{ t('tfafLobby.roster.changingSpot') }}</span>
                </span>
                <span class="text-right">{{ t('tfafLobby.roster.rating') }}</span>
                <span class="pr-1.5 text-right">{{ t('tfafLobby.roster.ping') }}</span>
                <span>{{ t('tfafLobby.roster.faction') }}</span>
                <span>{{ t('tfafLobby.roster.team') }}</span>
                <span class="flex items-center justify-center gap-2">
                  <span class="inline-flex" role="img" :data-tooltip="t('tfafLobby.roster.filesColumn')" :aria-label="t('tfafLobby.roster.filesColumn')"><FileCheck class="size-4" /></span>
                  <span class="inline-flex" role="img" :data-tooltip="t('tfafLobby.roster.readyColumn')" :aria-label="t('tfafLobby.roster.readyColumn')"><CircleCheck class="size-4" /></span>
                </span>
                <div v-if="spotLocked" class="absolute inset-x-0 bottom-0"><ProgressLine :value="null" /></div>
              </div>
              <ol>
                <LobbySlotRow
                  v-for="slot in room.slots"
                  :key="slot.spot"
                  :slot="slot"
                  :colors="colors"
                  :ais="ais"
                  :files-differ="slot.occupant?.kind === 'player' && differing.has(slot.occupant.playerId)"
                  :highlighted="hoveredSpot === slot.spot"
                  @hover="hoveredSpot = $event"
                />
              </ol>
            </div>
            <div class="flex items-center gap-2 border-t px-3 pt-2 text-sm">
              <Eye class="size-4 shrink-0 text-faint" />
              <span class="text-muted-foreground">{{ t('tfafLobby.roster.observers') }}</span>
              <span v-for="observer in observers" :key="observer.id" class="flex items-center gap-1">
                <CountryFlag :country="observer.country" />{{ observer.login }}
                <span v-if="pingOf(observer.id)" class="text-xs text-faint tabular-nums">{{ pingOf(observer.id) }}</span>
              </span>
              <div class="ml-auto flex gap-2">
                <LobbyHostTools v-if="editable" :ais="ais" />
                <Button v-if="!isObserver && !starting" variant="outline" size="sm" :disabled="spotLocked || heldByReady" @click="act({ type: 'observe' })">
                  <Eye />{{ t('tfafLobby.roster.observe') }}
                </Button>
              </div>
            </div>
          </div>
          <LobbyChat class="plate cut-lg min-h-40 flex-[2] bg-card p-3" />
          <LobbyStartBar />
        </div>
      </div>

      <LobbyMapDialog v-if="choosingMap" :folder-name="room.map.folderName" @close="choosingMap = false" />
      <LobbyModsDialog v-if="choosingMods && catalog" :mod-uids="room.simMods.map((mod) => mod.uid)" :banned="catalog.bannedMods" @close="choosingMods = false" />
      <LobbyModsDialog v-if="choosingUiMods && catalog" :mod-uids="[]" :banned="catalog.bannedMods" ui-only @close="choosingUiMods = false" />
      <LobbyPresetsDialog v-if="showingPresets" @close="showingPresets = false" />
      <GameInviteDialog v-if="inviting" @close="inviting = false" />
      <LobbyTextDialog
        v-if="editingTitle"
        :heading="t('tfafLobby.title.dialogTitle')"
        :label="t('tfafLobby.title.label')"
        :initial="room.title"
        :max-length="LOBBY_LIMITS.maxTitleLength"
        :pattern="GAME_TITLE"
        :invalid-text="t('tfafLobby.title.asciiOnly')"
        :confirm-text="t('tfafLobby.title.apply')"
        required
        @confirm="(title) => act({ type: 'setTitle', title })"
        @close="editingTitle = false"
      />
      <LobbyTextDialog
        v-if="editingRules"
        :heading="t('tfafLobby.rules.dialogTitle')"
        :description="t('tfafLobby.rules.dialogDescription')"
        :label="t('tfafLobby.rules.label')"
        :initial="room.rules"
        :max-length="LOBBY_LIMITS.maxRulesLength"
        multiline
        :confirm-text="t('tfafLobby.rules.apply')"
        @confirm="(rules) => act({ type: 'setRules', rules })"
        @close="editingRules = false"
      />
      <LobbyOptionsDialog v-if="showingOptions && catalog" :catalog="catalog" @close="showingOptions = false" />
      <LobbyUnitsDialog v-if="showingUnits && catalog" :presets="restrictionPresets" @close="showingUnits = false" />
    </section>
  </div>
</template>
