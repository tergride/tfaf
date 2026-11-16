import { shallowRef } from 'vue';

/** A picture to look at closely: a map preview, a mod thumbnail. */
export interface ImagePreview {
  title: string;
  details?: string | null;
  src: string | null | undefined;
  /** Shown when `src` does not load, e.g. the small preview of a map without a large one. */
  fallbackSrc?: string | null;
}

const current = shallowRef<ImagePreview | null>(null);

/** Opens the preview window; the app has one, so a new preview replaces the open one. */
export function showImagePreview(preview: ImagePreview): void {
  current.value = preview;
}

export function useImagePreview() {
  return {
    current,
    close: () => {
      current.value = null;
    },
  };
}
