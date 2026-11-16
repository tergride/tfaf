import { type ColumnDef, getCoreRowModel, type SortingState, type Table, useVueTable } from '@tanstack/vue-table';
import { computed, type WritableComputedRef } from 'vue';
import type { SortOrder } from '../../../shared/contract.ts';

export interface ListSort<F extends string> {
  field: F;
  order: SortOrder;
}

export interface ListTableOptions<T, F extends string> {
  data: () => T[];
  columns: ColumnDef<T>[];
  rowId: (row: T) => string;
  /** The list's own sort, also set from the toolbar; without it the headers do not sort. */
  sort?: ListSort<F>;
  /** Sort field of each column that can sort the list. */
  sortFields?: Partial<Record<string, F>>;
}

/**
 * A table over a list that is already sorted, by the server or by the view: clicking a column header changes the
 * list's sort, which the toolbar shows too. A sort without a column of its own marks no header.
 */
export function useListTable<T, F extends string>(options: ListTableOptions<T, F>): Table<T> {
  const { sort, sortFields = {} } = options;
  const sorting: WritableComputedRef<SortingState> = computed({
    get: () => {
      const id = Object.keys(sortFields).find((key) => sortFields[key] === sort?.field);
      return sort && id ? [{ id, desc: sort.order === 'desc' }] : [];
    },
    set: ([next]) => {
      const field = next ? sortFields[next.id] : undefined;
      if (sort && next && field) {
        sort.field = field;
        sort.order = next.desc ? 'desc' : 'asc';
      }
    },
  });
  return useVueTable({
    get data() {
      return options.data();
    },
    columns: options.columns.map((column) => ({
      ...column,
      enableSorting: column.id !== undefined && column.id in sortFields,
    })),
    getRowId: options.rowId,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    state: {
      get sorting() {
        return sorting.value;
      },
    },
    onSortingChange: (updater) => {
      sorting.value = typeof updater === 'function' ? updater(sorting.value) : updater;
    },
  });
}
