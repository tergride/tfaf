<script setup lang="ts">
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { t } from '../lib/i18n.ts';

defineProps<{ page: number; totalPages: number; disabled?: boolean }>();
defineEmits<{ change: [page: number] }>();
</script>

<template>
  <nav v-if="totalPages > 1" class="flex items-center justify-center gap-1" :aria-label="t('vault.pageNav.label')">
    <Button variant="ghost" size="icon-sm" :data-tooltip="t('vault.pageNav.first')" :aria-label="t('vault.pageNav.first')" :disabled="disabled || page <= 1" @click="$emit('change', 1)">
      <ChevronsLeft />
    </Button>
    <Button variant="ghost" size="sm" :disabled="disabled || page <= 1" @click="$emit('change', page - 1)">
      <ChevronLeft />
      {{ t('vault.pageNav.previous') }}
    </Button>
    <span class="min-w-24 text-center text-sm text-muted-foreground tabular-nums">
      {{ t('vault.pageNav.position', { page, total: totalPages }) }}
    </span>
    <Button variant="ghost" size="sm" :disabled="disabled || page >= totalPages" @click="$emit('change', page + 1)">
      {{ t('vault.pageNav.next') }}
      <ChevronRight />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      :data-tooltip="t('vault.pageNav.last')" :aria-label="t('vault.pageNav.last')"
      :disabled="disabled || page >= totalPages"
      @click="$emit('change', totalPages)"
    >
      <ChevronsRight />
    </Button>
  </nav>
</template>
