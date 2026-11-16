<script setup lang="ts">
import { Dices } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { GENERATION_TYPES, type GenerationType, type GeneratorOptionLists, type GeneratorPrefs } from '../../../shared/contract.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import {
  buildCustomMapRequest,
  closestSpawnCount,
  GENERATOR_DENSITY_MAX,
  GENERATOR_MAP_SIZES,
  GENERATOR_TEAM_COUNTS,
  generatorMapSizeKm,
  isGeneratorSeed,
  isGeneratorSeedText,
  randomGeneratorSeed,
  spawnCountsFor,
} from '../../../shared/mapGenerator.ts';
import { useDeferredClose } from '../composables/useDeferredClose.ts';
import { errorMessage, formatNumber, isCancelled } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { queries, refreshLists } from '../lib/queries.ts';

const emit = defineEmits<{ close: []; generated: [folderName: string] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));

type Choice = 'symmetries' | 'styles' | 'terrainStyles' | 'textureStyles' | 'resourceStyles' | 'propStyles';
type Density = 'resourceDensity' | 'reclaimDensity';

const TYPE_LABELS: Record<GenerationType, MessageKey> = {
  casual: 'hostGame.generator.types.casual',
  tournament: 'hostGame.generator.types.tournament',
  blind: 'hostGame.generator.types.blind',
  unexplored: 'hostGame.generator.types.unexplored',
};
const TYPE_HINTS: Record<GenerationType, MessageKey> = {
  casual: 'hostGame.generator.typeHints.casual',
  tournament: 'hostGame.generator.typeHints.tournament',
  blind: 'hostGame.generator.typeHints.blind',
  unexplored: 'hostGame.generator.typeHints.unexplored',
};
const STYLE_PARTS: { choice: Choice; label: MessageKey }[] = [
  { choice: 'terrainStyles', label: 'hostGame.generator.terrainStyle' },
  { choice: 'textureStyles', label: 'hostGame.generator.textureStyle' },
  { choice: 'resourceStyles', label: 'hostGame.generator.resourceStyle' },
  { choice: 'propStyles', label: 'hostGame.generator.propStyle' },
];
const DENSITIES: { field: Density; label: MessageKey }[] = [
  { field: 'resourceDensity', label: 'hostGame.generator.resourceDensity' },
  { field: 'reclaimDensity', label: 'hostGame.generator.reclaimDensity' },
];

const prefs = ref<GeneratorPrefs | null>(null);
const lists = ref<GeneratorOptionLists | null>(null);
const optionsLoading = ref(false);
const optionsError = ref<string | null>(null);
const loadError = ref<string | null>(null);
const generating = ref(false);
const error = ref<string | null>(null);
let savedPrefs = '';

const casual = computed(() => prefs.value?.generationType === 'casual');
const customStyle = computed(() => casual.value && prefs.value?.customStyle === true);
const spawnCounts = computed(() => spawnCountsFor(prefs.value?.numTeams ?? 0));
const seedError = computed(() =>
  prefs.value && casual.value && prefs.value.fixedSeed && !isGeneratorSeed(prefs.value.seed.trim())
    ? t('hostGame.generator.invalidSeed')
    : null,
);

function mapSizeLabel(mapSize: number): string {
  return t('format.mapSize', { size: formatNumber(generatorMapSizeKm(mapSize)) });
}

function percent(density: number): number {
  return Math.round((density / GENERATOR_DENSITY_MAX) * 100);
}

function densityLabel(field: Density): string {
  const [low, high] = prefs.value?.[field] ?? [0, GENERATOR_DENSITY_MAX];
  return low === high
    ? t('hostGame.generator.densityValue', { value: percent(low) })
    : t('hostGame.generator.densityRange', { low: percent(low), high: percent(high) });
}

