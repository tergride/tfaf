<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue';
import { computed, reactive, ref } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import type { GameOption, GameOptionControl, GameOptionValue } from '../../../shared/contract.ts';
import { useGamePrefsView } from '../composables/useGamePrefsView.ts';
import { t } from '../lib/i18n.ts';
import FilterChip from './FilterChip.vue';
import NoGameProfileNotice from './NoGameProfileNotice.vue';
import SearchInput from './SearchInput.vue';

type SliderControl = Extract<GameOptionControl, { kind: 'slider' }>;

interface ShownGroup {
  id: string;
  title: string | null;
  options: GameOption[];
}

const { view, error, locked, save } = useGamePrefsView(() => window.tfaf.gameOptions.get());

const sectionId = ref<string | null>(null);
const search = ref('');

const section = computed(() => {
  const sections = view.value?.sections ?? [];
  return sections.find((candidate) => candidate.id === sectionId.value) ?? sections[0] ?? null;
});

const groups = computed<ShownGroup[]>(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) {
    const current = section.value;
    return (current?.groups ?? []).map((group, index) => ({ id: `${current!.id}:${index}`, ...group }));
  }
  // A search looks through every section, and each group says which section it is from.
  return (view.value?.sections ?? [])
    .flatMap((candidate) =>
      candidate.groups.map((group, index) => ({
        id: `${candidate.id}:${index}`,
        title: group.title ? `${candidate.title} · ${group.title}` : candidate.title,
        options: group.options.filter((option) =>
          [option.title, option.description ?? '', option.key].some((text) => text.toLowerCase().includes(query)),
        ),
      })),
    )
    .filter((group) => group.options.length > 0);
});

// A value being saved shows at once; the view the main process sends back replaces it.
const pending = reactive(new Map<string, GameOptionValue>());
// A slider moves freely and saves once it is let go.
const drafts = reactive(new Map<string, number>());

function valueOf(option: GameOption): GameOptionValue {
  return pending.has(option.key) ? pending.get(option.key)! : option.value;
}

async function setValue(option: GameOption, value: GameOptionValue): Promise<void> {
  if (locked.value || value === valueOf(option)) {
    return;
  }
  pending.set(option.key, value);
  await save(() => window.tfaf.gameOptions.set(option.key, value));
  if (pending.get(option.key) === value) {
    pending.delete(option.key);
  }
}

function choiceIndex(option: GameOption): string | undefined {
  if (option.control.kind !== 'choice') {
    return undefined;
  }
  const value = valueOf(option);
  const index = option.control.choices.findIndex((choice) => choice.value === value);
  return index < 0 ? undefined : String(index);
}

function choiceLabel(option: GameOption): string {
  const value = valueOf(option);
  return option.control.kind === 'choice' ? (option.control.choices.find((choice) => choice.value === value)?.label ?? '') : '';
}

function pickChoice(option: GameOption, index: unknown): void {
  const choice = option.control.kind === 'choice' ? option.control.choices[Number(index)] : undefined;
  if (choice) {
    void setValue(option, choice.value);
  }
}

/** The game's smooth sliders get a step that suits their range. */
function sliderStep(control: SliderControl): number {
  if (control.step > 0) {
    return control.step;
  }
  return control.max - control.min <= 10 ? 0.1 : 1;
}

function sliderValue(option: GameOption): number {
  const value = drafts.get(option.key) ?? valueOf(option);
  return typeof value === 'number' ? value : 0;
}

function sliderText(option: GameOption, control: SliderControl): string {
  const value = sliderValue(option);
  return Number.isInteger(sliderStep(control)) ? String(Math.round(value)) : value.toFixed(1);
}

function moveSlider(option: GameOption, value: number[] | undefined): void {
  const next = value?.[0];
  if (next !== undefined) {
    drafts.set(option.key, next);
  }
}

async function commitSlider(option: GameOption, value: number[]): Promise<void> {
  const next = value[0];
  if (next !== undefined) {
    await setValue(option, next);
  }
  drafts.delete(option.key);
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <Alert v-if="error" variant="destructive">
      <AlertDescription class="selectable">{{ error }}</AlertDescription>
    </Alert>
    <div v-if="!view && !error" class="flex items-center gap-2 text-[13px] text-muted-foreground"><Spinner />{{ t('common.loading') }}</div>

    <template v-if="view">
      <Alert v-if="locked" variant="warning">
        <TriangleAlert />
        <AlertDescription>{{ t('settings.forgedAlliance.gameRunning') }}</AlertDescription>
      </Alert>
      <p v-else-if="view.profile !== null" class="text-[13px] text-muted-foreground">
        {{ t('settings.forgedAlliance.profile', { name: view.profile }) }}
      </p>
      <NoGameProfileNotice v-if="view.profile === null" />
    </template>

    <template v-if="view && view.profile !== null">
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex flex-wrap gap-0.75" role="group">
          <FilterChip
            v-for="candidate in view.sections"
            :key="candidate.id"
            :pressed="!search && section?.id === candidate.id"
            @toggle="
              sectionId = candidate.id;
              search = '';
            "
          >
            {{ candidate.title }}
          </FilterChip>
        </div>
        <div class="ml-auto w-64">
          <SearchInput v-model="search" :placeholder="t('settings.gameOptions.search')" />
        </div>
      </div>

      <p v-if="groups.length === 0" class="text-[13px] text-muted-foreground">{{ t('settings.forgedAlliance.nothingFound') }}</p>

      <Card v-for="group in groups" :key="group.id" class="gap-0 py-0">
        <CardHeader v-if="group.title" class="border-b py-4">
          <CardTitle>{{ group.title }}</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col px-0">
          <template v-for="(option, index) in group.options" :key="option.key">
            <Separator v-if="index > 0" />
            <div class="flex items-center gap-4 px-6 py-3" :class="{ 'opacity-60': locked }">
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="font-medium">{{ option.title }}</span>
                <span v-if="option.description" class="text-[13px] text-muted-foreground">{{ option.description }}</span>
              </div>

              <Switch
                v-if="option.control.kind === 'switch'"
                :model-value="valueOf(option) === option.control.on"
                :disabled="locked"
                :aria-label="option.title"
                @update:model-value="(checked) => option.control.kind === 'switch' && setValue(option, checked ? option.control.on : option.control.off)"
              />

              <Select
                v-else-if="option.control.kind === 'choice'"
                :model-value="choiceIndex(option)"
                :disabled="locked"
                @update:model-value="(index) => pickChoice(option, index)"
              >
                <!-- The label comes from the view, not SelectValue: it keeps the text the item had when first shown. -->
                <SelectTrigger class="w-56 shrink-0" :aria-label="option.title">
                  <span data-slot="select-value">{{ choiceLabel(option) }}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="(choice, choiceIndexValue) in option.control.choices" :key="choiceIndexValue" :value="String(choiceIndexValue)">
                    {{ choice.label }}
                  </SelectItem>
                </SelectContent>
              </Select>

              <div v-else class="flex w-64 shrink-0 items-center gap-3">
                <Slider
                  :model-value="[sliderValue(option)]"
                  :min="option.control.min"
                  :max="option.control.max"
                  :step="sliderStep(option.control)"
                  :disabled="locked"
                  :aria-label="option.title"
                  @update:model-value="(value) => moveSlider(option, value)"
                  @value-commit="(value) => commitSlider(option, value)"
                />
                <span class="w-10 text-right text-sm tabular-nums">{{ sliderText(option, option.control) }}</span>
              </div>
            </div>
          </template>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
