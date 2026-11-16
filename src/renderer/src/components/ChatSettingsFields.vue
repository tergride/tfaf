<script setup lang="ts">
import { Plus, RotateCcw, X } from '@lucide/vue';
import { ref, toRaw } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  CHAT_COLOR_MODES,
  CHAT_LIMITS,
  CHAT_MESSAGE_LIMITS,
  CHAT_TEXT_SCALES,
  CHAT_USER_GROUPS,
  type ChatAutoJoin,
  type ChatPrefs,
  type ChatUserGroup,
} from '../../../shared/contract.ts';
import { t } from '../lib/i18n.ts';
import { DEFAULT_GROUP_COLORS } from '../lib/nickColors.ts';
import FilterChip from './FilterChip.vue';

// The same rule as the main process uses for the auto-join list.
const CHANNEL_NAME = /^#[^\s,\x00-\x1f]{1,49}$/;
// A group without a color of its own keeps the text color; the picker still needs one to start from.
const TEXT_COLOR = '#e5e7eb';

const props = defineProps<{ prefs: ChatPrefs }>();
const emit = defineEmits<{ change: [prefs: ChatPrefs] }>();

const channelDraft = ref('');
const channelError = ref<string | null>(null);

// Built from the raw values: Vue proxies in nested lists cannot cross IPC.
function change(patch: Partial<ChatPrefs>): void {
  emit('change', { ...toRaw(props.prefs), ...patch });
}

function changeAutoJoin(patch: Partial<ChatAutoJoin>): void {
  change({ autoJoin: { ...toRaw(props.prefs).autoJoin, ...patch } });
}

function addChannel(): void {
  const raw = channelDraft.value.trim();
  const name = raw.startsWith('#') ? raw : `#${raw}`;
  if (!CHANNEL_NAME.test(name)) {
    channelError.value = t('settings.chat.invalidChannel');
    return;
  }
  channelError.value = null;
  channelDraft.value = '';
  if (!props.prefs.autoJoin.channels.some((channel) => channel.toLowerCase() === name.toLowerCase())) {
    changeAutoJoin({ channels: [...props.prefs.autoJoin.channels, name] });
  }
}

function groupColor(group: ChatUserGroup): string {
  return props.prefs.groupColors[group] ?? DEFAULT_GROUP_COLORS[group] ?? TEXT_COLOR;
}

function setGroupColor(group: ChatUserGroup, color: string | null): void {
  const groupColors = { ...props.prefs.groupColors };
  if (color) {
    groupColors[group] = color.toLowerCase();
  } else {
    delete groupColors[group];
  }
  change({ groupColors });
}
</script>

