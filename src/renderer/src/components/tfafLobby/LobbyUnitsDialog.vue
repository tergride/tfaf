<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { computed, type DeepReadonly, ref, shallowRef } from 'vue';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { LobbyPresetGroup, LobbyRestrictionPreset, LobbyUnit } from '../../../../shared/contract.ts';
// The game's own vector emblems, as in the roster.
import aeonIcon from '../../assets/factions/aeon.svg';
import cybranIcon from '../../assets/factions/cybran.svg';
import seraphimIcon from '../../assets/factions/seraphim.svg';
import uefIcon from '../../assets/factions/uef.svg';
import { useDeferredClose } from '../../composables/useDeferredClose.ts';
import { useRoomFactions } from '../../composables/useRoomFactions.ts';
import { useTfafLobby } from '../../composables/useTfafLobby.ts';
import { useStoredMode } from '../../composables/useViewMode.ts';
import { errorMessage } from '../../format.ts';
import { t } from '../../lib/i18n.ts';
import {
  forbiddenUnits,
  joinRestrictions,
  type RestrictionChoice,
  splitRestrictions,
  togglePreset,
  toggleUnit,
  UNIT_GROUPINGS,
  unitSections,
} from '../../lib/unitRestrictions.ts';
import SearchInput from '../SearchInput.vue';
import LobbyRestrictionCell from './LobbyRestrictionCell.vue';

// The factions of the game's Unit Manager with its colours (UnitsAnalyzer.Factions); what a mod adds follows them.
const FACTIONS: Record<string, { label: 'uef' | 'aeon' | 'cybran' | 'seraphim'; icon: string; color: string }> = {
  UEF: { label: 'uef', icon: uefIcon, color: '#006cd9' },
  AEON: { label: 'aeon', icon: aeonIcon, color: '#238c00' },
  CYBRAN: { label: 'cybran', icon: cybranIcon, color: '#b32d00' },
  SERAPHIM: { label: 'seraphim', icon: seraphimIcon, color: '#ffbf00' },
};
const OTHER_FACTION_COLOR = '#ff7200';

const props = defineProps<{ presets: readonly LobbyRestrictionPreset[] }>();
const emit = defineEmits<{ close: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));
const { room, hosting, starting, act } = useTfafLobby();
const roomFactions = useRoomFactions();

const unitsQuery = useQuery(() => ({
  queryKey: ['tfafLobby', 'units', room.value?.simMods.map((mod) => mod.uid).join(' ') ?? ''],
  queryFn: () => window.tfaf.tfafLobby.units(),
}));
const catalog = computed(() => unitsQuery.data.value ?? null);
const covers = computed(() => catalog.value?.covers ?? {});
const units = computed((): readonly DeepReadonly<LobbyUnit>[] => catalog.value?.units ?? []);

const editable = computed(() => hosting.value && !starting.value);
const presetKeys = computed(() => new Set(props.presets.map((preset) => preset.key)));
const draft = shallowRef<RestrictionChoice | null>(null);
const choice = computed(() => draft.value ?? splitRestrictions(room.value?.restrictions ?? [], presetKeys.value));
const forbidden = computed(() => forbiddenUnits(choice.value, covers.value));
const hoveredPreset = ref<string | null>(null);
const previewed = computed(() => new Set(hoveredPreset.value ? (covers.value[hoveredPreset.value] ?? []) : []));

const grouping = useStoredMode('tfaf.tfafLobby.unitGrouping', UNIT_GROUPINGS, 'type');
const search = ref('');
const query = computed(() => search.value.trim().toLocaleLowerCase());
const matches = (...texts: string[]): boolean => texts.some((text) => text.toLocaleLowerCase().includes(query.value));

const factions = computed(() => {
  const present = new Set(units.value.map((unit) => unit.faction));
  return [...Object.keys(FACTIONS).filter((faction) => present.has(faction)), ...[...present].filter((faction) => !FACTIONS[faction])];
});
const chosenFaction = ref<string | null>(null);
const faction = computed({
  get: () => chosenFaction.value ?? factions.value[0] ?? '',
  set: (value: string) => {
    chosenFaction.value = value;
  },
});

