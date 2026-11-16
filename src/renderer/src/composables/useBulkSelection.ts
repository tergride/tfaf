import { type ComputedRef, computed, ref, watch } from 'vue';

export interface BulkSelectionOptions<T> {
  /** The items shown now; an item that leaves the list (deleted, filtered out) leaves the selection too. */
  items: () => readonly T[];
  key: (item: T) => string;
  /** Items that cannot be acted on, such as official maps, have no checkbox to tick. */
  selectable?: (item: T) => boolean;
}

export interface BulkSelection<T> {
  count: ComputedRef<number>;
  selectableCount: ComputedRef<number>;
  selectedItems: ComputedRef<T[]>;
  /** For a checkbox that ticks them all: some ticked shows as indeterminate. */
  allState: ComputedRef<boolean | 'indeterminate'>;
  isSelectable(item: T): boolean;
  isSelected(item: T): boolean;
  toggle(item: T, selected: boolean): void;
  setAll(selected: boolean): void;
  clear(): void;
}

/** Ticked items of a list for actions on many at once, such as deleting installed maps. */
export function useBulkSelection<T>(options: BulkSelectionOptions<T>): BulkSelection<T> {
  const keys = ref(new Set<string>());
  const isSelectable = (item: T): boolean => options.selectable?.(item) ?? true;
  const selectableItems = computed(() => options.items().filter(isSelectable));

  watch(selectableItems, (items) => {
    const present = new Set(items.map(options.key));
    const kept = [...keys.value].filter((key) => present.has(key));
    if (kept.length !== keys.value.size) {
      keys.value = new Set(kept);
    }
  });

  const selectedItems = computed(() => selectableItems.value.filter((item) => keys.value.has(options.key(item))));
  const count = computed(() => selectedItems.value.length);
  const selectableCount = computed(() => selectableItems.value.length);

  return {
    count,
    selectableCount,
    selectedItems,
    allState: computed(() => (count.value === 0 ? false : count.value === selectableCount.value ? true : 'indeterminate')),
    isSelectable,
    isSelected: (item) => keys.value.has(options.key(item)),
    toggle(item, selected) {
      if (!isSelectable(item)) {
        return;
      }
      const next = new Set(keys.value);
      if (selected) {
        next.add(options.key(item));
      } else {
        next.delete(options.key(item));
      }
      keys.value = next;
    },
    setAll(selected) {
      keys.value = selected ? new Set(selectableItems.value.map(options.key)) : new Set();
    },
    clear() {
      keys.value = new Set();
    },
  };
}
