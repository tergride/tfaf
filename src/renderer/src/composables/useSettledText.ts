import { onScopeDispose, type Ref, readonly, ref, watch } from 'vue';

const SETTLE_DELAY_MS = 400;

/**
 * The trimmed text of a search field once the user pauses typing, so a list is not asked for after every key.
 * Clearing the field applies at once, and so does `flush`, e.g. on Enter.
 */
export function useSettledText(source: () => string): { settled: Readonly<Ref<string>>; flush(): void } {
  const settled = ref(source().trim());
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush(): void {
    clearTimeout(timer);
    settled.value = source().trim();
  }

  watch(source, (text) => {
    clearTimeout(timer);
    if (text.trim()) {
      timer = setTimeout(flush, SETTLE_DELAY_MS);
    } else {
      flush();
    }
  });
  onScopeDispose(() => clearTimeout(timer));

  return { settled: readonly(settled), flush };
}
