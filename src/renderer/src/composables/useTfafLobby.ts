import { computed, ref } from 'vue';
import type { GamePeer, LobbyAction, LobbyMember, LobbySlot } from '../../../shared/contract.ts';
import { slotPlayerId } from '../../../shared/tfafLobby.ts';
import { errorMessage } from '../format.ts';
import { useGameSession } from './useGameSession.ts';

// Shared by the parts of the room, which all report to the same line.
const actionError = ref<string | null>(null);
// The start position under the pointer, on the map or in the roster: each answers the other.
const hoveredSpot = ref<number | null>(null);

/** The room of the TFAF lobby we are in, and what the user can do there. */
export function useTfafLobby() {
  const { state } = useGameSession();
  const view = computed(() => state.value.tfafLobby);
  const room = computed(() => view.value?.room ?? null);
  const hosting = computed(() => view.value?.hosting ?? false);
  const selfId = computed(() => view.value?.selfId ?? null);
  const members = computed(() => new Map<number, LobbyMember>((room.value?.members ?? []).map((member) => [member.id, member as LobbyMember])));
  const peers = computed(() => new Map<number, GamePeer>(state.value.peers.map((peer) => [peer.playerId, peer as GamePeer])));
  const self = computed(() => (selfId.value === null ? null : (members.value.get(selfId.value) ?? null)));
  const starting = computed(() => room.value?.phase === 'starting');
  const spotLocked = computed(() => view.value?.spotChangeLocked ?? false);
  /** A player who said they are ready stays as they are until they take it back. */
  const heldByReady = computed(() => !hosting.value && (self.value?.ready ?? false));

  async function run(work: () => Promise<void>): Promise<void> {
    actionError.value = null;
    try {
      await work();
    } catch (cause) {
      actionError.value = errorMessage(cause);
    }
  }

  /** The host changes every occupied slot, a player only their own. */
  function canChange(slot: LobbySlot): boolean {
    return !starting.value && slot.occupant !== null && (hosting.value || (slotPlayerId(slot) === selfId.value && !heldByReady.value));
  }

  return {
    state,
    view,
    room,
    hosting,
    selfId,
    self,
    members,
    peers,
    starting,
    spotLocked,
    heldByReady,
    hoveredSpot,
    error: actionError,
    canChange,
    run,
    act: (action: LobbyAction) => run(() => window.tfaf.tfafLobby.act(action)),
  };
}
