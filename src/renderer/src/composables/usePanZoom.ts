import { computed, ref, shallowRef, toValue, type MaybeRefOrGetter } from 'vue';

const WHEEL_ZOOM_SPEED = 0.002;

/**
 * Zoom and drag of a picture in a frame. 1 fits the picture into the frame. The pan is the picture's shift from the
 * frame centre in frame sizes, so it survives a window resize; the picture always covers the whole frame.
 */
export function usePanZoom(maxZoom: MaybeRefOrGetter<number>) {
  const zoom = ref(1);
  const pan = ref({ x: 0, y: 0 });
  const drag = shallowRef<{ pointerId: number; clientX: number; clientY: number; pan: { x: number; y: number } } | null>(null);

  const transform = computed(() => `translate(${pan.value.x * 100}%, ${pan.value.y * 100}%) scale(${zoom.value})`);

  function reset(): void {
    zoom.value = 1;
    pan.value = { x: 0, y: 0 };
    drag.value = null;
  }

  function setPan(x: number, y: number): void {
    const limit = (zoom.value - 1) / 2;
    pan.value = { x: Math.min(limit, Math.max(-limit, x)), y: Math.min(limit, Math.max(-limit, y)) };
  }

  /** Zooms around the cursor: the point under it stays in place. */
  function onWheel(event: WheelEvent): void {
    const viewport = event.currentTarget as HTMLElement;
    const rect = viewport.getBoundingClientRect();
    const next = Math.min(toValue(maxZoom), Math.max(1, zoom.value * Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED)));
    const pointX = (event.clientX - rect.left) / rect.width - 0.5;
    const pointY = (event.clientY - rect.top) / rect.height - 0.5;
    const ratio = next / zoom.value;
    zoom.value = next;
    setPan(pointX - (pointX - pan.value.x) * ratio, pointY - (pointY - pan.value.y) * ratio);
    if (drag.value) {
      drag.value = { ...drag.value, clientX: event.clientX, clientY: event.clientY, pan: pan.value };
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || zoom.value === 1) {
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.value = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, pan: pan.value };
  }

  function onPointerMove(event: PointerEvent): void {
    const start = drag.value;
    if (!start || start.pointerId !== event.pointerId) {
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setPan(start.pan.x + (event.clientX - start.clientX) / rect.width, start.pan.y + (event.clientY - start.clientY) / rect.height);
  }

  function onPointerUp(event: PointerEvent): void {
    if (drag.value?.pointerId === event.pointerId) {
      drag.value = null;
    }
  }

  return { zoom, pan, drag, transform, reset, onWheel, onPointerDown, onPointerMove, onPointerUp };
}
