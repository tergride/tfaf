<script setup lang="ts">
import { Bot, Circle, CircleCheck, Crown, FileCheck, FileWarning, GripVertical, Lock, LoaderCircle, TriangleAlert, X } from '@lucide/vue';
import { computed, ref } from 'vue';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LOBBY_LIMITS, type LobbyAiType, type LobbySlot, NO_TEAM } from '../../../../shared/contract.ts';
import { slotPlayerId } from '../../../../shared/tfafLobby.ts';
import { useRoomFactions } from '../../composables/useRoomFactions.ts';
import { useSpotDrag } from '../../composables/useSpotDrag.ts';
import { useTfafLobby } from '../../composables/useTfafLobby.ts';
import { t } from '../../lib/i18n.ts';
import CountryFlag from '../CountryFlag.vue';
import LobbyAiPicker from './LobbyAiPicker.vue';
import LobbyTextDialog from './LobbyTextDialog.vue';
import { ROSTER_GRID } from './rosterGrid.ts';

const props = defineProps<{
  slot: LobbySlot;
  colors: readonly string[];
  ais: readonly LobbyAiType[];
  /** The player's files against the host's differ. */
  filesDiffer: boolean;
  highlighted: boolean;
}>();
const emit = defineEmits<{ hover: [spot: number | null] }>();

const { room, hosting, selfId, members, peers, starting, spotLocked, heldByReady, canChange, act } = useTfafLobby();
const { canDrag, dragSource, dropTarget, isDragged, isTarget } = useSpotDrag();

const roomFactions = useRoomFactions();
const TEAMS = Array.from({ length: LOBBY_LIMITS.maxTeam }, (_, index) => index + 1);

type SlotState = 'open' | 'closed' | 'mex';

const colorOpen = ref(false);
const kicking = ref(false);

const playerId = computed(() => slotPlayerId(props.slot));
const member = computed(() => (playerId.value === null ? null : (members.value.get(playerId.value) ?? null)));
const isSelf = computed(() => playerId.value !== null && playerId.value === selfId.value);
const isHost = computed(() => playerId.value !== null && playerId.value === room.value?.hostId);
const peer = computed(() => (playerId.value === null ? null : (peers.value.get(playerId.value) ?? null)));
const editable = computed(() => canChange(props.slot));
const swatch = computed(() => props.colors[props.slot.color - 1] ?? 'var(--color-input)');
const takenColors = computed(() => new Set(room.value?.slots.filter((slot) => slot.occupant && slot !== props.slot).map((slot) => slot.color)));
const removable = computed(() => hosting.value && !starting.value && props.slot.occupant !== null && !isSelf.value);
const removeHint = computed(() => (props.slot.occupant?.kind === 'ai' ? t('tfafLobby.roster.removeAi') : t('tfafLobby.roster.kick')));
const free = computed(() => props.slot.occupant === null && !props.slot.closed && !starting.value);
const canTake = computed(() => free.value && !spotLocked.value && !heldByReady.value);
const teamEditable = computed(() => editable.value && room.value?.autoTeams === 'none');
const gamesHint = computed(() => (member.value?.games == null ? undefined : t('tfafLobby.roster.games', { count: member.value.games })));
const slotState = computed((): SlotState => (props.slot.spawnMex ? 'mex' : props.slot.closed ? 'closed' : 'open'));
const otherStates = computed(() =>
  (['open', 'closed', ...(room.value?.map.adaptive ? ['mex'] : [])] as SlotState[]).filter((state) => state !== slotState.value).map((state) => ({ value: state, label: stateLabel(state) })),
);
const aiStates = computed(() => (['open', 'closed'] as SlotState[]).map((state) => ({ value: state, label: stateLabel(state) })));
const movable = computed(() => canDrag(props.slot));
const grab = computed(() => (movable.value ? dragSource(props.slot) : {}));
const faction = computed(() => roomFactions.faction(props.slot.faction));
const factionChoices = computed(() => roomFactions.choices(props.slot.spot));

