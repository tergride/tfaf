<script setup lang="ts">
import { shallowRef, watch } from 'vue';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useConfirmDialog } from '../composables/useConfirm.ts';
import { t } from '../lib/i18n.ts';

const { pending, settle } = useConfirmDialog();
// The question stays on screen while the dialog plays its closing animation.
const shown = shallowRef(pending.value);
watch(pending, (next) => {
  if (next) {
    shown.value = next;
  }
});
</script>

<template>
  <AlertDialog :open="pending !== null" @update:open="(open) => !open && settle(false)">
    <AlertDialogContent v-if="shown">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ shown.title }}</AlertDialogTitle>
        <AlertDialogDescription :class="{ 'sr-only': !shown.description }">
          {{ shown.description ?? shown.title }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
        <!-- A plain button: AlertDialogAction closes the dialog first, which would settle it as cancelled. -->
        <Button :variant="shown.destructive ? 'destructive' : 'default'" @click="settle(true)">
          {{ shown.confirmText }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
