<script setup lang="ts">
import { Play, Volume2, VolumeX } from '@lucide/vue';
import { ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  type NotificationPrefs,
  type Settings,
  SOUND_IDS,
  type SoundId,
  TOAST_POSITIONS,
  TOAST_SECONDS,
} from '../../../shared/contract.ts';
import { setNotificationPrefs } from '../composables/useNotifications.ts';
import { t } from '../lib/i18n.ts';
import { playSound, setSoundVolume } from '../lib/sounds.ts';
import FilterChip from './FilterChip.vue';
import type { SettingsUpdate } from './settingsTab.ts';

const props = defineProps<{ settings: Settings; update: SettingsUpdate }>();

const FRIEND_EVENTS = ['friendOnline', 'friendOffline', 'friendJoinedGame', 'friendStartedPlaying'] as const;

async function updateNotifications(patch: Partial<NotificationPrefs>): Promise<void> {
  const saved = await props.update({ notifications: { ...props.settings.notifications, ...patch } });
  if (saved) {
    setNotificationPrefs(saved.notifications);
  }
}

function updateSound(sound: SoundId, enabled: boolean): void {
  void props.update({ sounds: { ...props.settings.sounds, [sound]: enabled } });
}

// The slider moves freely; the volume is saved once it is let go.
const volume = ref<number | null>(null);

function setVolume(value: number[] | undefined): void {
  volume.value = value?.[0] ?? null;
}

async function saveVolume(value: number[]): Promise<void> {
  const percent = value[0];
  if (percent === undefined) {
    return;
  }
  setSoundVolume(percent);
  await props.update({ soundVolume: percent });
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <Card class="gap-0 py-0">
      <CardHeader class="border-b py-4">
        <CardTitle>{{ t('settings.notifications.title') }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col px-0">
        <Label class="flex cursor-pointer items-start gap-3 px-6 py-4 font-normal">
          <Switch
            :model-value="settings.notifications.toasts"
            class="mt-0.5"
            @update:model-value="(value) => updateNotifications({ toasts: value })"
          />
          <span class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.notifications.toasts') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.notifications.toastsHint') }}</span>
          </span>
        </Label>
        <div class="flex flex-col gap-3 px-6 pb-4" :class="{ 'opacity-50': !settings.notifications.toasts }">
          <span class="text-[13px] text-muted-foreground">{{ t('settings.notifications.position') }}</span>
          <div class="flex flex-wrap gap-0.75" role="group" :aria-label="t('settings.notifications.position')">
            <FilterChip
              v-for="position in TOAST_POSITIONS"
              :key="position"
              :pressed="settings.notifications.toastPosition === position"
              @toggle="updateNotifications({ toastPosition: position })"
            >
              {{ t(`settings.notifications.positions.${position}`) }}
            </FilterChip>
          </div>
          <span class="text-[13px] text-muted-foreground">{{ t('settings.notifications.duration') }}</span>
          <div class="flex flex-wrap gap-0.75" role="group" :aria-label="t('settings.notifications.duration')">
            <FilterChip
              v-for="seconds in TOAST_SECONDS"
              :key="seconds"
              :pressed="settings.notifications.toastSeconds === seconds"
              @toggle="updateNotifications({ toastSeconds: seconds })"
            >
              {{ t('settings.notifications.seconds', { seconds }) }}
            </FilterChip>
          </div>
        </div>
        <Separator />
        <Label class="flex cursor-pointer items-start gap-3 px-6 py-4 font-normal">
          <Switch
            :model-value="settings.notifications.desktop"
            class="mt-0.5"
            @update:model-value="(value) => updateNotifications({ desktop: value })"
          />
          <span class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.notifications.desktop') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.notifications.desktopHint') }}</span>
          </span>
        </Label>
        <Separator />
        <div class="flex flex-col gap-3 px-6 py-4">
          <div class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.notifications.friends') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.notifications.friendsHint') }}</span>
          </div>
          <div class="grid grid-cols-2 gap-x-6 gap-y-2.5">
            <Label v-for="event in FRIEND_EVENTS" :key="event" class="cursor-pointer gap-2.5 font-normal">
              <Switch
                :model-value="settings.notifications[event]"
                @update:model-value="(value) => updateNotifications({ [event]: value })"
              />
              {{ t(`settings.notifications.friendEvents.${event}`) }}
            </Label>
          </div>
        </div>
        <Separator />
        <Label class="flex cursor-pointer items-start gap-3 px-6 py-4 font-normal">
          <Switch
            :model-value="settings.notifications.afterGameReview"
            class="mt-0.5"
            @update:model-value="(value) => updateNotifications({ afterGameReview: value })"
          />
          <span class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.notifications.afterGameReview') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.notifications.afterGameReviewHint') }}</span>
          </span>
        </Label>
        <Separator />
        <Label class="flex cursor-pointer items-start gap-3 px-6 py-4 font-normal">
          <Switch
            :model-value="settings.notifications.whatsNew"
            class="mt-0.5"
            @update:model-value="(value) => updateNotifications({ whatsNew: value })"
          />
          <span class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.notifications.whatsNew') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.notifications.whatsNewHint') }}</span>
          </span>
        </Label>
      </CardContent>
    </Card>

    <Card class="gap-0 py-0">
      <CardHeader class="border-b py-4">
        <CardTitle>{{ t('settings.sounds.title') }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col px-0">
        <div class="flex flex-col gap-3 px-6 py-4">
          <div class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.sounds.volume') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.sounds.volumeHint') }}</span>
          </div>
          <div class="flex items-center gap-4">
            <component :is="(volume ?? settings.soundVolume) === 0 ? VolumeX : Volume2" class="size-5 shrink-0 text-muted-foreground" />
            <Slider
              :model-value="[volume ?? settings.soundVolume]"
              :min="0"
              :max="100"
              :step="5"
              class="max-w-80"
              :aria-label="t('settings.sounds.volume')"
              @update:model-value="setVolume"
              @value-commit="saveVolume"
            />
            <span class="w-12 text-right text-sm tabular-nums">{{ volume ?? settings.soundVolume }}%</span>
            <Button variant="outline" size="sm" :disabled="(volume ?? settings.soundVolume) === 0" @click="playSound('matchFound')">
              <Play />{{ t('settings.sounds.test') }}
            </Button>
          </div>
        </div>
        <Separator />
        <div class="flex flex-col gap-3 px-6 py-4">
          <div class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.sounds.events') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.sounds.eventsHint') }}</span>
          </div>
          <div class="grid grid-cols-2 gap-x-6 gap-y-2.5">
            <Label v-for="sound in SOUND_IDS" :key="sound" class="cursor-pointer gap-2.5 font-normal">
              <Switch :model-value="settings.sounds[sound]" @update:model-value="(value) => updateSound(sound, value)" />
              {{ t(`settings.sounds.ids.${sound}`) }}
            </Label>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
