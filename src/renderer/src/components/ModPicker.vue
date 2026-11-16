<script setup lang="ts">
import { CloudOff, X } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { LocalMod } from '../../../shared/contract.ts';
import { t } from '../lib/i18n.ts';
import { queries } from '../lib/queries.ts';
import SearchInput from './SearchInput.vue';

const props = defineProps<{ mods: LocalMod[] }>();
const model = defineModel<string[]>({ required: true });

const filter = ref('');

const installedUids = computed(() => new Set(props.mods.map((mod) => mod.uid)));
const missing = computed(() => model.value.filter((uid) => !installedUids.value.has(uid)));
const visible = computed(() => {
  const text = filter.value.trim().toLowerCase();
  return props.mods
    .filter((mod) => !text || mod.name.toLowerCase().includes(text) || mod.author.toLowerCase().includes(text))
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'ru'));
});

// The other players download the game's sim mods from the FAF vault; UI mods stay with the host.
const simMods = computed(() =>
  props.mods
    .filter((mod) => mod.type === 'SIM')
    .map((mod) => mod.uid)
    .sort(),
);
const vaultQuery = useQuery(() => ({
  ...queries.modsNotInVault(simMods.value),
  enabled: simMods.value.length > 0,
}));
// Without an answer from the vault no mod is marked.
const notInVault = computed(() => new Set(vaultQuery.data.value ?? []));
const selectedNotInVault = computed(() =>
  props.mods.filter((mod) => notInVault.value.has(mod.uid) && model.value.includes(mod.uid)).map((mod) => mod.name),
);

function toggle(uid: string, checked: boolean): void {
  model.value = checked ? [...model.value, uid] : model.value.filter((candidate) => candidate !== uid);
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <SearchInput v-if="mods.length > 6" v-model="filter" :placeholder="t('hostGame.modPicker.search')" />
    <ul class="flex max-h-64 flex-col gap-0.5 overflow-y-auto pr-1">
      <li v-for="uid in missing" :key="uid" class="flex items-center gap-2.5 px-2 py-1.5 text-[13px]">
        <span class="min-w-0 flex-1">
          <span class="block truncate font-mono text-xs">{{ uid }}</span>
          <span class="text-warning">{{ t('hostGame.modPicker.notInstalled') }}</span>
        </span>
        <Button type="button" variant="ghost" size="icon-xs" :aria-label="t('hostGame.modPicker.remove')" @click="toggle(uid, false)"><X /></Button>
      </li>
      <li v-for="mod in visible" :key="mod.uid">
        <label class="plate cut-xs flex cursor-pointer items-center gap-2.5 px-2 py-1.5 text-[13px] [--plate-border:transparent] hover:bg-accent">
          <Checkbox :model-value="model.includes(mod.uid)" @update:model-value="(checked) => toggle(mod.uid, checked === true)" />
          <span class="min-w-0 flex-1 truncate">
            {{ mod.name }}
            <span v-if="mod.version" class="text-muted-foreground">v{{ mod.version }}</span>
          </span>
          <Badge v-if="notInVault.has(mod.uid)" variant="warning" :data-tooltip="t('hostGame.modPicker.notInVaultHint')">
            <CloudOff />{{ t('hostGame.modPicker.notInVaultBadge') }}
          </Badge>
          <Badge :variant="mod.type === 'UI' ? 'info' : 'accent'">
            {{ mod.type === 'UI' ? t('hostGame.modPicker.uiMod') : t('hostGame.modPicker.simMod') }}
          </Badge>
        </label>
      </li>
      <li v-if="mods.length === 0" class="px-2 py-3 text-sm text-muted-foreground">
        {{ t('hostGame.modPicker.noInstalled') }}
      </li>
      <li v-else-if="visible.length === 0" class="px-2 py-3 text-sm text-muted-foreground">
        {{ t('hostGame.modPicker.nothingFound') }}
      </li>
    </ul>
    <p v-if="selectedNotInVault.length > 0" class="text-[13px] text-warning">
      {{ t('hostGame.modPicker.notInVault', { mods: selectedNotInVault.join(', ') }) }}
    </p>
  </div>
</template>
