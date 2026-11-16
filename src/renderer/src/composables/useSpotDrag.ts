import { ref } from 'vue';
import type { LobbySlot } from '../../../shared/contract.ts';
import { useTfafLobby } from './useTfafLobby.ts';

const dragged = ref<number | null>(null);
const target = ref<number | null>(null);

function finish(): void {
  dragged.value = null;
  target.value = null;
}

/** The host swaps players by dragging them between start positions, in the roster and on the map. */
export function useSpotDrag() {
  const { hosting, starting, spotLocked, act } = useTfafLobby();

  const canDrag = (slot: LobbySlot): boolean => hosting.value && !starting.value && !spotLocked.value && slot.occupant !== null;
  const accepts = (slot: LobbySlot): boolean => dragged.value !== null && dragged.value !== slot.spot && !slot.closed;

  /** Handlers of what the host grabs. The drag picture is the element marked `data-drag-image` around it, if any. */
  function dragSource(slot: LobbySlot) {
    return {
      dragstart(event: DragEvent): void {
        dragged.value = slot.spot;
        const transfer = event.dataTransfer;
        if (!transfer) {
          return;
        }
        transfer.effectAllowed = 'move';
        transfer.setData('text/plain', String(slot.spot));
        const picture = (event.currentTarget as HTMLElement).closest('[data-drag-image]');
        if (picture) {
          const rect = picture.getBoundingClientRect();
          transfer.setDragImage(picture, event.clientX - rect.left, event.clientY - rect.top);
        }
      },
      dragend: finish,
    };
  }

  function dropTarget(slot: LobbySlot) {
    // Entering a child of the target counts too: a drop right after it is refused otherwise.
    function allow(event: DragEvent): void {
      if (accepts(slot)) {
        event.preventDefault();
        target.value = slot.spot;
      }
    }
    return {
      dragenter: allow,
      dragover: allow,
      dragleave(event: DragEvent): void {
        const element = event.currentTarget as HTMLElement;
        if (target.value === slot.spot && !element.contains(event.relatedTarget as Node | null)) {
          target.value = null;
        }
      },
      drop(event: DragEvent): void {
        if (dragged.value !== null && accepts(slot)) {
          event.preventDefault();
          void act({ type: 'swapSpots', from: dragged.value, to: slot.spot });
        }
        finish();
      },
    };
  }

  return { canDrag, dragSource, dropTarget, isDragged: (slot: LobbySlot) => dragged.value === slot.spot, isTarget: (slot: LobbySlot) => target.value === slot.spot };
}