<template>
  <Label class="flex cursor-pointer items-start gap-3 px-6 py-4 font-normal">
    <Switch
      :model-value="prefs.hideFoeMessages"
      class="mt-0.5"
      @update:model-value="(value) => change({ hideFoeMessages: value })"
    />
    <span class="flex flex-col gap-1">
      <span class="font-medium">{{ t('settings.chat.hideFoes') }}</span>
      <span class="text-[13px] text-muted-foreground">{{ t('settings.chat.hideFoesHint') }}</span>
    </span>
  </Label>
  <Separator />
  <div class="flex flex-col gap-3 px-6 py-4">
    <div class="flex flex-col gap-1">
      <span class="font-medium">{{ t('settings.chat.muted') }}</span>
      <span class="text-[13px] text-muted-foreground">{{ t('settings.chat.mutedHint') }}</span>
    </div>
    <div v-if="prefs.mutedUsers.length" class="flex flex-wrap gap-1.5">
      <span v-for="login in prefs.mutedUsers" :key="login" class="plate cut-xs flex h-7 items-center gap-1 bg-secondary pr-0.5 pl-2 text-[13px]">
        {{ login }}
        <Button
          variant="ghost"
          size="icon-xs"
          :data-tooltip="t('settings.chat.unmute', { nick: login })"
          :aria-label="t('settings.chat.unmute', { nick: login })"
          @click="change({ mutedUsers: prefs.mutedUsers.filter((entry) => entry !== login) })"
        >
          <X />
        </Button>
      </span>
    </div>
    <span v-else class="text-[13px] text-faint">{{ t('settings.chat.mutedNone') }}</span>
  </div>
  <Separator />
  <div class="flex flex-col gap-3 px-6 py-4">
    <div class="flex flex-col gap-1">
      <span class="font-medium">{{ t('settings.chat.colors') }}</span>
      <span class="text-[13px] text-muted-foreground">{{ t('settings.chat.colorsHint') }}</span>
    </div>
    <div class="flex flex-wrap gap-0.75" role="group" :aria-label="t('settings.chat.colors')">
      <FilterChip
        v-for="mode in CHAT_COLOR_MODES"
        :key="mode"
        :pressed="prefs.colorMode === mode"
        @toggle="mode !== prefs.colorMode && change({ colorMode: mode })"
      >
        {{ t(`settings.chat.colorModes.${mode}`) }}
      </FilterChip>
    </div>
    <div v-if="prefs.colorMode === 'groups'" class="grid grid-cols-2 gap-x-6 gap-y-2">
      <div v-for="group in CHAT_USER_GROUPS" :key="group" class="flex h-7 items-center gap-2.5 text-sm">
        <input
          type="color"
          class="h-6 w-8 shrink-0 cursor-pointer bg-transparent"
          :value="groupColor(group)"
          :aria-label="t(`chat.users.categories.${group}`)"
          @change="(event) => setGroupColor(group, (event.target as HTMLInputElement).value)"
        />
        <span :style="{ color: groupColor(group) }">{{ t(`chat.users.categories.${group}`) }}</span>
        <Button
          v-if="prefs.groupColors[group]"
          variant="ghost"
          size="icon-xs"
          :data-tooltip="t('settings.chat.resetGroupColor')"
          :aria-label="t('settings.chat.resetGroupColor')"
          @click="setGroupColor(group, null)"
        >
          <RotateCcw />
        </Button>
      </div>
    </div>
    <div v-if="Object.keys(prefs.userColors).length" class="flex items-center gap-3 text-[13px] text-muted-foreground">
      {{ t('settings.chat.userColors', { count: Object.keys(prefs.userColors).length }) }}
      <Button variant="outline" size="sm" @click="change({ userColors: {} })">{{ t('settings.chat.resetUserColors') }}</Button>
    </div>
  </div>
  <Separator />
  <Label class="flex cursor-pointer items-start gap-3 px-6 pt-4 pb-3 font-normal">
    <Switch :model-value="prefs.autoJoin.enabled" class="mt-0.5" @update:model-value="(value) => changeAutoJoin({ enabled: value })" />
    <span class="flex flex-col gap-1">
      <span class="font-medium">{{ t('settings.chat.autoJoin') }}</span>
      <span class="text-[13px] text-muted-foreground">{{ t('settings.chat.autoJoinHint') }}</span>
    </span>
  </Label>
  <div class="flex flex-col gap-3 px-6 pb-4" :class="{ 'opacity-50': !prefs.autoJoin.enabled }">
    <div class="flex flex-wrap items-center gap-1.5">
      <span
        v-for="channel in prefs.autoJoin.channels"
        :key="channel"
        class="plate cut-xs flex h-7 items-center gap-1 bg-secondary pr-0.5 pl-2 text-[13px]"
      >
        {{ channel }}
        <Button
          variant="ghost"
          size="icon-xs"
          :data-tooltip="t('settings.chat.removeChannel', { channel })"
          :aria-label="t('settings.chat.removeChannel', { channel })"
          @click="changeAutoJoin({ channels: prefs.autoJoin.channels.filter((entry) => entry !== channel) })"
        >
          <X />
        </Button>
      </span>
      <form class="flex items-center gap-1" @submit.prevent="addChannel">
        <Input
          v-model="channelDraft"
          class="h-7 w-36 text-[13px]"
          :placeholder="t('chat.channels.namePlaceholder')"
          :maxlength="CHAT_LIMITS.channelNameMaxLength"
          :aria-label="t('settings.chat.addChannel')"
          :aria-invalid="channelError !== null"
          @input="channelError = null"
        />
        <Button type="submit" variant="ghost" size="icon-xs" :data-tooltip="t('settings.chat.addChannel')" :aria-label="t('settings.chat.addChannel')" :disabled="!channelDraft.trim()">
          <Plus />
        </Button>
      </form>
    </div>
    <span v-if="channelError" class="text-[13px] text-destructive">{{ channelError }}</span>
    <div class="grid grid-cols-2 gap-x-6 gap-y-2.5">
      <Label class="cursor-pointer items-start gap-2.5 font-normal">
        <Switch
          :model-value="prefs.autoJoin.lobbyChannels"
          class="mt-0.5"
          @update:model-value="(value) => changeAutoJoin({ lobbyChannels: value })"
        />
        <span class="flex flex-col gap-0.5">
          {{ t('settings.chat.lobbyChannels') }}
          <span class="text-[13px] text-muted-foreground">{{ t('settings.chat.lobbyChannelsHint') }}</span>
        </span>
      </Label>
      <Label class="cursor-pointer items-start gap-2.5 font-normal">
        <Switch :model-value="prefs.autoJoin.newbie" class="mt-0.5" @update:model-value="(value) => changeAutoJoin({ newbie: value })" />
        <span class="flex flex-col gap-0.5">
          {{ t('settings.chat.newbie') }}
          <span class="text-[13px] text-muted-foreground">{{ t('settings.chat.newbieHint') }}</span>
        </span>
      </Label>
    </div>
  </div>
  <Separator />
  <div class="flex flex-col gap-3 px-6 py-4">
    <span class="font-medium">{{ t('settings.chat.textScale') }}</span>
    <div class="flex flex-wrap gap-0.75" role="group" :aria-label="t('settings.chat.textScale')">
      <FilterChip
        v-for="scale in CHAT_TEXT_SCALES"
        :key="scale"
        :pressed="prefs.textScale === scale"
        @toggle="scale !== prefs.textScale && change({ textScale: scale })"
      >
        {{ scale }} %
      </FilterChip>
    </div>
    <div class="flex flex-col gap-1">
      <span class="font-medium">{{ t('settings.chat.messageLimit') }}</span>
      <span class="text-[13px] text-muted-foreground">{{ t('settings.chat.messageLimitHint') }}</span>
    </div>
    <div class="flex flex-wrap gap-0.75" role="group" :aria-label="t('settings.chat.messageLimit')">
      <FilterChip
        v-for="limit in CHAT_MESSAGE_LIMITS"
        :key="limit"
        :pressed="prefs.messageLimit === limit"
        @toggle="limit !== prefs.messageLimit && change({ messageLimit: limit })"
      >
        {{ limit }}
      </FilterChip>
    </div>
  </div>
  <Separator />
  <Label class="flex cursor-pointer items-start gap-3 px-6 py-4 font-normal">
    <Switch :model-value="prefs.showGameMap" class="mt-0.5" @update:model-value="(value) => change({ showGameMap: value })" />
    <span class="flex flex-col gap-1">
      <span class="font-medium">{{ t('settings.chat.showGameMap') }}</span>
      <span class="text-[13px] text-muted-foreground">{{ t('settings.chat.showGameMapHint') }}</span>
    </span>
  </Label>
</template>
