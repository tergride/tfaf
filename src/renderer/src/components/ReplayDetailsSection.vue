<script setup lang="ts">
import { Download } from '@lucide/vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { ReplayChatMessage, ReplayDetails, ReplayGameOption } from '../../../shared/contract.ts';
import { ru } from '../../../shared/i18n/ru.ts';
import { formatClock } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { nickColor } from '../lib/nickColors.ts';

// The settings and the chat that only the replay file holds. A vault replay is downloaded on request (`loadable`).
defineProps<{ details: ReplayDetails | null; loading: boolean; error: string | null; loadable: boolean }>();
defineEmits<{ load: [] }>();

type KnownOption = keyof typeof ru.replays.options;

function isKnownOption(key: string): key is KnownOption {
  return Object.hasOwn(ru.replays.options, key);
}

function optionLabel(option: ReplayGameOption): string {
  return isKnownOption(option.key) ? t(`replays.options.${option.key}`) : option.key;
}

function optionValue(option: ReplayGameOption): string {
  if (typeof option.value === 'boolean') {
    return option.value ? t('replays.details.yes') : t('replays.details.no');
  }
  return String(option.value);
}

function addressee(message: ReplayChatMessage): string {
  return message.to === 'all' || message.to === 'allies' ? t(`replays.details.to.${message.to}`) : message.to;
}

const sectionTitle = 'font-sans text-xs font-normal text-muted-foreground';
</script>

<template>
  <div class="flex flex-col gap-3.5">
    <Alert v-if="error" variant="destructive">
      <AlertDescription class="selectable">{{ error }}</AlertDescription>
    </Alert>
    <div v-if="loading" class="flex items-center gap-2 text-[13px] text-muted-foreground">
      <Spinner />{{ t('replays.details.loading') }}
    </div>
    <div v-else-if="!details && loadable" class="flex flex-col gap-1.5">
      <Button variant="outline" @click="$emit('load')"><Download />{{ t('replays.details.load') }}</Button>
      <p class="text-xs text-muted-foreground">{{ t('replays.details.loadHint') }}</p>
    </div>

    <template v-if="details">
      <section class="flex flex-col gap-1">
        <h3 :class="sectionTitle">{{ t('replays.details.options') }}</h3>
        <dl class="flex flex-col gap-px border bg-border text-[13px]">
          <div v-if="details.gameVersion !== null" class="flex gap-3 bg-background px-2.5 py-1.5">
            <dt class="w-2/5 shrink-0 text-muted-foreground">{{ t('replays.details.fafVersion') }}</dt>
            <dd class="min-w-0 wrap-anywhere tabular-nums selectable">{{ details.gameVersion }}</dd>
          </div>
          <div v-for="option in details.options" :key="option.key" class="flex gap-3 bg-background px-2.5 py-1.5">
            <dt class="w-2/5 shrink-0 wrap-anywhere text-muted-foreground" :data-tooltip="option.key">{{ optionLabel(option) }}</dt>
            <dd class="min-w-0 wrap-anywhere selectable">{{ optionValue(option) }}</dd>
          </div>
        </dl>
        <p v-if="details.options.length === 0" class="text-xs text-faint">{{ t('replays.details.noOptions') }}</p>
      </section>

      <section class="flex flex-col gap-1">
        <h3 :class="sectionTitle">{{ t('replays.details.chat') }}</h3>
        <ol v-if="details.chat.length" class="flex flex-col gap-px border bg-border text-[13px]">
          <li
            v-for="(message, index) in details.chat"
            :key="index"
            class="flex flex-col gap-0.5 bg-background px-2.5 py-1.5"
          >
            <span class="flex items-baseline gap-1.5 text-xs">
              <span class="text-faint tabular-nums">{{ formatClock(message.time) }}</span>
              <span class="truncate font-semibold" :style="{ color: nickColor(message.sender) }">{{ message.sender }}</span>
              <span class="shrink-0 text-muted-foreground">→ {{ addressee(message) }}</span>
            </span>
            <span class="wrap-anywhere selectable">{{ message.text }}</span>
          </li>
        </ol>
        <p v-else class="text-xs text-faint">{{ t('replays.details.noChat') }}</p>
      </section>
    </template>
  </div>
</template>
