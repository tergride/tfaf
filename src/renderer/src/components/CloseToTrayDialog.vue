<script setup lang="ts">
import { ArrowDownToLine, Power } from '@lucide/vue';
import type { Component } from 'vue';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { WindowCloseAnswer } from '../../../shared/contract.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import { useCloseQuestion } from '../composables/useCloseQuestion.ts';
import { t } from '../lib/i18n.ts';

const { open, answer } = useCloseQuestion();

const CHOICES = [
  { answer: 'tray', icon: ArrowDownToLine, title: 'app.closeToTray.tray', detail: 'app.closeToTray.trayDetail' },
  { answer: 'quit', icon: Power, title: 'app.closeToTray.quit', detail: 'app.closeToTray.quitDetail' },
] as const satisfies readonly { answer: WindowCloseAnswer; icon: Component; title: MessageKey; detail: MessageKey }[];
</script>

<template>
  <AlertDialog :open="open" @update:open="(next) => !next && answer('cancel')">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t('app.closeToTray.message') }}</AlertDialogTitle>
        <AlertDialogDescription>{{ t('app.closeToTray.detail') }}</AlertDialogDescription>
      </AlertDialogHeader>
      <div class="grid gap-2">
        <button
          v-for="choice in CHOICES"
          :key="choice.answer"
          type="button"
          class="plate plate-focus cut-sm flex items-start gap-3 bg-background px-3 py-2.5 text-left transition-colors hover:bg-secondary"
          @click="answer(choice.answer)"
        >
          <component :is="choice.icon" class="mt-0.5 size-4 shrink-0 text-primary" />
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="text-sm font-medium">{{ t(choice.title) }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t(choice.detail) }}</span>
          </span>
        </button>
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
