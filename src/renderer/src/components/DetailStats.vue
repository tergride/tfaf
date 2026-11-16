<script setup lang="ts">
export interface DetailStat {
  label: string;
  value: string | number | null | undefined;
  note?: string | null;
}

defineProps<{ items: DetailStat[] }>();
</script>

<template>
  <dl class="grid grid-cols-2 gap-px border bg-border">
    <!-- The last of an odd number spans the row, so no seam shows through the gap. -->
    <div
      v-for="(item, index) in items"
      :key="item.label"
      class="min-w-0 bg-card px-3 py-2"
      :class="{ 'col-span-2': items.length % 2 === 1 && index === items.length - 1 }"
    >
      <dt class="text-xs text-muted-foreground">{{ item.label }}</dt>
      <dd class="mt-0.5 font-display text-[15px] font-medium wrap-anywhere tabular-nums selectable">
        {{ item.value ?? '—' }}
        <small v-if="item.note" class="font-sans text-xs font-normal text-muted-foreground">{{ item.note }}</small>
      </dd>
    </div>
  </dl>
</template>
