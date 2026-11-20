<script setup lang="ts">
import { RefreshCw } from '@lucide/vue';
import { computed, provide, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { STONEMAP_PRESENTATION_LIMITS } from '../../../../shared/contract.ts';
import type {
  BiomeLayout,
  MountainStructure,
  NavigationProfile,
  ReliefProfile,
  ResourceDistribution,
  ShorelineStyle,
  SpawnIslandMode,
  SymmetryPattern,
  TerrainDetailMode,
  TopologyKind,
} from '../../../../shared/stoneMap/contracts.ts';
import {
  canUseBridges,
  DECORATION_LAYOUTS,
  DECORATION_SYMMETRIES,
  defaultSunAzimuth,
  hasAllies,
  hasCoast,
  lakeKind,
  parameterRange,
  RANDOM_FREE_ISLANDS,
  randomSeed,
  RELIEF_PROFILES,
  selectExplicitResources,
  selectPattern,
  selectSpawnIslandMode,
  selectTopology,
  spawnIslandModeAllowed,
  splitIslands,
  SPAWN_ISLAND_MODES,
  type StoneMapForm,
  SYMMETRY_PATTERNS,
  TOPOLOGY_KINDS,
  waterMaximum,
} from '../../../../shared/stoneMap/form.ts';
import { useStoneMap } from '../../composables/useStoneMap.ts';
import { t } from '../../lib/i18n.ts';
import {
  biomeLabel,
  distributionLabel,
  islandModeLabel,
  layoutLabel,
  mapSizeLabel,
  mountainLabel,
  navigationLabel,
  patternHint,
  patternLabel,
  propStyleLabel,
  reliefProfileLabel,
  shoreLabel,
  terrainModeLabel,
  topologyLabel,
} from '../../lib/stoneMapLabels.ts';
import RandomToggle from './RandomToggle.vue';
import { RANDOM_CHOICE } from './randomChoice.ts';
import SmGroup from './SmGroup.vue';
import SmNumber from './SmNumber.vue';
import SmSelect, { type SmOption } from './SmSelect.vue';
import SmSlider from './SmSlider.vue';
import SmSwitch from './SmSwitch.vue';

defineProps<{ busy: boolean }>();
const emit = defineEmits<{ validate: []; generateByName: [mapName: string] }>();

const { formState, capabilities, state } = useStoneMap();
const form = computed(() => formState.value.form);
const random = computed(() => formState.value.random);
const mapName = ref('');

function toggle(path: string, enabled: boolean): void {
  const others = formState.value.random.filter((candidate) => candidate !== path);
  formState.value.random = enabled ? [...others, path] : others;
}
provide(RANDOM_CHOICE, { random, toggle });

const isRandom = (path: string): boolean => random.value.includes(path);

function set<K extends keyof StoneMapForm>(key: K, value: StoneMapForm[K]): void {
  formState.value.form = { ...formState.value.form, [key]: value };
}

function apply(next: StoneMapForm): void {
  formState.value.form = next;
}

const options = <V extends string | number>(values: readonly V[], label: (value: V) => string = String): SmOption<V>[] =>
  values.map((value) => ({ value, label: label(value) }));
const range = (path: string, fallback: { minimum: number; maximum: number }): { minimum: number; maximum: number } =>
  parameterRange(path) ?? fallback;

const coast = computed(() => hasCoast(form.value));
const allies = computed(() => hasAllies(form.value));
const lake = computed(() => lakeKind(form.value.kind));
const canBridge = computed(() => canUseBridges(form.value.kind, form.value.spawnIslandMode, form.value.numTeams));
const realism = computed(() => form.value.terrainMode === 'REALISM');
const water = computed(() => (form.value.kind === 'LAND' ? 0 : form.value.water));
const explicitResources = computed(() => form.value.resourceExplicit || isRandom('resourcePlacement.enabled'));
const spawnStep = computed(() =>
  form.value.pattern === 'QUADRANTS' ? 4 : form.value.pattern === 'CLASSIC' || form.value.pattern === 'ASYMMETRIC' ? 1 : 2,
);
const spawnRange = computed(() => range('spawnCount', { minimum: 2, maximum: 16 }));
const maxDistance = computed(() => Math.round(form.value.mapSize * Math.SQRT2));
const islandModes = computed(() =>
  SPAWN_ISLAND_MODES.map((mode) => ({ value: mode, label: islandModeLabel(mode), disabled: !spawnIslandModeAllowed(form.value, mode) })),
);
const freeIslandOptions = computed<SmOption<number>[]>(() => [
  { value: RANDOM_FREE_ISLANDS, label: t('stoneMap.settings.freeIslandsRandom') },
  ...Array.from({ length: 9 }, (_, count) => ({
    value: count,
    label:
      count > 0 ? String(count) : form.value.kind === 'CALDERA' ? t('stoneMap.settings.freeIslandsCaldera') : t('stoneMap.settings.freeIslandsNone'),
  })),
]);
const separateRoutes = computed(
  () =>
    form.value.navigation !== 'OFF' &&
    (splitIslands(form.value.spawnIslandMode) ||
      form.value.kind === 'CALDERA' ||
      (form.value.kind !== 'LAND' && form.value.freeIslands > 0) ||
      ((form.value.kind === 'ARCHIPELAGO' || form.value.kind === 'MIXED') && !form.value.bridges)),
);
const biomes = computed(() => capabilities.value.biomes);
const decorationBiomes = (exclude: string[]): SmOption<string>[] =>
  biomes.value.filter((biome) => !exclude.includes(biome)).map((biome) => ({ value: biome, label: biomeLabel(biome) }));
const battleSites = computed(() => capabilities.value.features.battleWreckMaximumSites[String(form.value.mapSize)] ?? 0);
const customSun = computed(() => form.value.sunAzimuth !== null || isRandom('features.sunAzimuth'));
const reliefShares = computed(() => ({
  mountains: form.value.mountains,
  depressions: form.value.depressions,
  plains: 100 - form.value.mountains - form.value.depressions,
}));

function setReliefProfile(profile: ReliefProfile, enabled: boolean | 'indeterminate'): void {
  const current = form.value.reliefProfiles.filter((value) => value !== profile);
  set('reliefProfiles', enabled === true ? [...current, profile] : current);
}

function setCustomSun(enabled: boolean | 'indeterminate'): void {
  if (enabled !== true) {
    toggle('features.sunAzimuth', false);
  }
  set('sunAzimuth', enabled === true ? defaultSunAzimuth() : null);
}
</script>

<template>
  <div class="flex flex-col">
    <p class="px-4 pt-3 pb-2 text-xs text-muted-foreground">{{ t('stoneMap.settings.randomIntro') }}</p>

    <SmGroup :heading="t('stoneMap.settings.groups.general')" number="01" open>
      <Field class="gap-1.5">
        <FieldLabel for="sm-seed">{{ t('stoneMap.settings.seed') }}</FieldLabel>
        <div class="flex items-center gap-2">
          <Input
            id="sm-seed"
            class="tabular-nums"
            :model-value="form.seed"
            :placeholder="t('stoneMap.settings.seedPlaceholder')"
            :disabled="isRandom('seed')"
            autocomplete="off"
            @update:model-value="(value) => set('seed', String(value))"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            :disabled="isRandom('seed')"
            :aria-label="t('stoneMap.settings.reroll')"
            :data-tooltip="t('stoneMap.settings.reroll')"
            @click="set('seed', randomSeed())"
          >
            <RefreshCw />
          </Button>
          <RandomToggle path="seed" :label="t('stoneMap.settings.seed')" />
        </div>
      </Field>
      <SmSelect
        id="sm-map-size"
        :label="t('stoneMap.settings.mapSize')"
        :model-value="form.mapSize"
        :options="options(capabilities.mapSizes, mapSizeLabel)"
        @update:model-value="(value) => set('mapSize', value)"
      />
      <SmSelect
        id="sm-pattern"
        :label="t('stoneMap.settings.pattern')"
        :model-value="form.pattern"
        :options="options(SYMMETRY_PATTERNS, patternLabel)"
        random-path="topology.symmetryPattern"
        :hint="patternHint(form.pattern)"
        @update:model-value="(value: SymmetryPattern) => apply(selectPattern(form, value))"
      />
      <SmSelect
        id="sm-symmetry"
        :label="t('stoneMap.settings.symmetry')"
        :model-value="form.symmetry"
        :options="options(capabilities.terrainSymmetries)"
        :disabled="form.pattern !== 'CLASSIC'"
        random-path="terrainSymmetry"
        @update:model-value="(value) => set('symmetry', value)"
      />
      <div class="grid grid-cols-2 gap-3">
        <SmNumber
          id="sm-height-scale"
          :label="t('stoneMap.settings.heightScale')"
          :model-value="form.heightScale"
          :step="0.1"
          random-path="heightScale"
          @update:model-value="(value) => set('heightScale', value ?? 1)"
        />
        <SmNumber
          id="sm-height-offset"
          :label="t('stoneMap.settings.heightOffset')"
          :model-value="form.heightOffset"
          :step="0.5"
          random-path="heightOffset"
          @update:model-value="(value) => set('heightOffset', value ?? 0)"
        />
      </div>
      <SmSelect
        id="sm-units-per-row"
        :label="t('stoneMap.settings.unitsPerRow')"
        :model-value="form.navigationUnitsPerRow"
        :options="options([2, 3, 4])"
        :disabled="form.navigation === 'OFF' && !(coast && form.navalNavigation)"
        random-path="features.navigationUnitsPerRow"
        :hint="t('stoneMap.settings.unitsPerRowHint')"
        @update:model-value="(value) => set('navigationUnitsPerRow', value)"
      />
    </SmGroup>

    <SmGroup :heading="t('stoneMap.settings.groups.players')" number="02">
      <div class="grid grid-cols-2 gap-3">
        <SmNumber
          id="sm-spawns"
          :label="t('stoneMap.settings.spawnCount')"
          :model-value="form.spawnCount"
          :min="form.pattern === 'QUADRANTS' ? 4 : spawnRange.minimum"
          :max="spawnRange.maximum"
          :step="spawnStep"
          @update:model-value="(value) => set('spawnCount', Math.min(spawnRange.maximum, Math.max(spawnRange.minimum, Math.round(value ?? 2))))"
        />
        <SmNumber
          id="sm-teams"
          :label="t('stoneMap.settings.numTeams')"
          :model-value="form.numTeams"
          :min="0"
          :max="form.spawnCount"
          @update:model-value="(value) => set('numTeams', Math.min(form.spawnCount, Math.max(0, Math.round(value ?? 0))))"
        />
      </div>
      <SmSlider
        id="sm-team-spread"
        :label="t('stoneMap.settings.teamSpread')"
        :model-value="form.teamSpread"
        :value-label="`${form.teamSpread}%`"
        :disabled="!allies"
        random-path="features.teamSpawnSeparation"
        :hint="t('stoneMap.settings.teamSpreadHint')"
        @update:model-value="(value) => set('teamSpread', value)"
      />
      <div class="grid grid-cols-2 gap-3">
        <SmNumber
          id="sm-team-min"
          :label="t('stoneMap.settings.minTeamDistance')"
          :model-value="form.minimumTeamSpawnDistance"
          :min="0"
          :max="Math.min(maxDistance, form.maximumTeamSpawnDistance ?? Infinity)"
          step="any"
          nullable
          :placeholder="t('stoneMap.settings.noLimit')"
          :disabled="!allies"
          random-path="features.minimumTeamSpawnDistance"
          @update:model-value="(value) => set('minimumTeamSpawnDistance', value)"
        />
        <SmNumber
          id="sm-team-max"
          :label="t('stoneMap.settings.maxTeamDistance')"
          :model-value="form.maximumTeamSpawnDistance"
          :min="form.minimumTeamSpawnDistance ?? 0"
          :max="maxDistance"
          step="any"
          nullable
          :placeholder="t('stoneMap.settings.noLimit')"
          :disabled="!allies"
          random-path="features.maximumTeamSpawnDistance"
          @update:model-value="(value) => set('maximumTeamSpawnDistance', value)"
        />
      </div>
      <FieldDescription class="-mt-2 text-xs">{{ t('stoneMap.settings.teamDistanceHint') }}</FieldDescription>
      <SmSelect
        id="sm-island-mode"
        :label="t('stoneMap.settings.islandMode')"
        :model-value="form.spawnIslandMode"
        :options="islandModes"
        random-path="topology.spawnIslandMode"
        :hint="form.spawnIslandMode === 'PER_SPAWN' || form.spawnIslandMode === 'PER_TEAM' ? t('stoneMap.settings.noBridgesHint') : null"
        @update:model-value="(value: SpawnIslandMode) => apply(selectSpawnIslandMode(form, value))"
      />
      <SmSelect
        v-if="form.spawnIslandMode === 'TEAM_GROUPS' || isRandom('topology.spawnIslandMode')"
        id="sm-players-per-island"
        :label="t('stoneMap.settings.playersPerIsland')"
        :model-value="form.maxPlayersPerIsland"
        :options="options([1, 2, 3, 4, 5, 6, 7, 8])"
        random-path="topology.maxPlayersPerIsland"
        @update:model-value="(value) => set('maxPlayersPerIsland', value)"
      />
      <SmSwitch
        id="sm-build-area"
        :label="t('stoneMap.settings.buildArea')"
        :model-value="form.spawnBuildArea"
        @update:model-value="(value) => set('spawnBuildArea', value)"
      />
      <template v-if="form.spawnBuildArea">
        <div class="grid grid-cols-2 gap-3">
          <SmNumber
            id="sm-build-radius"
            :label="t('stoneMap.settings.buildRadius')"
            :model-value="form.spawnBuildRadius"
            :min="range('spawnBuildArea.radius', { minimum: 16, maximum: 1024 }).minimum"
            :max="form.mapSize / 2"
            @update:model-value="(value) => set('spawnBuildRadius', value ?? 64)"
          />
          <SmNumber
            id="sm-build-percent"
            :label="t('stoneMap.settings.buildPercent')"
            :model-value="form.spawnBuildPercent"
            :min="1"
            :max="100"
            @update:model-value="(value) => set('spawnBuildPercent', value ?? 60)"
          />
        </div>
        <FieldDescription class="-mt-2 text-xs">{{ t('stoneMap.settings.buildAreaHint') }}</FieldDescription>
      </template>
    </SmGroup>

    <SmGroup :heading="t('stoneMap.settings.groups.water')" number="03">
      <SmSelect
        id="sm-topology"
        :label="t('stoneMap.settings.topology')"
        :model-value="form.kind"
        :options="options(TOPOLOGY_KINDS, topologyLabel)"
        random-path="topology.kind"
        :hint="form.kind === 'CALDERA' ? t('stoneMap.settings.calderaHint') : null"
        @update:model-value="(value: TopologyKind) => apply(selectTopology(form, value))"
      />
      <SmSlider
        id="sm-water"
        :label="t('stoneMap.settings.water')"
        :model-value="form.water"
        :min="10"
        :max="waterMaximum(form.kind)"
        :value-label="t('stoneMap.settings.waterValue', { water, land: 100 - water })"
        :disabled="form.kind === 'LAND'"
        random-path="topology.waterRatio"
        :hint="lake ? t('stoneMap.settings.waterLakeHint') : t('stoneMap.settings.waterSeaHint')"
        @update:model-value="(value) => set('water', value)"
      />
      <SmSwitch
        id="sm-rivers"
        :label="t('stoneMap.settings.rivers')"
        :model-value="form.rivers"
        random-path="topology.rivers"
        :hint="form.rivers ? (form.complexRelief ? t('stoneMap.settings.riversInBudget') : t('stoneMap.settings.riversExtra')) : null"
        @update:model-value="(value) => set('rivers', value)"
      />

      <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{{ t('stoneMap.settings.islandsHeading') }}</h3>
      <SmSlider
        id="sm-edge-contact"
        :label="t('stoneMap.settings.edgeContact')"
        :model-value="form.edgeContactChance"
        :step="5"
        :value-label="`${form.kind === 'LAND' || lake ? 0 : form.edgeContactChance}%`"
        :disabled="form.kind === 'LAND' || lake"
        random-path="topology.edgeContactChance"
        @update:model-value="(value) => set('edgeContactChance', value)"
      />
      <SmSelect
        id="sm-free-islands"
        :label="t('stoneMap.settings.freeIslands')"
        :model-value="form.kind === 'LAND' ? 0 : form.freeIslands"
        :options="freeIslandOptions"
        :disabled="form.kind === 'LAND'"
        :hint="t('stoneMap.settings.freeIslandsHint')"
        @update:model-value="(value) => set('freeIslands', value)"
      />
      <SmSwitch
        id="sm-bridges"
        :label="t('stoneMap.settings.bridges')"
        :model-value="canBridge && form.bridges"
        :disabled="!canBridge"
        random-path="topology.landBridges"
        @update:model-value="(value) => set('bridges', value)"
      />
      <SmSwitch
        id="sm-natural-bridges"
        :label="t('stoneMap.settings.naturalBridges')"
        :model-value="form.naturalBridges"
        :disabled="!canBridge || !form.bridges"
        random-path="features.naturalLandBridges"
        :hint="canBridge && form.bridges && form.naturalBridges ? t('stoneMap.settings.naturalBridgesHint') : null"
        @update:model-value="(value) => set('naturalBridges', value)"
      />
      <SmSelect
        v-if="form.spawnIslandMode === 'TEAM_GROUPS' && canBridge && form.bridges"
        id="sm-enemy-islands"
        :label="t('stoneMap.settings.enemyIslands')"
        :model-value="form.enemyIslandConnections"
        :options="[
          { value: 0, label: t('stoneMap.settings.enemyIslandsNone') },
          { value: 1, label: t('stoneMap.settings.enemyIslandsOne') },
          { value: 2, label: t('stoneMap.settings.enemyIslandsTwo') },
        ]"
        random-path="topology.enemyIslandConnections"
        :hint="t('stoneMap.settings.enemyIslandsHint')"
        @update:model-value="(value) => set('enemyIslandConnections', value)"
      />

      <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{{ t('stoneMap.settings.shoresHeading') }}</h3>
      <SmSelect
        id="sm-shoreline"
        :label="t('stoneMap.settings.shoreline')"
        :model-value="coast ? form.shoreline : 'DEFAULT'"
        :options="options(capabilities.shorelineStyles, shoreLabel)"
        :disabled="!coast"
        random-path="topology.shorelineStyle"
        :hint="coast && form.shoreline === 'MIXED' ? t('stoneMap.settings.shorelineMixedHint') : null"
        @update:model-value="(value: ShorelineStyle) => set('shoreline', value)"
      />
      <SmSwitch
        id="sm-coastal-details"
        :label="t('stoneMap.settings.coastalDetails')"
        :model-value="coast && form.coastalDetails"
        :disabled="!coast"
        random-path="features.coastalDetails"
        :hint="coast && form.coastalDetails ? t('stoneMap.settings.coastalDetailsHint') : null"
        @update:model-value="(value) => set('coastalDetails', value)"
      />
      <SmSwitch
        id="sm-water-slopes"
        :label="t('stoneMap.settings.waterSlopeDetails')"
        :model-value="coast && form.waterSlopeDetails"
        :disabled="!coast"
        random-path="features.waterSlopeDetails"
        :hint="t('stoneMap.settings.waterSlopeDetailsHint')"
        @update:model-value="(value) => set('waterSlopeDetails', value)"
      />

      <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{{ t('stoneMap.settings.seabedHeading') }}</h3>
      <SmSwitch
        id="sm-seabed-relief"
        :label="t('stoneMap.settings.seabedRelief')"
        :model-value="form.seabedRelief"
        random-path="features.seabedRelief"
        :hint="t('stoneMap.settings.seabedReliefHint')"
        @update:model-value="(value) => set('seabedRelief', value)"
      />
      <SmSwitch
        id="sm-seabed-channels"
        :label="t('stoneMap.settings.seabedChannels')"
        :model-value="form.seabedChannels"
        random-path="features.seabedChannels"
        :hint="t('stoneMap.settings.seabedChannelsHint')"
        @update:model-value="(value) => set('seabedChannels', value)"
      />
      <SmSwitch
        id="sm-seabed-banks"
        :label="t('stoneMap.settings.seabedBanks')"
        :model-value="form.seabedBanks"
        random-path="features.seabedBanks"
        :hint="t('stoneMap.settings.seabedBanksHint')"
        @update:model-value="(value) => set('seabedBanks', value)"
      />
      <SmSwitch
        id="sm-seabed-geology"
        :label="t('stoneMap.settings.seabedGeology')"
        :model-value="form.seabedGeology"
        random-path="features.seabedGeology"
        @update:model-value="(value) => set('seabedGeology', value)"
      />
      <SmSwitch
        id="sm-seabed-materials"
        :label="t('stoneMap.settings.seabedMaterials')"
        :model-value="form.seabedMaterials"
        random-path="features.seabedMaterials"
        @update:model-value="(value) => set('seabedMaterials', value)"
      />
      <SmSwitch
        id="sm-seabed-details"
        :label="t('stoneMap.settings.seabedDetails')"
        :model-value="form.seabedDetails"
        random-path="features.seabedDetails"
        @update:model-value="(value) => set('seabedDetails', value)"
      />
      <SmSwitch
        id="sm-reefs"
        :label="t('stoneMap.settings.reefs')"
        :model-value="coast && form.reefs"
        :disabled="!coast"
        random-path="features.reefs"
        :hint="t('stoneMap.settings.reefsHint')"
        @update:model-value="(value) => set('reefs', value)"
      />

      <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{{ t('stoneMap.settings.navalHeading') }}</h3>
      <SmSwitch
        id="sm-naval"
        :label="t('stoneMap.settings.navalNavigation')"
        :model-value="coast && form.navalNavigation"
        :disabled="!coast"
        random-path="features.navalNavigation"
        @update:model-value="(value) => set('navalNavigation', value)"
      />
      <SmSwitch
        id="sm-coastal-wrecks"
        :label="t('stoneMap.settings.coastalWrecks')"
        :model-value="form.coastalWrecks"
        random-path="features.coastalWrecks"
        :hint="t('stoneMap.settings.coastalWrecksHint')"
        @update:model-value="(value) => set('coastalWrecks', value)"
      />
      <SmSwitch
        id="sm-water-mex"
        :label="t('stoneMap.settings.waterMex')"
        :model-value="form.waterMex"
        :disabled="!explicitResources"
        random-path="resourcePlacement.allowWaterMexes"
        :hint="explicitResources ? null : t('stoneMap.settings.waterMexHint')"
        @update:model-value="(value) => set('waterMex', value)"
      />
    </SmGroup>

    <SmGroup :heading="t('stoneMap.settings.groups.land')" number="04">
      <SmSelect
        id="sm-terrain-mode"
        :label="t('stoneMap.settings.terrainMode')"
        :model-value="form.terrainMode"
        :options="options(capabilities.terrainDetailModes, terrainModeLabel)"
        :disabled="form.pattern === 'LAYERED'"
        random-path="topology.mode"
        :hint="realism ? t('stoneMap.settings.realismHint') : null"
        @update:model-value="(value: TerrainDetailMode) => set('terrainMode', value)"
      />
      <template v-if="realism || isRandom('topology.mode')">
        <p class="flex gap-4 text-xs text-muted-foreground tabular-nums">
          <span>{{ t('stoneMap.settings.shareMountains', { value: reliefShares.mountains }) }}</span>
          <span>{{ t('stoneMap.settings.shareDepressions', { value: reliefShares.depressions }) }}</span>
          <span>{{ t('stoneMap.settings.sharePlains', { value: reliefShares.plains }) }}</span>
        </p>
        <SmSlider
          id="sm-mountains"
          :label="t('stoneMap.settings.mountains')"
          :model-value="form.mountains"
          :max="100 - form.depressions"
          :value-label="`${form.mountains}%`"
          random-path="topology.mountainRatio"
          @update:model-value="(value) => set('mountains', value)"
        />
        <SmSlider
          id="sm-depressions"
          :label="t('stoneMap.settings.depressions')"
          :model-value="form.depressions"
          :max="100 - form.mountains"
          :value-label="`${form.depressions}%`"
          random-path="topology.depressionRatio"
          :hint="t('stoneMap.settings.reliefSharesHint')"
          @update:model-value="(value) => set('depressions', value)"
        />
      </template>
      <SmSelect
        id="sm-mountain-structure"
        :label="t('stoneMap.settings.mountainStructure')"
        :model-value="form.mountainStructure"
        :options="options(['ALL', 'CLASSIC', 'BRANCHED', 'PLATEAU', 'MIXED'] as MountainStructure[], mountainLabel)"
        :disabled="!realism"
        random-path="features.mountainStructure"
        @update:model-value="(value: MountainStructure) => set('mountainStructure', value)"
      />
      <SmSwitch
        id="sm-complex-relief"
        :label="t('stoneMap.settings.complexRelief')"
        :model-value="realism && form.complexRelief"
        :disabled="!realism"
        random-path="features.complexRelief"
        :hint="realism ? null : t('stoneMap.settings.complexReliefHint')"
        @update:model-value="(value) => set('complexRelief', value)"
      />
      <fieldset v-if="realism && form.complexRelief" class="flex flex-col gap-2 rounded-md border p-3">
        <div class="flex items-center gap-2">
          <legend class="flex-1 text-sm font-medium">{{ t('stoneMap.settings.reliefProfiles') }}</legend>
          <RandomToggle path="features.reliefProfiles" :label="t('stoneMap.settings.reliefProfiles')" />
        </div>
        <Label v-for="profile in RELIEF_PROFILES" :key="profile" class="cursor-pointer gap-2 font-normal">
          <Checkbox
            :model-value="form.reliefProfiles.includes(profile)"
            :disabled="isRandom('features.reliefProfiles') || (form.reliefProfiles.length === 1 && form.reliefProfiles.includes(profile))"
            @update:model-value="(value) => setReliefProfile(profile, value)"
          />
          {{ reliefProfileLabel(profile) }}
        </Label>
        <FieldDescription class="text-xs">{{ t('stoneMap.settings.reliefProfilesHint') }}</FieldDescription>
        <FieldDescription v-if="form.kind === 'LAND' && form.rivers" class="text-xs">{{ t('stoneMap.settings.reliefRiversHint') }}</FieldDescription>
      </fieldset>
      <SmSlider
        id="sm-erosion"
        :label="t('stoneMap.settings.erosion')"
        :model-value="form.erosion"
        :step="5"
        :value-label="`${realism ? form.erosion : 0}%`"
        :disabled="!realism"
        random-path="features.erosionStrength"
        :hint="t('stoneMap.settings.erosionHint')"
        @update:model-value="(value) => set('erosion', value)"
      />
      <SmSwitch
        id="sm-hollows"
        :label="t('stoneMap.settings.fillHollows')"
        :model-value="form.fillMountainHollows"
        random-path="features.fillMountainHollows"
        :hint="t('stoneMap.settings.fillHollowsHint')"
        @update:model-value="(value) => set('fillMountainHollows', value)"
      />
      <SmSelect
        id="sm-navigation"
        :label="t('stoneMap.settings.navigation')"
        :model-value="form.navigation"
        :options="options(capabilities.navigationProfiles, navigationLabel)"
        random-path="navigationProfile"
        :hint="separateRoutes ? t('stoneMap.settings.navigationIslandsHint') : null"
        @update:model-value="(value: NavigationProfile) => set('navigation', value)"
      />

      <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{{ t('stoneMap.settings.biomeHeading') }}</h3>
      <SmSelect
        id="sm-biome"
        :label="t('stoneMap.settings.biome')"
        :model-value="form.biome"
        :options="options(biomes, biomeLabel)"
        random-path="customStyle.biome"
        @update:model-value="(value) => set('biome', value)"
      />
      <SmSelect
        id="sm-props"
        :label="t('stoneMap.settings.props')"
        :model-value="form.props"
        :options="options(capabilities.propStyles, propStyleLabel)"
        random-path="customStyle.propStyle"
        @update:model-value="(value) => set('props', value)"
      />
      <SmSwitch
        id="sm-environment"
        :label="t('stoneMap.settings.naturalEnvironment')"
        :model-value="form.naturalEnvironment"
        random-path="features.naturalEnvironment"
        @update:model-value="(value) => set('naturalEnvironment', value)"
      />
      <SmSwitch
        id="sm-forest-ecology"
        :label="t('stoneMap.settings.forestEcology')"
        :model-value="form.forestEcology"
        random-path="features.forestEcology"
        @update:model-value="(value) => set('forestEcology', value)"
      />
      <SmSwitch
        id="sm-environment-zones"
        :label="t('stoneMap.settings.environmentZones')"
        :model-value="form.environmentZones"
        random-path="features.environmentZones"
        :hint="t('stoneMap.settings.environmentZonesHint')"
        @update:model-value="(value) => set('environmentZones', value)"
      />
      <SmSwitch
        id="sm-plain-forests"
        :label="t('stoneMap.settings.plainForests')"
        :model-value="form.plainForests"
        random-path="features.plainForests"
        @update:model-value="(value) => set('plainForests', value)"
      />
      <SmSwitch
        id="sm-vegetation"
        :label="t('stoneMap.settings.adaptiveVegetation')"
        :model-value="form.adaptiveVegetation"
        random-path="features.adaptiveVegetation"
        :hint="t('stoneMap.settings.adaptiveVegetationHint')"
        @update:model-value="(value) => set('adaptiveVegetation', value)"
      />
      <details class="group/deco rounded-md border">
        <summary class="cursor-pointer px-3 py-2 text-sm font-medium select-none">{{ t('stoneMap.settings.decorationHeading') }}</summary>
        <div class="flex flex-col gap-4 px-3 pt-1 pb-3">
          <SmSwitch
            id="sm-decoration"
            :label="t('stoneMap.settings.decoration')"
            :model-value="form.decoration"
            random-path="features.decoration.enabled"
            @update:model-value="(value) => set('decoration', value)"
          />
          <template v-if="form.decoration || isRandom('features.decoration.enabled')">
            <SmSelect
              id="sm-decoration-symmetry"
              :label="t('stoneMap.settings.decorationSymmetry')"
              :model-value="form.decorationSymmetry"
              :options="options(DECORATION_SYMMETRIES)"
              random-path="features.decoration.symmetry"
              @update:model-value="(value) => set('decorationSymmetry', value)"
            />
            <SmSelect
              id="sm-decoration-primary"
              :label="t('stoneMap.settings.decorationPrimary')"
              :model-value="form.decorationPrimary"
              :options="decorationBiomes([form.decorationSecondary, form.decorationThird])"
              random-path="features.decoration.primaryBiome"
              @update:model-value="(value) => set('decorationPrimary', value)"
            />
            <SmSelect
              id="sm-decoration-secondary"
              :label="t('stoneMap.settings.decorationSecondary')"
              :model-value="form.decorationSecondary"
              :options="decorationBiomes([form.decorationPrimary, form.decorationThird])"
              random-path="features.decoration.secondaryBiome"
              @update:model-value="(value) => set('decorationSecondary', value)"
            />
            <SmSelect
              id="sm-decoration-third"
              :label="t('stoneMap.settings.decorationThird')"
              :model-value="form.decorationThird"
              :options="[{ value: '', label: t('stoneMap.settings.decorationNoThird') }, ...decorationBiomes([form.decorationPrimary, form.decorationSecondary])]"
              random-path="features.decoration.thirdBiome"
              @update:model-value="(value) => set('decorationThird', value)"
            />
            <SmSelect
              id="sm-decoration-layout"
              :label="t('stoneMap.settings.decorationLayout')"
              :model-value="form.decorationLayout"
              :options="options(DECORATION_LAYOUTS, layoutLabel)"
              random-path="features.decoration.layout"
              @update:model-value="(value: BiomeLayout) => set('decorationLayout', value)"
            />
            <SmSlider
              id="sm-decoration-transition"
              :label="t('stoneMap.settings.decorationTransition')"
              :model-value="form.decorationTransition"
              :min="2"
              :max="50"
              :value-label="`${form.decorationTransition}%`"
              random-path="features.decoration.transitionWidth"
              @update:model-value="(value) => set('decorationTransition', value)"
            />
            <SmSlider
              id="sm-decoration-rotation"
              :label="t('stoneMap.settings.decorationRotation')"
              :model-value="form.decorationRotation"
              :max="355"
              :step="5"
              :value-label="`${form.decorationRotation}°`"
              random-path="features.decoration.rotation"
              :hint="t('stoneMap.settings.decorationHint')"
              @update:model-value="(value) => set('decorationRotation', value)"
            />
          </template>
        </div>
      </details>
    </SmGroup>

    <SmGroup :heading="t('stoneMap.settings.groups.resources')" number="05">
      <div class="grid grid-cols-2 gap-3">
        <SmNumber
          id="sm-resource-density"
          :label="t('stoneMap.settings.resourceDensity')"
          :model-value="form.resourceDensity"
          :min="0"
          :max="1"
          :step="0.05"
          :disabled="form.resourceExplicit"
          random-path="customStyle.resourceDensity"
          @update:model-value="(value) => set('resourceDensity', Math.min(1, Math.max(0, value ?? 0.5)))"
        />
        <SmNumber
          id="sm-reclaim-density"
          :label="t('stoneMap.settings.reclaimDensity')"
          :model-value="form.reclaimDensity"
          :min="0"
          :max="1"
          :step="0.05"
          random-path="customStyle.reclaimDensity"
          @update:model-value="(value) => set('reclaimDensity', Math.min(1, Math.max(0, value ?? 0.5)))"
        />
      </div>
      <SmSwitch
        id="sm-battle-wrecks"
        :label="t('stoneMap.settings.battleWrecks')"
        :model-value="form.battleWrecks"
        @update:model-value="(value) => set('battleWrecks', value)"
      />
      <template v-if="form.battleWrecks">
        <SmNumber
          id="sm-battle-mass"
          :label="t('stoneMap.settings.battleWreckMass')"
          :model-value="form.battleWreckMassLimit"
          :min="0"
          :max="8000"
          :step="100"
          @update:model-value="(value) => set('battleWreckMassLimit', Math.min(8000, Math.max(0, value ?? 3000)))"
        />
        <FieldDescription class="-mt-2 text-xs">{{ t('stoneMap.settings.battleWrecksHint', { sites: battleSites }) }}</FieldDescription>
      </template>
      <SmSwitch
        id="sm-base-mex-grid"
        :label="t('stoneMap.settings.baseMexGrid')"
        :model-value="form.baseMexGrid"
        :hint="t('stoneMap.settings.baseMexGridHint')"
        @update:model-value="(value) => set('baseMexGrid', value)"
      />
      <SmSwitch
        id="sm-explicit-resources"
        :label="t('stoneMap.settings.explicitResources')"
        :model-value="form.resourceExplicit"
        random-path="resourcePlacement.enabled"
        @update:model-value="(value) => apply(selectExplicitResources(form, value))"
      />
      <template v-if="explicitResources">
        <div class="grid grid-cols-2 gap-3">
          <SmNumber
            id="sm-base-mex"
            :label="t('stoneMap.settings.baseMex')"
            :model-value="form.baseMex"
            :min="4"
            :max="16"
            random-path="resourcePlacement.minimumMexesPerSpawn"
            @update:model-value="(value) => set('baseMex', value ?? 4)"
          />
          <SmNumber
            id="sm-outside-mex"
            :label="t('stoneMap.settings.outsideMex')"
            :model-value="form.outsideMex"
            :min="form.spawnCount * form.nearbyMex"
            :max="4096"
            random-path="resourcePlacement.mexesOutsideSpawns"
            @update:model-value="(value) => set('outsideMex', value ?? 40)"
          />
          <SmNumber
            id="sm-base-hydro"
            :label="t('stoneMap.settings.baseHydro')"
            :model-value="form.baseHydro"
            :min="0"
            :max="2"
            random-path="resourcePlacement.minimumHydrosPerSpawn"
            @update:model-value="(value) => set('baseHydro', value ?? 0)"
          />
          <SmNumber
            id="sm-outside-hydro"
            :label="t('stoneMap.settings.outsideHydro')"
            :model-value="form.outsideHydro"
            :min="0"
            :max="256"
            random-path="resourcePlacement.hydrosOutsideSpawns"
            @update:model-value="(value) => set('outsideHydro', value ?? 6)"
          />
        </div>
        <SmSelect
          id="sm-nearby-mex"
          :label="t('stoneMap.settings.nearbyMex')"
          :model-value="form.nearbyMex"
          :options="options([2, 3, 4])"
          random-path="resourcePlacement.nearbyMexesPerSpawn"
          @update:model-value="(value) => set('nearbyMex', value)"
        />
        <SmSelect
          id="sm-distribution"
          :label="t('stoneMap.settings.distribution')"
          :model-value="form.distribution"
          :options="options(capabilities.resourceDistributions, distributionLabel)"
          random-path="resourcePlacement.distribution"
          :hint="t('stoneMap.settings.distributionHint')"
          @update:model-value="(value: ResourceDistribution) => set('distribution', value)"
        />
      </template>
    </SmGroup>

    <SmGroup :heading="t('stoneMap.settings.groups.other')" number="06">
      <Field class="gap-1.5">
        <FieldLabel for="sm-title">{{ t('stoneMap.settings.mapTitle') }}</FieldLabel>
        <Input
          id="sm-title"
          :model-value="form.displayName"
          :maxlength="STONEMAP_PRESENTATION_LIMITS.name"
          :placeholder="t('stoneMap.settings.automatic')"
          @update:model-value="(value) => set('displayName', String(value))"
        />
      </Field>
      <Field class="gap-1.5">
        <FieldLabel for="sm-description">{{ t('stoneMap.settings.mapDescription') }}</FieldLabel>
        <Textarea
          id="sm-description"
          rows="3"
          :model-value="form.mapDescription"
          :maxlength="STONEMAP_PRESENTATION_LIMITS.description"
          :placeholder="t('stoneMap.settings.automatic')"
          @update:model-value="(value) => set('mapDescription', String(value))"
        />
      </Field>
      <SmSwitch
        id="sm-decals"
        :label="t('stoneMap.settings.increasedDecals')"
        :model-value="form.increasedDecals"
        random-path="features.increasedDecals"
        :hint="t('stoneMap.settings.increasedDecalsHint')"
        @update:model-value="(value) => set('increasedDecals', value)"
      />
      <Label class="cursor-pointer gap-2 font-normal">
        <Checkbox :model-value="customSun" @update:model-value="setCustomSun" />
        {{ t('stoneMap.settings.customSun') }}
      </Label>
      <SmSlider
        id="sm-sun"
        :label="t('stoneMap.settings.sunAzimuth')"
        :model-value="form.sunAzimuth ?? defaultSunAzimuth()"
        :max="359"
        :value-label="customSun ? `${form.sunAzimuth ?? defaultSunAzimuth()}°` : t('stoneMap.settings.sunByBiome')"
        :disabled="form.sunAzimuth === null"
        random-path="features.sunAzimuth"
        :hint="customSun ? t('stoneMap.settings.sunHint') : null"
        @update:model-value="(value) => set('sunAzimuth', value)"
      />
      <SmSwitch
        id="sm-enhanced-preview"
        :label="t('stoneMap.settings.enhancedPreview')"
        :model-value="form.enhancedPreview"
        random-path="features.enhancedPreview"
        @update:model-value="(value) => set('enhancedPreview', value)"
      />
      <SmSwitch
        id="sm-settlements"
        :label="t('stoneMap.settings.settlements')"
        :model-value="form.settlements"
        random-path="features.settlements"
        :hint="t('stoneMap.settings.settlementsHint')"
        @update:model-value="(value) => set('settlements', value)"
      />
      <details class="rounded-md border">
        <summary class="cursor-pointer px-3 py-2 text-sm font-medium select-none">{{ t('stoneMap.settings.byNameHeading') }}</summary>
        <div class="flex flex-col gap-2 px-3 pt-1 pb-3">
          <Textarea
            v-model="mapName"
            rows="3"
            class="font-mono text-xs"
            :aria-label="t('stoneMap.settings.byNameLabel')"
            placeholder="stonemap_map_generator_…"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="self-start"
            :disabled="!mapName.trim() || busy"
            @click="emit('generateByName', mapName.trim())"
          >
            {{ t('stoneMap.settings.byNameGenerate') }}
          </Button>
        </div>
      </details>
    </SmGroup>

    <div class="px-4 py-3">
      <Button type="button" variant="ghost" size="sm" :disabled="busy || state.phase === 'installing'" @click="emit('validate')">
        {{ t('stoneMap.settings.validate') }}
      </Button>
    </div>
  </div>
</template>
