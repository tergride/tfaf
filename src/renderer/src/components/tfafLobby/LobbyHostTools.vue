<script setup lang="ts">
import { Bot, BrushCleaning, Lock, Scale, Users, Wrench } from '@lucide/vue';
import { computed, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LOBBY_AUTO_TEAMS, LOBBY_LIMITS, type LobbyAiType, type LobbyAutoTeams } from '../../../../shared/contract.ts';
import { useTfafLobby } from '../../composables/useTfafLobby.ts';
import { t } from '../../lib/i18n.ts';
import LobbyAiPicker from './LobbyAiPicker.vue';

const props = defineProps<{ ais: readonly LobbyAiType[] }>();

const { room, act } = useTfafLobby();

const TEAM_COUNTS = Array.from({ length: LOBBY_LIMITS.maxTeam }, (_, index) => index);

const chosenAi = ref<string | null>(null);
const ai = computed(() => props.ais.find((candidate) => candidate.key === chosenAi.value) ?? props.ais[0] ?? null);
const slots = computed(() => room.value?.slots ?? []);
const hasFree = computed(() => slots.value.some((slot) => slot.occupant === null && !slot.closed));
const hasAi = computed(() => slots.value.some((slot) => slot.occupant?.kind === 'ai'));
const closing = computed(() => slots.value.some((slot) => slot.occupant === null && !slot.closed));
const canCloseOrOpen = computed(() => slots.value.some((slot) => slot.occupant === null && !slot.spawnMex));
const seated = computed(() => slots.value.filter((slot) => slot.occupant !== null).length);
const autoTeams = computed(() => room.value?.autoTeams ?? 'none');

function fill(): void {
  if (ai.value) {
    void act({ type: 'fillAi', personality: ai.value.key, name: ai.value.name });
  }
}

/** Only the AIs in the room: the catalog can hold more than an action carries. */
function balance(): void {
  const present = new Set(slots.value.flatMap((slot) => (slot.occupant?.kind === 'ai' ? [slot.occupant.personality] : [])));
  void act({ type: 'autobalance', aiRatings: Object.fromEntries(props.ais.filter((candidate) => present.has(candidate.key)).map((candidate) => [candidate.key, candidate.rating])) });
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button variant="outline" size="sm"><Wrench />{{ t('tfafLobby.tools.open') }}</Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="flex w-80 flex-col gap-3">
      <section class="flex flex-col gap-1.5">
        <h3 class="text-xs text-faint">{{ t('tfafLobby.tools.ai') }}</h3>
        <LobbyAiPicker :ais="ais" :selected="ai?.key ?? null" class="w-full" :label="t('tfafLobby.tools.chooseAi')" @ai="(candidate) => (chosenAi = candidate.key)">
          <span class="truncate">{{ ai?.name }}</span>
        </LobbyAiPicker>
        <div class="grid grid-cols-2 gap-1.5">
          <Button variant="outline" size="sm" :disabled="!ai || !hasFree" @click="fill"><Bot />{{ t('tfafLobby.tools.fill') }}</Button>
          <Button variant="outline" size="sm" :disabled="!hasAi" @click="act({ type: 'clearAi' })"><BrushCleaning />{{ t('tfafLobby.tools.clear') }}</Button>
        </div>
        <Button variant="outline" size="sm" :disabled="!canCloseOrOpen" @click="act({ type: 'closeEmptySpots' })">
          <Lock />{{ closing ? t('tfafLobby.tools.closeEmpty') : t('tfafLobby.tools.openEmpty') }}
        </Button>
      </section>

      <section class="flex flex-col gap-1.5">
        <h3 class="text-xs text-faint">{{ t('tfafLobby.tools.teams') }}</h3>
        <div class="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-2 text-sm">
          <span>{{ t('tfafLobby.tools.split') }}</span>
          <Select :model-value="''" @update:model-value="(value) => act({ type: 'splitTeams', teams: Number(value) })">
            <SelectTrigger size="sm" class="w-full" :aria-label="t('tfafLobby.tools.split')"><SelectValue :placeholder="t('tfafLobby.tools.splitChoose')" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="count in TEAM_COUNTS" :key="count" :value="String(count)">{{ count === 0 ? t('tfafLobby.tools.noTeams') : t('tfafLobby.tools.teamCount', { count }) }}</SelectItem>
            </SelectContent>
          </Select>
          <span>{{ t('tfafLobby.tools.autoTeams') }}</span>
          <Select :model-value="autoTeams" @update:model-value="(value) => act({ type: 'setAutoTeams', mode: value as LobbyAutoTeams })">
            <SelectTrigger size="sm" class="w-full" :aria-label="t('tfafLobby.tools.autoTeams')"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="mode in LOBBY_AUTO_TEAMS" :key="mode" :value="mode">{{ t(`tfafLobby.tools.autoTeamModes.${mode}`) }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p v-if="autoTeams === 'manual'" class="text-xs text-muted-foreground"><Users class="mr-1 inline size-3.5" />{{ t('tfafLobby.tools.manualHint') }}</p>
        <Button variant="outline" size="sm" :disabled="seated < 2" :data-tooltip="t('tfafLobby.tools.balanceHint')" @click="balance"><Scale />{{ t('tfafLobby.tools.balance') }}</Button>
      </section>
    </PopoverContent>
  </Popover>
</template>
