<script lang="ts">
import { ref } from 'vue';

// A list without a chosen AI opens on the kind the host looked at last, so filling spots with AIx one by one keeps it.
const lastCheat = ref(false);
</script>

<script setup lang="ts">
import { Check, ChevronDown, Search } from '@lucide/vue';
import { ListboxContent, ListboxFilter, ListboxGroup, ListboxGroupLabel, ListboxItem, ListboxItemIndicator, ListboxRoot } from 'reka-ui';
import { type ComponentPublicInstance, computed, type HTMLAttributes, nextTick, useTemplateRef, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { LobbyAiType } from '../../../../shared/contract.ts';
import { groupLobbyAis } from '../../lib/lobbyAis.ts';
import { t } from '../../lib/i18n.ts';

const props = defineProps<{
  ais: readonly LobbyAiType[];
  /** The key of the AI chosen now. */
  selected: string | null;
  /** Choices above the AIs, such as the other states of a position. */
  choices?: readonly { value: string; label: string }[];
  label: string;
  class?: HTMLAttributes['class'];
}>();
const emit = defineEmits<{ ai: [ai: LobbyAiType]; choice: [value: string] }>();

const CHOICE = 'choice:';
const ITEM =
  "relative flex w-full cursor-default items-center gap-2 py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=checked]:text-primary [&_svg]:pointer-events-none [&_svg]:shrink-0";

const open = ref(false);
const query = ref('');
const cheat = ref(false);
const listbox = useTemplateRef<{ highlightSelected: (event?: Event, scroll?: boolean) => Promise<void> }>('listbox');
const filter = useTemplateRef<ComponentPublicInstance>('filter');

const selectedAi = computed(() => props.ais.find((ai) => ai.key === props.selected) ?? null);
const searching = computed(() => query.value.trim() !== '');
const groups = computed(() => groupLobbyAis(props.ais, cheat.value, query.value));
const otherKindFound = computed(() => (groups.value.length > 0 ? 0 : groupLobbyAis(props.ais, !cheat.value, query.value).reduce((count, group) => count + group.ais.length, 0)));
const shownChoices = computed(() => (searching.value ? [] : (props.choices ?? [])));

watch(open, async (value) => {
  if (!value) {
    return;
  }
  query.value = '';
  cheat.value = selectedAi.value?.cheat ?? lastCheat.value;
  await nextTick();
  await listbox.value?.highlightSelected(undefined, true);
});

async function setCheat(value: boolean): Promise<void> {
  cheat.value = value;
  lastCheat.value = value;
  (filter.value?.$el as HTMLInputElement | undefined)?.focus();
  await listbox.value?.highlightSelected(undefined, true);
}

// Esc first clears the search; only an empty field lets it close the list.
function onEscape(event: KeyboardEvent): void {
  if (query.value) {
    event.stopPropagation();
    query.value = '';
  }
}

function chooseAi(ai: LobbyAiType): void {
  open.value = false;
  if (ai.key !== props.selected) {
    emit('ai', ai);
  }
}

function choose(value: string): void {
  open.value = false;
  emit('choice', value);
}
</script>

<template>
  <!-- The outside click closes the list without also taking the position beneath it. -->
  <Popover v-model:open="open" modal>
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        size="sm"
        :class="cn('justify-between px-2 font-medium has-[>svg]:px-2 data-[state=open]:[--plate-border:var(--color-input)]', props.class)"
        :aria-label="label"
      >
        <span class="flex min-w-0 items-center gap-2"><slot /></span>
        <ChevronDown class="size-4 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" class="flex max-h-(--reka-popover-content-available-height) w-72 flex-col p-0">
      <ListboxRoot ref="listbox" :model-value="selected ?? undefined" highlight-on-hover class="flex min-h-0 flex-col">
        <div class="flex items-center gap-3 border-b p-2">
          <InputGroup class="h-8 flex-1">
            <InputGroupAddon><Search /></InputGroupAddon>
            <ListboxFilter
              ref="filter"
              v-model="query"
              data-slot="input-group-control"
              class="h-full min-w-0 flex-1 bg-transparent pr-2 text-sm outline-none placeholder:text-faint"
              :placeholder="t('tfafLobby.aiPicker.search')"
              :aria-label="t('tfafLobby.aiPicker.search')"
              :maxlength="100"
              @keydown.esc="onEscape"
            />
          </InputGroup>
          <label class="flex shrink-0 items-center gap-2 text-sm font-medium" :data-tooltip="t('tfafLobby.aiPicker.cheatHint')">
            {{ t('tfafLobby.aiPicker.cheat') }}
            <Switch :model-value="cheat" @update:model-value="setCheat" />
          </label>
        </div>
        <ListboxContent class="max-h-80 min-h-0 overflow-y-auto p-1">
          <ListboxGroup v-if="shownChoices.length > 0" class="not-first:mt-1 not-first:border-t not-first:pt-1">
            <ListboxItem v-for="choice in shownChoices" :key="choice.value" :value="`${CHOICE}${choice.value}`" :class="ITEM" @select="choose(choice.value)">
              {{ choice.label }}
            </ListboxItem>
          </ListboxGroup>
          <ListboxGroup v-for="group in groups" :key="group.mod ?? ''" class="not-first:mt-1 not-first:border-t not-first:pt-1">
            <ListboxGroupLabel class="sticky top-0 z-10 bg-popover px-2 py-1.5 text-xs text-muted-foreground">{{ group.mod ?? t('tfafLobby.aiPicker.builtIn') }}</ListboxGroupLabel>
            <ListboxItem v-for="ai in group.ais" :key="ai.key" :value="ai.key" :class="ITEM" @select="chooseAi(ai)">
              <span class="truncate">{{ ai.name }}</span>
              <ListboxItemIndicator class="absolute right-2 flex size-3.5 items-center justify-center"><Check class="size-4" /></ListboxItemIndicator>
            </ListboxItem>
          </ListboxGroup>
          <div v-if="groups.length === 0 && ais.length > 0" class="flex flex-col items-start gap-1.5 px-2 py-3 text-sm text-faint">
            {{ t('tfafLobby.aiPicker.nothingFound') }}
            <Button v-if="otherKindFound > 0" variant="link" size="xs" class="h-auto px-0" @click="setCheat(!cheat)">
              {{ cheat ? t('tfafLobby.aiPicker.foundOrdinary', { count: otherKindFound }) : t('tfafLobby.aiPicker.foundCheat', { count: otherKindFound }) }}
            </Button>
          </div>
        </ListboxContent>
      </ListboxRoot>
    </PopoverContent>
  </Popover>
</template>
