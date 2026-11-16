<script setup lang="ts">
import { Spinner } from '@/components/ui/spinner';
import { t } from '../lib/i18n.ts';
</script>

<template>
  <div class="grid min-h-0 flex-1 place-items-center p-7" role="status">
    <Spinner class="text-primary" />
    <span class="sr-only">{{ t('common.loading') }}</span>
  </div>
</template>