/** Saved choices the generator of this version still offers. */
function chosen(choice: Choice): string[] {
  const offered = lists.value?.[choice] ?? [];
  return prefs.value?.[choice].filter((value) => offered.includes(value)) ?? [];
}

function setChosen(choice: Choice, value: unknown): void {
  if (prefs.value && Array.isArray(value)) {
    prefs.value[choice] = value.filter((entry): entry is string => typeof entry === 'string');
  }
}

function setTeams(value: unknown): void {
  if (prefs.value && typeof value === 'number') {
    prefs.value.numTeams = value;
    prefs.value.spawnCount = closestSpawnCount(prefs.value.spawnCount, value);
  }
}

function setNumber(field: 'spawnCount' | 'mapSize', value: unknown): void {
  if (prefs.value && typeof value === 'number') {
    prefs.value[field] = value;
  }
}

function setType(value: unknown): void {
  const type = GENERATION_TYPES.find((known) => known === value);
  if (prefs.value && type) {
    prefs.value.generationType = type;
  }
}

function setFixedSeed(on: boolean): void {
  if (!prefs.value) {
    return;
  }
  prefs.value.fixedSeed = on;
  if (on && !prefs.value.seed.trim()) {
    prefs.value.seed = randomGeneratorSeed();
  }
}

function setDensity(field: Density, value: number[] | undefined): void {
  const [low, high] = value ?? [];
  if (prefs.value && low !== undefined && high !== undefined) {
    prefs.value[field] = [low, high];
  }
}

/** A copy without Vue proxies, which cannot cross IPC; a seed the settings would refuse is dropped. */
function plainPrefs(value: GeneratorPrefs): GeneratorPrefs {
  const seed = value.seed.trim();
  return {
    ...value,
    seed: isGeneratorSeedText(seed) ? seed : '',
    symmetries: [...value.symmetries],
    styles: [...value.styles],
    terrainStyles: [...value.terrainStyles],
    textureStyles: [...value.textureStyles],
    resourceStyles: [...value.resourceStyles],
    propStyles: [...value.propStyles],
    resourceDensity: [value.resourceDensity[0], value.resourceDensity[1]],
    reclaimDensity: [value.reclaimDensity[0], value.reclaimDensity[1]],
  };
}

async function savePrefs(): Promise<void> {
  if (!prefs.value) {
    return;
  }
  const plain = plainPrefs(prefs.value);
  const serialized = JSON.stringify(plain);
  if (serialized === savedPrefs) {
    return;
  }
  savedPrefs = serialized;
  try {
    await window.tfaf.settings.update({ generator: plain });
  } catch (cause) {
    console.warn('Could not save the map generator options', errorMessage(cause));
  }
}

// Java and the generator are downloaded first if needed, with their progress in the task toasts.
async function loadOptions(): Promise<void> {
  optionsLoading.value = true;
  optionsError.value = null;
  try {
    lists.value = await window.tfaf.generator.options();
  } catch (cause) {
    optionsError.value = errorMessage(cause);
  } finally {
    optionsLoading.value = false;
  }
}

onMounted(async () => {
  void loadOptions();
  try {
    prefs.value = (await window.tfaf.settings.get()).generator;
    savedPrefs = JSON.stringify(plainPrefs(prefs.value));
  } catch (cause) {
    loadError.value = errorMessage(cause);
  }
});
onBeforeUnmount(() => void savePrefs());

async function generate(): Promise<void> {
  if (!prefs.value || !lists.value || seedError.value || generating.value) {
    return;
  }
  error.value = null;
  generating.value = true;
  const request = buildCustomMapRequest({ ...prefs.value, seed: prefs.value.seed.trim() }, lists.value);
  void savePrefs();
  try {
    const folderName = await window.tfaf.generator.generate(request);
    await refreshLists(queries.installedMaps());
    emit('generated', folderName);
    close();
  } catch (cause) {
    if (!isCancelled(cause)) {
      error.value = errorMessage(cause);
    }
  } finally {
    generating.value = false;
  }
}

