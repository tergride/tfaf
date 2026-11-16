<script setup lang="ts">
import { ChevronDown, Keyboard, RotateCcw, TriangleAlert, X } from '@lucide/vue';
import { computed, reactive, ref, shallowRef } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { type KeyAction, type KeyActionCategory, KEY_PRESETS, type KeyPreset } from '../../../shared/contract.ts';
import { formatKeyBinding, normalizeKeyBinding } from '../../../shared/keyBindings.ts';
import { confirmAction } from '../composables/useConfirm.ts';
import { useGamePrefsView } from '../composables/useGamePrefsView.ts';
import { t } from '../lib/i18n.ts';
import KeyCaptureDialog from './KeyCaptureDialog.vue';
import NoGameProfileNotice from './NoGameProfileNotice.vue';
import SearchInput from './SearchInput.vue';

const { view, error, locked, save } = useGamePrefsView(() => window.tfaf.keyBindings.get());

const search = ref('');
const expanded = reactive(new Set<string>());
const capturing = shallowRef<KeyAction | null>(null);

const query = computed(() => search.value.trim().toLowerCase());

function label(binding: string): string {
  return formatKeyBinding(binding, view.value?.keyLabels ?? {});
}

function matches(action: KeyAction): boolean {
  const text = query.value;
  return (
    action.title.toLowerCase().includes(text) ||
    action.id.toLowerCase().includes(text) ||
    action.keys.some((key) => key.toLowerCase().includes(text) || label(key).toLowerCase().includes(text))
  );
}

const categories = computed<KeyActionCategory[]>(() => {
  const all = view.value?.categories ?? [];
  if (!query.value) {
    return all;
  }
  return all.map((category) => ({ ...category, actions: category.actions.filter(matches) })).filter((category) => category.actions.length > 0);
});

/** Which action a combination belongs to, in any spelling of it. */
const owners = computed(() => {
  const map = new Map<string, KeyAction>();
  for (const category of view.value?.categories ?? []) {
    for (const action of category.actions) {
      for (const key of action.keys) {
        map.set(normalizeKeyBinding(key), action);
      }
    }
  }
  return map;
});

// Groups start collapsed, as in the game's key dialog; a search opens the ones it found something in.
function isExpanded(category: KeyActionCategory): boolean {
  return query.value !== '' || expanded.has(category.id);
}

function toggle(category: KeyActionCategory): void {
  if (!expanded.delete(category.id)) {
    expanded.add(category.id);
  }
}

function boundCount(category: KeyActionCategory): number {
  return category.actions.filter((action) => action.keys.length > 0).length;
}

async function reset(preset: KeyPreset): Promise<void> {
  const current = view.value;
  if (!current || locked.value) {
    return;
  }
  const name = t(`settings.keyBindings.presets.${preset}`);
  const switching = preset !== current.preset;
  const confirmed = await confirmAction({
    title: t(switching ? 'settings.keyBindings.switchTitle' : 'settings.keyBindings.resetTitle', { preset: name }),
    description: t(switching ? 'settings.keyBindings.switchDescription' : 'settings.keyBindings.resetDescription'),
    confirmText: t(switching ? 'settings.keyBindings.switchConfirm' : 'settings.keyBindings.resetConfirm'),
    destructive: true,
  });
  if (confirmed) {
    await save(() => window.tfaf.keyBindings.reset(preset));
  }
}

function pickPreset(value: unknown): void {
  const preset = KEY_PRESETS.find((candidate) => candidate === value);
  if (preset) {
    void reset(preset);
  }
}

async function assign(action: KeyAction, binding: string): Promise<void> {
  await save(() => window.tfaf.keyBindings.assign(action.id, binding));
}

async function unbind(action: KeyAction, binding: string): Promise<void> {
  await save(() => window.tfaf.keyBindings.unbind(action.id, binding));
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
        <Select :model-value="view.preset" :disabled="locked" @update:model-value="pickPreset">
          <SelectTrigger class="plate-control min-w-64" :aria-label="t('settings.keyBindings.preset')">
            <span class="text-faint">{{ t('settings.keyBindings.preset') }}</span>
            <!-- Not SelectValue: it keeps the text in the language the item was first shown in. -->
            <span data-slot="select-value">{{ t(`settings.keyBindings.presets.${view.preset}`) }}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="preset in KEY_PRESETS" :key="preset" :value="preset">{{ t(`settings.keyBindings.presets.${preset}`) }}</SelectItem>
          </SelectContent>
        </Select>
        <!-- Shown only when the profile has its own bindings, so it also tells that they differ from the layout. -->
        <Button v-if="view.customized" variant="outline" :disabled="locked" @click="reset(view.preset)">
          <RotateCcw />{{ t('settings.keyBindings.reset') }}
        </Button>
        <div class="ml-auto w-64">
          <SearchInput v-model="search" :placeholder="t('settings.keyBindings.search')" />
        </div>
      </div>

      <p v-if="categories.length === 0" class="text-[13px] text-muted-foreground">{{ t('settings.forgedAlliance.nothingFound') }}</p>

      <Card v-for="category in categories" :key="category.id" class="gap-0 py-0">
        <button
          type="button"
          class="flex w-full items-center gap-3 px-6 py-3.5 text-left transition-colors hover:bg-accent/40"
          :class="{ 'border-b': isExpanded(category) }"
          :aria-expanded="isExpanded(category)"
          :disabled="query !== ''"
          @click="toggle(category)"
        >
          <ChevronDown class="size-4 shrink-0 text-muted-foreground transition-transform" :class="{ '-rotate-90': !isExpanded(category) }" />
          <span class="flex-1 font-display font-semibold">{{ category.title }}</span>
          <span class="text-[13px] text-muted-foreground tabular-nums">
            {{ t('settings.keyBindings.bound', { bound: boundCount(category), count: category.actions.length }) }}
          </span>
        </button>
        <CardContent v-if="isExpanded(category)" class="flex flex-col px-0">
          <template v-for="(action, index) in category.actions" :key="action.id">
            <Separator v-if="index > 0" />
            <div class="flex items-center gap-4 px-6 py-2.5" :class="{ 'opacity-60': locked }">
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span>{{ action.title }}</span>
                <span v-if="action.blockedModifiers.length" class="flex items-start gap-1.5 text-[13px] text-warning">
                  <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
                  {{ t('settings.keyBindings.blocked', { keys: action.blockedModifiers.map(label).join(', ') }) }}
                </span>
              </div>
              <div class="flex flex-wrap justify-end gap-1.5">
                <span
                  v-for="binding in action.keys"
                  :key="binding"
                  class="plate cut-xs inline-flex h-7 items-center gap-1 bg-secondary pr-1 pl-2 text-[13px] [--plate-border:transparent]"
                >
                  {{ label(binding) }}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    :disabled="locked"
                    :aria-label="t('settings.keyBindings.unbind', { key: label(binding) })"
                    :data-tooltip="t('settings.keyBindings.unbind', { key: label(binding) })"
                    @click="unbind(action, binding)"
                  >
                    <X />
                  </Button>
                </span>
              </div>
              <Button variant="ghost" size="sm" :disabled="locked" @click="capturing = action">
                <Keyboard />{{ t('settings.keyBindings.assign') }}
              </Button>
            </div>
          </template>
        </CardContent>
      </Card>

      <KeyCaptureDialog
        v-if="capturing"
        :action="capturing"
        :key-codes="view.keyCodes"
        :key-labels="view.keyLabels"
        :owners="owners"
        @assign="(binding) => capturing && assign(capturing, binding)"
        @close="capturing = null"
      />
    </template>
  </div>
</template>
