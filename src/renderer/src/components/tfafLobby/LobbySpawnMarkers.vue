<script setup lang="ts">
import { computed } from 'vue';
import { type LobbySlot, type LobbySpot, NO_TEAM } from '../../../../shared/contract.ts';
import { slotPlayerId } from '../../../../shared/tfafLobby.ts';
import { useLobbyCatalog } from '../../composables/useLobbyCatalog.ts';
import { useSpotDrag } from '../../composables/useSpotDrag.ts';
import { useTfafLobby } from '../../composables/useTfafLobby.ts';
import { t } from '../../lib/i18n.ts';
import AcuIcon from '../AcuIcon.vue';

// The start positions of the room over a map, as ACUs in their players' colours, like in the game's lobby. A free
// position can be taken right here, and the host can drag a player to another one.
const props = defineProps<{ place: (spot: LobbySpot) => { left: number; top: number } | null }>();

// By the team's number: blue, red, green, yellow, white, pink, orange, violet. Colours people can name, picked for the
// CIEDE2000 distance between the closest two, deuteranopia included. The digit's outline and plate part it from any map.
const TEAM_COLORS = ['#1f9fff', '#ff4d4d', '#85ff9d', '#ffff00', '#ffffff', '#ff45b5', '#ffa000', '#c79cff'];

const { room, members, selfId, hosting, starting, spotLocked, heldByReady, hoveredSpot, act } = useTfafLobby();
const { colors } = useLobbyCatalog();
const { canDrag, dragSource, dropTarget, isDragged, isTarget } = useSpotDrag();

interface Marker {
  slot: LobbySlot;
  left: number;
  top: number;
  mine: boolean;
  color: string | null;
  label: string;
  /** The team's number, once the position has one. */
  team: number | null;
}

const markers = computed<Marker[]>(() =>
  (room.value?.slots ?? []).flatMap((slot) => {
    const spot = room.value?.map.spots[slot.spot - 1];
    const placed = spot ? props.place(spot) : null;
    if (!placed) {
      return [];
    }
    const playerId = slotPlayerId(slot);
    const name = slot.occupant?.kind === 'ai' ? slot.occupant.name : playerId !== null ? (members.value.get(playerId)?.login ?? null) : null;
    const hasTeam = slot.team !== NO_TEAM && !slot.closed && (slot.occupant !== null || room.value?.autoTeams !== 'none');
    const team = hasTeam ? slot.team - 1 : null;
    const place = name ?? t(slot.spawnMex ? 'tfafLobby.board.closedMex' : slot.closed ? 'tfafLobby.board.closed' : 'tfafLobby.board.free', { spot: slot.spot });
    return [
      {
        slot,
        ...placed,
        mine: playerId !== null && playerId === selfId.value,
        color: slot.occupant ? (colors.value[slot.color - 1] ?? null) : null,
        label: team === null ? place : t('tfafLobby.board.withTeam', { place, team }),
        team,
      },
    ];
  }),
);

function isFree(slot: LobbySlot): boolean {
  return slot.occupant === null && !slot.closed && !starting.value;
}

/** How a position looks now, for its ACU and for its numbers, which lie in a layer of their own. */
function emphasis(slot: LobbySlot): (string | false)[] {
  return [
    (hoveredSpot.value === slot.spot || isTarget(slot)) && !slot.closed && 'scale-125',
    isDragged(slot) && 'opacity-40',
    slot.closed && (slot.spawnMex ? 'opacity-60' : 'opacity-30'),
    isFree(slot) && spotLocked.value && 'animate-pulse',
  ];
}

/** With teams set by hand a click on the map is how the host sets them. */
function setsTeam(slot: LobbySlot): boolean {
  return hosting.value && !starting.value && !slot.closed && room.value?.autoTeams === 'manual';
}

function cursor(slot: LobbySlot): string {
  if (setsTeam(slot)) {
    return 'cursor-pointer';
  }
  if (canDrag(slot)) {
    return 'cursor-grab';
  }
  if (!isFree(slot) || heldByReady.value) {
    return 'cursor-default';
  }
  return spotLocked.value ? 'cursor-wait' : 'cursor-pointer';
}

function press(slot: LobbySlot): void {
  if (setsTeam(slot)) {
    void act({ type: 'cycleManualTeam', spot: slot.spot });
  } else if (isFree(slot) && !spotLocked.value && !heldByReady.value) {
    void act({ type: 'takeSpot', spot: slot.spot });
  }
}

/** The host's right click goes through the states of an empty position, as in the game's lobby. */
function cycleState(slot: LobbySlot): void {
  if (!hosting.value || starting.value || slot.occupant !== null) {
    return;
  }
  if (!slot.closed) {
    void act({ type: 'closeSpot', spot: slot.spot, closed: true });
  } else if (slot.spawnMex || !room.value?.map.adaptive) {
    void act({ type: 'closeSpot', spot: slot.spot, closed: false });
  } else {
    void act({ type: 'closeSpot', spot: slot.spot, closed: true, spawnMex: true });
  }
}
</script>

<template>
  <button
    v-for="marker in markers"
    :key="marker.slot.spot"
    type="button"
    class="pointer-events-auto absolute -translate-1/2 p-1 outline-none"
    :class="cursor(marker.slot)"
    :style="{ left: `${marker.left}%`, top: `${marker.top}%` }"
    :data-tooltip="marker.label"
    :aria-label="marker.label"
    :data-spot="marker.slot.spot"
    :draggable="canDrag(marker.slot)"
    v-on="{ ...dropTarget(marker.slot), ...(canDrag(marker.slot) ? dragSource(marker.slot) : {}) }"
    @pointerdown.stop
    @mouseenter="hoveredSpot = marker.slot.spot"
    @mouseleave="hoveredSpot = null"
    @focus="hoveredSpot = marker.slot.spot"
    @blur="hoveredSpot = null"
    @click="press(marker.slot)"
    @contextmenu.prevent="cycleState(marker.slot)"
  >
    <span class="relative block transition-transform" :class="emphasis(marker.slot)">
      <AcuIcon
        class="h-6 w-5"
        :class="marker.mine ? 'drop-shadow-[0_0_3px_var(--color-primary)]' : marker.color && 'drop-shadow-[0_1px_2px_rgb(0_0_0/0.8)]'"
        :color="marker.color"
      />
    </span>
  </button>
  <!-- After all the ACUs, so that a neighbour's never covers a number. The labels of the buttons already name these.
       Markers land on fractions of a pixel: in a layer of its own a digit snaps together with its plate, not apart from it. -->
  <span
    v-for="marker in markers"
    :key="marker.slot.spot"
    class="pointer-events-none absolute -translate-1/2 p-1 will-change-transform"
    :style="{ left: `${marker.left}%`, top: `${marker.top}%` }"
    aria-hidden="true"
    data-spot-numbers
  >
    <span class="relative block h-6 w-5 transition-transform" :class="emphasis(marker.slot)">
      <span
        v-if="marker.team !== null"
        class="absolute -top-2 left-full -ml-1.5 w-3.5 rounded-xs bg-black/50 py-0.5 text-center text-sm leading-none font-bold [text-box:trim-both_cap_alphabetic] [text-shadow:0_0_2px_#000,0_0_2px_#000,0_0_3px_#000]"
        :style="{ color: TEAM_COLORS[marker.team - 1] }"
      >
        {{ marker.team }}
      </span>
    </span>
  </span>
</template>