function onOpenChange(value: boolean): void {
  if (!value && !generating.value) {
    close();
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent
      class="flex max-h-[calc(100vh-var(--titlebar-height)-3rem)] flex-col gap-0 p-0 sm:max-w-[640px]"
      :show-close-button="false"
      @close-auto-focus="onContentClosed"
    >
      <DialogHeader class="flex-row items-start gap-4 border-b px-6 py-4">
        <div class="flex flex-col gap-0.5">
          <DialogTitle class="font-display text-xl">{{ t('hostGame.generator.title') }}</DialogTitle>
          <DialogDescription>{{ t('hostGame.generator.description') }}</DialogDescription>
        </div>
        <span v-if="lists" class="ml-auto shrink-0 pt-1 text-xs text-muted-foreground tabular-nums">
          {{ t('hostGame.generator.version', { version: lists.version }) }}
        </span>
      </DialogHeader>

      <div v-if="!prefs" class="grid min-h-48 flex-1 place-items-center px-6 py-5">
        <p v-if="loadError" class="text-sm text-destructive selectable">{{ loadError }}</p>
        <Spinner v-else class="size-6 text-primary" />
      </div>
      <form v-else id="generate-map" class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5" novalidate @submit.prevent="generate">
        <p v-if="optionsLoading" class="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner class="size-4" />{{ t('hostGame.generator.preparing') }}
        </p>
        <div v-else-if="optionsError" class="flex items-center gap-3">
          <p class="flex-1 text-sm text-destructive selectable">{{ t('hostGame.generator.optionsFailed', { error: optionsError }) }}</p>
          <Button type="button" variant="outline" size="sm" @click="loadOptions">{{ t('common.retry') }}</Button>
        </div>

        <div class="grid grid-cols-3 gap-4">
          <Field>
            <FieldLabel for="generator-teams">{{ t('hostGame.generator.numTeams') }}</FieldLabel>
            <Select :model-value="prefs.numTeams" @update:model-value="setTeams">
              <SelectTrigger id="generator-teams" class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="count in GENERATOR_TEAM_COUNTS" :key="count" :value="count">
                  {{ count === 0 ? t('hostGame.generator.noTeams') : count }}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel for="generator-spawns">{{ t('hostGame.generator.spawnCount') }}</FieldLabel>
            <Select :model-value="prefs.spawnCount" @update:model-value="(value) => setNumber('spawnCount', value)">
              <SelectTrigger id="generator-spawns" class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="count in spawnCounts" :key="count" :value="count">{{ count }}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel for="generator-size">{{ t('hostGame.generator.mapSize') }}</FieldLabel>
            <Select :model-value="prefs.mapSize" @update:model-value="(value) => setNumber('mapSize', value)">
              <SelectTrigger id="generator-size" class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="size in GENERATOR_MAP_SIZES" :key="size" :value="size">{{ mapSizeLabel(size) }}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field>
          <FieldLabel for="generator-type">{{ t('hostGame.generator.generationType') }}</FieldLabel>
          <Select :model-value="prefs.generationType" @update:model-value="setType">
            <SelectTrigger id="generator-type" class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="type in GENERATION_TYPES" :key="type" :value="type">{{ t(TYPE_LABELS[type]) }}</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>{{ t(TYPE_HINTS[prefs.generationType]) }}</FieldDescription>
        </Field>

        <Separator />

        <FieldDescription>{{ t('hostGame.generator.choicesHint') }}</FieldDescription>

        <div class="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel for="generator-symmetry">{{ t('hostGame.generator.symmetry') }}</FieldLabel>
            <Select
              :model-value="chosen('symmetries')"
              multiple
              :disabled="!casual || !lists"
              @update:model-value="(value) => setChosen('symmetries', value)"
            >
              <SelectTrigger id="generator-symmetry" class="w-full">
                <SelectValue :placeholder="t('hostGame.generator.random')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="option in lists?.symmetries ?? []" :key="option" :value="option">{{ option }}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field :data-invalid="!!seedError">
            <Label class="h-5 cursor-pointer gap-2 font-normal">
              <Switch :model-value="prefs.fixedSeed" :disabled="!casual" @update:model-value="setFixedSeed" />
              {{ t('hostGame.generator.fixedSeed') }}
            </Label>
            <div class="flex items-center gap-2">
              <Input
                v-model="prefs.seed"
                :aria-label="t('hostGame.generator.seed')"
                :placeholder="t('hostGame.generator.seedPlaceholder')"
                inputmode="numeric"
                maxlength="20"
                class="tabular-nums"
                :disabled="!casual || !prefs.fixedSeed"
                :aria-invalid="!!seedError"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                :data-tooltip="t('hostGame.generator.reroll')"
                :aria-label="t('hostGame.generator.reroll')"
                :disabled="!casual || !prefs.fixedSeed"
                @click="prefs.seed = randomGeneratorSeed()"
              >
                <Dices />
              </Button>
            </div>
            <FieldError :errors="[seedError ?? undefined]" />
          </Field>
        </div>

        <Field>
          <FieldLabel for="generator-style">{{ t('hostGame.generator.style') }}</FieldLabel>
          <Select
            :model-value="chosen('styles')"
            multiple
            :disabled="!casual || customStyle || !lists"
            @update:model-value="(value) => setChosen('styles', value)"
          >
            <SelectTrigger id="generator-style" class="w-full">
              <SelectValue :placeholder="t('hostGame.generator.random')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in lists?.styles ?? []" :key="option" :value="option">{{ option }}</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Label class="cursor-pointer gap-2 font-normal">
          <Switch v-model="prefs.customStyle" :disabled="!casual" />
          {{ t('hostGame.generator.customStyle') }}
        </Label>

        <div class="grid grid-cols-2 gap-4">
          <Field v-for="part in STYLE_PARTS" :key="part.choice">
            <FieldLabel :for="`generator-${part.choice}`">{{ t(part.label) }}</FieldLabel>
            <Select
              :model-value="chosen(part.choice)"
              multiple
              :disabled="!customStyle || !lists"
              @update:model-value="(value) => setChosen(part.choice, value)"
            >
              <SelectTrigger :id="`generator-${part.choice}`" class="w-full">
                <SelectValue :placeholder="t('hostGame.generator.random')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="option in lists?.[part.choice] ?? []" :key="option" :value="option">{{ option }}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field v-for="density in DENSITIES" :key="density.field">
            <div class="flex items-center justify-between gap-2">
              <FieldLabel>{{ t(density.label) }}</FieldLabel>
              <span class="text-sm text-muted-foreground tabular-nums">{{ densityLabel(density.field) }}</span>
            </div>
            <Slider
              :model-value="prefs[density.field]"
              :min="0"
              :max="GENERATOR_DENSITY_MAX"
              :step="1"
              :disabled="!customStyle"
              :aria-label="t(density.label)"
              class="h-5"
              @update:model-value="(value) => setDensity(density.field, value)"
            />
          </Field>
        </div>
        <FieldDescription>{{ t('hostGame.generator.densityHint') }}</FieldDescription>
      </form>

      <DialogFooter class="items-center border-t px-6 py-4">
        <p v-if="error" class="mr-auto text-sm text-destructive selectable">{{ error }}</p>
        <p v-else-if="generating" class="mr-auto text-sm text-muted-foreground">{{ t('hostGame.generator.generating') }}</p>
        <Button variant="ghost" :disabled="generating" @click="close">{{ t('common.cancel') }}</Button>
        <Button type="submit" form="generate-map" size="lg" :disabled="!prefs || !lists || generating || !!seedError">
          <Spinner v-if="generating" />
          {{ t('hostGame.generator.generate') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