const files = computed(() => {
  if (!member.value) {
    return null;
  }
  if (member.value.files === 'failed') {
    return { icon: TriangleAlert, tone: 'text-destructive', text: t('tfafLobby.roster.files.failed') };
  }
  if (member.value.files === 'preparing') {
    return { icon: LoaderCircle, tone: 'text-info animate-spin', text: t('tfafLobby.roster.files.preparing') };
  }
  return props.filesDiffer
    ? { icon: FileWarning, tone: 'text-destructive', text: t('tfafLobby.roster.files.different') }
    : { icon: FileCheck, tone: 'text-success', text: t('tfafLobby.roster.files.ready') };
});

const connecting = computed(() => peer.value !== null && !isSelf.value && (peer.value.state !== 'connected' || peer.value.rttMs === null));
const ping = computed(() => {
  const rttMs = peer.value?.rttMs ?? null;
  return isSelf.value || connecting.value || rttMs === null ? null : t('tfafLobby.roster.pingValue', { ms: rttMs });
});

function take(): void {
  if (canTake.value) {
    void act({ type: 'takeSpot', spot: props.slot.spot });
  }
}

function addAi(ai: LobbyAiType): void {
  void act({ type: 'addAi', spot: props.slot.spot, personality: ai.key, name: ai.name });
}

function setState(state: string): void {
  void act({ type: 'closeSpot', spot: props.slot.spot, closed: state !== 'open', spawnMex: state === 'mex' });
}

function stateLabel(state: SlotState): string {
  return t(`tfafLobby.roster.slotStates.${state}`);
}

function pickColor(color: number): void {
  colorOpen.value = false;
  void act({ type: 'setColor', spot: props.slot.spot, color });
}

function kick(reason: string): void {
  if (member.value) {
    void act({ type: 'kick', playerId: member.value.id, ...(reason ? { reason } : {}) });
  }
}

function removeOccupant(): void {
  if (props.slot.occupant?.kind === 'ai') {
    void act({ type: 'clearSpot', spot: props.slot.spot });
  } else {
    kicking.value = true;
  }
}
</script>

