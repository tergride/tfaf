<script setup lang="ts" generic="T">
import { ArrowDown, ArrowUp } from '@lucide/vue';
import { FlexRender, type Row, type SortDirection, type Table } from '@tanstack/vue-table';
import { computed, nextTick, useTemplateRef } from 'vue';
import type { BulkSelection } from '../composables/useBulkSelection.ts';
import { t } from '../lib/i18n.ts';
import BulkCheckbox from './BulkCheckbox.vue';

// Cells are drawn by the `cell-<column id>` slots, or show the column's value as text. `highlighted` marks rows that
// deserve attention, such as games with friends in them. With `selection` the first column ticks rows for bulk actions,
// and Space ticks the focused row instead of opening it.
const props = defineProps<{
  table: Table<T>;
  label: string;
  selectedId?: string | null;
  loading?: boolean;
  highlighted?: (row: T) => boolean;
  selection?: BulkSelection<T>;
  /** The name of a row for its checkbox, e.g. "Select Seton's Clutch". */
  rowLabel?: (row: T) => string;
}>();
const emit = defineEmits<{ select: [row: T]; activate: [row: T] }>();
defineSlots<Record<`cell-${string}`, (props: { row: T }) => unknown>>();

const body = useTemplateRef<HTMLTableSectionElement>('body');
// The look of every body cell: hover, keyboard focus, the row open in the panel, a highlighted and a ticked row.
const CELL =
  'h-13 border-b border-border/60 whitespace-nowrap transition-colors group-hover:bg-card group-focus-visible:bg-card group-focus-visible:shadow-[inset_0_1px_0_var(--color-ring),inset_0_-1px_0_var(--color-ring)] group-data-[checked=true]:bg-primary/4 group-data-[selected=true]:bg-primary/7 first:group-data-[selected=true]:shadow-[inset_3px_0_0_var(--color-primary)] group-data-[highlighted=true]:bg-info/7 first:group-data-[highlighted=true]:shadow-[inset_3px_0_0_var(--color-info)]';

// Tab enters the table once, on the picked row or the first one; arrows move between rows.
const tabbableId = computed(() => {
  const rows = props.table.getRowModel().rows;
  return rows.find((row) => row.id === props.selectedId)?.id ?? rows[0]?.id ?? null;
});

function ariaSort(direction: false | SortDirection): 'ascending' | 'descending' | undefined {
  return direction === false ? undefined : direction === 'asc' ? 'ascending' : 'descending';
}

/** Arrows move through the rows and pick the row they land on, the way a list with a detail panel is browsed. */
async function onKeydown(event: KeyboardEvent, row: Row<T>, index: number): Promise<void> {
  if (event.key === ' ' && props.selection) {
    event.preventDefault();
    props.selection.toggle(row.original, !props.selection.isSelected(row.original));
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    emit('select', row.original);
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
    return;
  }
  event.preventDefault();
  const rows = props.table.getRowModel().rows;
  const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
  if (next) {
    emit('select', next.original);
    await nextTick();
    body.value?.querySelector<HTMLElement>(`tr[data-row-id="${CSS.escape(next.id)}"]`)?.focus();
  }
}
</script>

<template>
  <table class="w-full border-separate border-spacing-0 text-[13px]" :aria-label="label" :aria-busy="loading">
    <thead>
      <tr v-for="group in table.getHeaderGroups()" :key="group.id">
        <th v-if="selection" class="sticky top-0 z-1 h-9 w-10 border-b bg-background pr-1 pl-3">
          <BulkCheckbox
            class="align-middle"
            :checked="selection.allState.value"
            :label="t('vault.bulk.selectAll')"
            :disabled="selection.selectableCount.value === 0"
            @change="selection.setAll"
          />
        </th>
        <th
          v-for="header in group.headers"
          :key="header.id"
          class="sticky top-0 z-1 h-9 border-b bg-background px-2.5 font-medium whitespace-nowrap text-muted-foreground"
          :class="[header.column.columnDef.meta?.class, header.column.columnDef.meta?.numeric ? 'text-right' : 'text-left']"
          :aria-sort="ariaSort(header.column.getIsSorted())"
        >
          <!-- Columns hold no values (the slots draw them), and TanStack only sorts columns with values; the list
               is sorted outside the table anyway, so the column's own setting decides. -->
          <button
            v-if="header.column.columnDef.enableSorting"
            type="button"
            class="inline-flex items-center gap-1 outline-none hover:text-foreground focus-visible:text-foreground focus-visible:underline"
            :class="{ 'text-foreground': header.column.getIsSorted() }"
            @click="header.column.toggleSorting(undefined, false)"
          >
            <FlexRender :render="header.column.columnDef.header" :props="header.getContext()" />
            <ArrowUp v-if="header.column.getIsSorted() === 'asc'" class="size-3.5 text-primary" />
            <ArrowDown v-else-if="header.column.getIsSorted() === 'desc'" class="size-3.5 text-primary" />
          </button>
          <FlexRender v-else :render="header.column.columnDef.header" :props="header.getContext()" />
        </th>
      </tr>
    </thead>
    <tbody ref="body" class="transition-opacity" :class="{ 'pointer-events-none opacity-50': loading }">
      <tr
        v-for="(row, index) in table.getRowModel().rows"
        :key="row.id"
        :data-row-id="row.id"
        :data-selected="row.id === selectedId"
        :data-highlighted="row.id !== selectedId && (highlighted?.(row.original) ?? false)"
        :data-checked="selection?.isSelected(row.original) ?? false"
        :aria-current="row.id === selectedId ? 'true' : undefined"
        :tabindex="tabbableId === row.id ? 0 : -1"
        class="group cursor-pointer outline-none"
        @click="emit('select', row.original)"
        @dblclick="emit('activate', row.original)"
        @keydown="onKeydown($event, row, index)"
      >
        <!-- The whole cell ticks the row, not only the small box. -->
        <td
          v-if="selection"
          :class="CELL"
          class="w-10 pr-1 pl-3"
          @click.stop="selection.toggle(row.original, !selection.isSelected(row.original))"
          @dblclick.stop
        >
          <BulkCheckbox
            class="align-middle"
            :checked="selection.isSelected(row.original)"
            :label="rowLabel ? t('vault.bulk.select', { name: rowLabel(row.original) }) : t('vault.bulk.selectRow')"
            :disabled="!selection.isSelectable(row.original)"
            @change="(checked) => selection?.toggle(row.original, checked)"
          />
        </td>
        <td
          v-for="cell in row.getVisibleCells()"
          :key="cell.id"
          :class="[CELL, 'px-2.5', cell.column.columnDef.meta?.class, { 'text-right tabular-nums': cell.column.columnDef.meta?.numeric }]"
        >
          <slot :name="`cell-${cell.column.id}`" :row="row.original">
            <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
          </slot>
        </td>
      </tr>
    </tbody>
  </table>
</template>
