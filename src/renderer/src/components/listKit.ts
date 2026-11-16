import type { RowData } from '@tanstack/vue-table';
import type { SortOrder } from '../../../shared/contract.ts';

export type ViewMode = 'cards' | 'table';

export interface ChipOption<T> {
  value: T;
  label: string;
}

/** Positions of the lowest and highest chosen steps of a range slider. */
export type StepRange = [number, number];

/** `4–8`, or `4` when both ends are on one step. */
export function rangeLabel(steps: readonly string[], [low, high]: StepRange): string {
  return low === high ? (steps[low] ?? '') : `${steps[low] ?? ''}–${steps[high] ?? ''}`;
}

/** A sort of a list; picking it sets its usual direction, which the user may flip. */
export interface SortOption<T> {
  value: T;
  label: string;
  order: SortOrder;
}

/** A filter in effect, shown as a pill the user can remove. */
export interface ActiveFilter {
  key: string;
  label: string;
}

declare module '@tanstack/vue-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- a merged declaration repeats the library's type parameters
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Classes of both the header and the cells, e.g. a width or a container query that hides the column. */
    class?: string;
    /** Numbers line up on the right. */
    numeric?: boolean;
  }
}