<template>
  <li
    class="group/row h-10 transition-colors"
    :class="[
      ROSTER_GRID,
      isTarget(slot) ? 'bg-primary/15' : highlighted ? 'bg-accent' : 'hover:bg-accent/50',
      isDragged(slot) && 'opacity-50',
      free && !heldByReady && (spotLocked ? 'cursor-wait' : 'cursor-pointer'),
    ]"
    :style="{ borderLeftColor: slot.occupant ? swatch : 'transparent' }"
    :data-slot-spot="slot.spot"
    data-drag-image
    v-on="dropTarget(slot)"
    @mouseenter="emit('hover', slot.spot)"
    @mouseleave="emit('hover', null)"
    @click="take"
  >
    <span
      class="flex items-center justify-end gap-0.5 font-display text-sm font-semibold text-faint tabular-nums"
      :class="movable && 'cursor-grab'"
      :draggable="movable"
      :data-tooltip="movable ? t('tfafLobby.roster.dragHint') : undefined"
      v-on="grab"
    >
      <GripVertical v-if="movable" class="size-3.5 opacity-0 transition-opacity group-hover/row:opacity-100" />
      {{ slot.spot }}
    </span>

    <template v-if="slot.occupant">
      <Popover v-if="editable" v-model:open="colorOpen">
        <PopoverTrigger as-child>
          <button
            type="button"
            class="h-5 w-7 rounded-xs border border-white/30 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :style="{ backgroundColor: swatch }"
            :aria-label="t('tfafLobby.roster.color')"
          />
        </PopoverTrigger>
        <PopoverContent align="start" class="grid w-auto grid-cols-5 gap-1.5 p-2">
          <button
            v-for="(color, index) in colors"
            :key="color"
            type="button"
            class="h-6 w-9 rounded-xs border border-white/25 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-20"
            :style="{ backgroundColor: color }"
            :disabled="takenColors.has(index + 1)"
            :aria-label="`${t('tfafLobby.roster.color')} ${index + 1}`"
            @click="pickColor(index + 1)"
          />
        </PopoverContent>
      </Popover>
      <span v-else class="h-5 w-7 rounded-xs border border-white/30" :style="{ backgroundColor: swatch }" />

      <!-- An AI has no rating or ping, so its list takes those columns too; it ends level with the list of an empty position. -->
      <div v-if="slot.occupant.kind === 'ai' && editable" class="col-span-3 flex min-w-0 items-center self-stretch">
        <LobbyAiPicker
          :ais="ais"
          :selected="slot.occupant.personality"
          :choices="aiStates"
          class="w-full max-w-59.5"
          :label="t('tfafLobby.roster.changeAi', { spot: slot.spot })"
          @ai="addAi"
          @choice="setState"
        >
          <Bot class="size-4" /><span class="truncate" :data-tooltip="slot.occupant.name">{{ slot.occupant.name }}</span>
        </LobbyAiPicker>
        <!-- What is left of the columns stays a place to grab the row by, as a name would be. -->
        <span class="min-w-0 flex-1 self-stretch" :class="movable && 'cursor-grab'" :draggable="movable" v-on="grab" />
      </div>
      <template v-else>
        <div class="flex min-w-0 items-center gap-2" :class="movable && 'cursor-grab'" :draggable="movable" v-on="grab">
          <Bot v-if="slot.occupant.kind === 'ai'" class="size-4 shrink-0 text-muted-foreground" :aria-label="t('tfafLobby.roster.ai')" />
          <CountryFlag v-else :country="member?.country" />
          <span class="truncate font-medium" :class="isSelf && 'text-primary'">
            <span v-if="member?.clan" class="text-muted-foreground">[{{ member.clan }}] </span>
            {{ slot.occupant.kind === 'ai' ? slot.occupant.name : (member?.login ?? playerId) }}
          </span>
          <span v-if="isHost" class="inline-flex shrink-0" role="img" :data-tooltip="t('tfafLobby.roster.host')" :aria-label="t('tfafLobby.roster.host')">
            <Crown class="size-3.5 text-primary" />
          </span>
        </div>

        <span class="text-right text-sm text-muted-foreground tabular-nums" :data-tooltip="gamesHint">{{ member?.rating ?? '' }}</span>
        <span class="flex justify-end pr-1.5 text-sm text-muted-foreground tabular-nums">
          <span v-if="connecting" class="inline-flex" role="img" :data-tooltip="t('tfafLobby.roster.connecting')" :aria-label="t('tfafLobby.roster.connecting')">
            <LoaderCircle class="size-4 animate-spin text-info" />
          </span>
          <template v-else>{{ ping }}</template>
        </span>
      </template>

      <Select
        :model-value="String(slot.faction)"
        :disabled="!editable"
        @update:model-value="(value) => act({ type: 'setFaction', spot: slot.spot, faction: Number(value) })"
      >
        <SelectTrigger size="sm" class="plate-control w-full px-2" :aria-label="t('tfafLobby.roster.faction')">
          <SelectValue><img v-if="faction.icon" :src="faction.icon" alt="" class="size-5" draggable="false" />{{ faction.name }}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="option in factionChoices" :key="option.value" :value="String(option.value)">
            <img v-if="option.icon" :src="option.icon" alt="" class="size-5" draggable="false" />{{ option.name }}
          </SelectItem>
        </SelectContent>
      </Select>
      <Select
        :model-value="String(slot.team)"
        :disabled="!teamEditable"
        @update:model-value="(value) => act({ type: 'setTeam', spot: slot.spot, team: Number(value) })"
      >
        <SelectTrigger size="sm" class="plate-control w-full px-2" :aria-label="t('tfafLobby.roster.team')">
          <SelectValue>{{ slot.team === NO_TEAM ? '—' : slot.team - 1 }}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="team in TEAMS" :key="team" :value="String(team)">
            {{ team === NO_TEAM ? t('tfafLobby.roster.noTeam') : t('tfafLobby.roster.teamNumber', { team: team - 1 }) }}
          </SelectItem>
        </SelectContent>
      </Select>

      <span class="flex items-center justify-center gap-2">
        <template v-if="member">
          <span :data-tooltip="files?.text" class="inline-flex" role="img" :aria-label="files?.text">
            <component :is="files?.icon" class="size-4" :class="files?.tone" />
          </span>
          <span
            class="inline-flex"
            role="img"
            :data-tooltip="member.ready ? t('tfafLobby.roster.ready') : t('tfafLobby.roster.notReady')"
            :aria-label="member.ready ? t('tfafLobby.roster.ready') : t('tfafLobby.roster.notReady')"
          >
            <component :is="member.ready ? CircleCheck : Circle" class="size-4" :class="member.ready ? 'text-success' : 'text-faint'" />
          </span>
        </template>
      </span>

      <button
        v-if="removable"
        type="button"
        class="grid size-6 place-items-center text-faint transition-colors outline-none hover:text-destructive focus-visible:text-destructive"
        :data-tooltip="removeHint"
        :aria-label="removeHint"
        @click="removeOccupant"
      >
        <X class="size-4" />
      </button>
      <LobbyTextDialog
        v-if="kicking && member"
        :heading="t('tfafLobby.roster.kickTitle', { player: member.login })"
        :description="t('tfafLobby.roster.kickDescription')"
        :label="t('tfafLobby.roster.kickReason')"
        :max-length="LOBBY_LIMITS.maxKickReasonLength"
        :confirm-text="t('tfafLobby.roster.kick')"
        destructive
        @confirm="kick"
        @close="kicking = false"
      />
    </template>

    <template v-else>
      <!-- As in a game's lobby, the host's slot is a list: the list has the other state and the AIs.
           The full row height and a margin beside the list ignore clicks, so a click that misses it does not take the position. -->
      <div v-if="hosting && !starting" class="col-span-4 -mr-3 -ml-1.5 flex max-w-72.5 min-w-0 cursor-default items-center self-stretch pr-3 pl-1.5" @click.stop>
        <LobbyAiPicker
          :ais="ais"
          :selected="null"
          :choices="otherStates"
          class="w-full"
          :label="t('tfafLobby.roster.slotState', { spot: slot.spot })"
          @ai="addAi"
          @choice="setState"
        >
          <Lock v-if="slot.closed" class="size-3.5" />{{ stateLabel(slotState) }}
        </LobbyAiPicker>
      </div>
      <!-- The whole row takes the position; these name it and carry the keyboard. -->
      <button
        v-else-if="canTake"
        type="button"
        class="group/take col-span-2 justify-self-start text-sm text-faint underline-offset-3 outline-none group-hover/row:text-primary group-hover/row:underline focus-visible:text-primary focus-visible:underline"
        :aria-label="t('tfafLobby.roster.takeSpot', { spot: slot.spot })"
      >
        <span class="group-hover/row:hidden group-focus-visible/take:hidden">{{ t('tfafLobby.roster.free') }}</span>
        <span class="hidden group-hover/row:inline group-focus-visible/take:inline">{{ t('tfafLobby.roster.take') }}</span>
      </button>
      <span v-else class="col-span-2 flex items-center gap-2 text-sm text-faint" :class="free && spotLocked && 'animate-pulse'">
        <Lock v-if="slot.closed" class="size-3.5" />{{ stateLabel(slotState) }}
      </span>
      <button
        v-if="hosting && canTake"
        type="button"
        class="col-span-2 justify-self-end text-sm text-primary underline underline-offset-3 opacity-0 outline-none group-hover/row:opacity-100 focus-visible:opacity-100"
        :aria-label="t('tfafLobby.roster.takeSpot', { spot: slot.spot })"
      >
        {{ t('tfafLobby.roster.take') }}
      </button>
    </template>
  </li>
</template>
