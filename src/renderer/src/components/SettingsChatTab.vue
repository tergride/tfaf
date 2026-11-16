<script setup lang="ts">
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import type { ChatPrefs, Settings } from '../../../shared/contract.ts';
import { setChatPrefs } from '../composables/useChatPrefs.ts';
import { t } from '../lib/i18n.ts';
import ChatSettingsFields from './ChatSettingsFields.vue';
import type { SettingsUpdate } from './settingsTab.ts';

const props = defineProps<{ settings: Settings; update: SettingsUpdate }>();

async function updateChat(prefs: ChatPrefs): Promise<void> {
  const saved = await props.update({ chat: prefs });
  if (saved) {
    setChatPrefs(saved.chat);
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <Card class="gap-0 py-0">
      <CardHeader class="border-b py-4">
        <CardTitle>{{ t('settings.chat.title') }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col px-0">
        <Label class="flex cursor-pointer items-start gap-3 px-6 py-4 font-normal" :class="{ 'opacity-50': !settings.notifications.desktop }">
          <Switch
            :model-value="settings.chatNotifications"
            class="mt-0.5"
            :disabled="!settings.notifications.desktop"
            @update:model-value="(value) => update({ chatNotifications: value })"
          />
          <span class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.chat.notifications') }}</span>
            <span class="text-[13px] text-muted-foreground">
              {{ t(settings.notifications.desktop ? 'settings.chat.notificationsHint' : 'settings.chat.notificationsDesktopOff') }}
            </span>
          </span>
        </Label>
        <Separator />
        <ChatSettingsFields :prefs="settings.chat" @change="updateChat" />
      </CardContent>
    </Card>
  </div>
</template>