const presetSections = computed(() => {
  const sections = new Map<LobbyPresetGroup, LobbyRestrictionPreset[]>();
  for (const preset of props.presets) {
    if (matches(preset.name, preset.help)) {
      sections.set(preset.group, [...(sections.get(preset.group) ?? []), preset]);
    }
  }
  return [...sections].map(([group, presets]) => ({ group, presets }));
});

/** A search looks through every faction; otherwise the tab shows its own. */
const sections = computed(() =>
  unitSections(
    units.value.filter((unit) => (query.value ? matches(unit.name, unit.description, unit.id) : unit.faction === faction.value)),
    grouping.value,
  ),
);

function tierName(tier: LobbyUnit['tech']): string {
  return t(`tfafLobby.units.tiers.${tier ?? 'none'}`);
}

function countIn(faction: string, ids: ReadonlySet<string>): number {
  return new Set(units.value.filter((unit) => unit.faction === faction && ids.has(unit.id)).map((unit) => unit.id)).size;
}

function factionLabel(name: string): string {
  const known = FACTIONS[name];
  return known ? t(`tfafLobby.factions.${known.label}`) : (roomFactions.byKey(name)?.name ?? name);
}

/** A faction of a featured mod or a mod has the emblem of its game files, when it has one. */
function factionIcon(name: string): string | null {
  return FACTIONS[name]?.icon ?? roomFactions.byKey(name)?.icon ?? null;
}

function unitColor(unit: DeepReadonly<LobbyUnit>): string | null {
  return unit.upgrade ? null : (FACTIONS[unit.faction]?.color ?? OTHER_FACTION_COLOR);
}

function unitHint(unit: DeepReadonly<LobbyUnit>): string {
  const name = unit.tech ? `${unit.tech} ${unit.name}` : unit.name;
  return unit.description && unit.description !== unit.name ? `${name}: ${unit.description}` : name;
}

