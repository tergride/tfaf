import { type Component, shallowRef } from 'vue';

/** A map to draw from its files: the folder the game knows it by, and how the opener titles it. */
export interface MapViewRequest {
  folderName: string;
  title: string;
  details?: string | null;
  /**
   * Live start markers instead of the map's own. Gets `place`, which turns a point of the square the map is centred in
   * (0..1) into percent of the frame, or null outside it.
   */
  spawnLayer?: Component;
}

const current = shallowRef<MapViewRequest | null>(null);

/** Opens the map view; the app has one, so a new map replaces the open one. */
export function showMapView(request: MapViewRequest): void {
  current.value = request;
}

export function useMapView() {
  return {
    current,
    close: () => {
      current.value = null;
    },
  };
}