function apply(): void {
  void act({ type: 'setRestrictions', restrictions: joinRestrictions(choice.value, covers.value, new Set(units.value.map((unit) => unit.id))) });
  close();
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && close()">
    <DialogContent class="flex h-[85vh] flex-col gap-4 sm:max-w-5xl" @close-auto-focus="onContentClosed">
      <DialogHeader>
        <DialogTitle class="font-display text-lg">{{ t('tfafLobby.units.title') }}</DialogTitle>
        <DialogDescription>{{ editable ? t('tfafLobby.units.dialogDescriptionHost') : t('tfafLobby.units.dialogDescriptionPlayer') }}</DialogDescription>
      </DialogHeader>

      <div class="flex items-center gap-4">
        <SearchInput v-model="search" class="min-w-0 flex-1" :placeholder="t('tfafLobby.units.search')" />
        <div class="plate cut-sm flex shrink-0 gap-0.5 bg-secondary p-0.75" role="group" :aria-label="t('tfafLobby.units.grouping.label')">
          <button
            v-for="option in UNIT_GROUPINGS"
            :key="option"
            type="button"
            class="plate plate-focus cut-xs h-6.5 px-2.5 text-sm font-medium transition-colors [--plate-border:transparent]"
            :class="grouping === option ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-foreground'"
            :aria-pressed="grouping === option"
            @click="grouping = option"
          >
            {{ t(`tfafLobby.units.grouping.${option}`) }}
          </button>
        </div>
        <span class="shrink-0 text-sm text-muted-foreground tabular-nums" role="status">{{ t('tfafLobby.units.summary', { count: forbidden.size }) }}</span>
      </div>

      <div v-if="unitsQuery.isLoading.value" class="grid min-h-0 flex-1 place-items-center">
        <span class="flex items-center gap-3 text-muted-foreground"><Spinner class="text-primary" />{{ t('tfafLobby.units.loading') }}</span>
      </div>
      <p v-else-if="unitsQuery.error.value" class="min-h-0 flex-1 text-sm text-destructive selectable">
        {{ t('tfafLobby.units.failed', { error: errorMessage(unitsQuery.error.value) }) }}
      </p>
      <div v-else class="grid min-h-0 flex-1 gap-5 grid-cols-[17.75rem_minmax(0,1fr)]">
        <section class="flex min-h-0 flex-col gap-2">
          <h3 class="text-sm text-muted-foreground">{{ t('tfafLobby.units.presets') }}</h3>
          <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-2">
            <div v-for="section in presetSections" :key="section.group" class="flex flex-col gap-1.5">
              <h4 class="text-xs text-faint">{{ t(`tfafLobby.units.presetGroups.${section.group}`) }}</h4>
              <div class="flex flex-wrap gap-1">
                <LobbyRestrictionCell
                  v-for="preset in section.presets"
                  :key="preset.key"
                  :texture="catalog?.presetIcons[preset.key] ?? null"
                  :label="preset.name"
                  :hint="`${preset.name}: ${preset.help}`"
                  :forbidden="choice.presets.has(preset.key)"
                  :readonly="!editable"
                  @toggle="draft = togglePreset(choice, preset.key)"
                  @mouseenter="hoveredPreset = preset.key"
                  @mouseleave="hoveredPreset = null"
                  @focus="hoveredPreset = preset.key"
                  @blur="hoveredPreset = null"
                />
              </div>
            </div>
          </div>
        </section>

        <section class="flex min-h-0 min-w-0 flex-col gap-3">
          <Tabs v-if="!query" v-model="faction">
            <TabsList class="w-full">
              <TabsTrigger v-for="name in factions" :key="name" :value="name">
                <img v-if="factionIcon(name)" :src="factionIcon(name)!" alt="" class="size-5" draggable="false" />
                {{ factionLabel(name) }}
                <span v-if="hoveredPreset" class="text-primary tabular-nums">{{ countIn(name, previewed) }}</span>
                <span v-else-if="countIn(name, forbidden) > 0" class="text-destructive tabular-nums">{{ countIn(name, forbidden) }}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-2">
            <p v-if="sections.length === 0" class="text-sm text-muted-foreground">{{ t('tfafLobby.units.nothingFound') }}</p>
            <section v-for="section in sections" :key="section.key" class="flex flex-col gap-1.5">
              <h4 class="text-xs text-faint">{{ section.group ? t(`tfafLobby.units.groups.${section.group}`) : tierName(section.tier) }}</h4>
              <div v-for="row in section.rows" :key="String(row.tier)" class="flex gap-2">
                <span v-if="grouping === 'both'" class="w-16 shrink-0 pt-0.5 text-xs text-faint">{{ tierName(row.tier) }}</span>
                <div class="flex min-w-0 flex-wrap gap-1">
                  <LobbyRestrictionCell
                    v-for="unit in row.units"
                    :key="`${unit.faction} ${unit.group} ${unit.id}`"
                    :texture="unit.icon"
                    :label="unit.name"
                    :hint="unitHint(unit)"
                    :forbidden="forbidden.has(unit.id)"
                    :readonly="!editable"
                    :tech="unit.tech"
                    :modded="unit.modded"
                    :color="unitColor(unit)"
                    :highlighted="previewed.has(unit.id)"
                    :dimmed="hoveredPreset !== null && !previewed.has(unit.id)"
                    @toggle="draft = toggleUnit(choice, unit.id, covers)"
                  />
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>

      <div class="flex items-center gap-2">
        <Button v-if="editable" variant="ghost" :disabled="forbidden.size === 0" @click="draft = { presets: new Set(), units: new Set() }">{{ t('tfafLobby.units.reset') }}</Button>
        <Button variant="ghost" class="ml-auto" @click="close">{{ editable ? t('common.cancel') : t('common.close') }}</Button>
        <Button v-if="editable" :disabled="!draft" @click="apply">{{ t('tfafLobby.units.apply') }}</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
