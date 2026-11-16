<script setup lang="ts">
import {
  BookOpen,
  ExternalLink,
  FileText,
  FolderOpen,
  Heart,
  LifeBuoy,
  MessageCircleQuestionMark,
  MessagesSquare,
  Scale,
  MonitorPlay,
  Tv,
} from '@lucide/vue';
import { type Component, computed, ref } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { type AppFolder, VAULT_RULES_URL } from '../../../shared/contract.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import { useAuth } from '../composables/useAuth.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { openExternal } from '../lib/links.ts';

interface LinkItem {
  label: MessageKey;
  hint: MessageKey;
  url: string;
  icon: Component;
}

// The links of the official client (faf-client.links); the rules are those of the server the user is on.
const WEBSITES = { prod: 'https://www.faforever.com', test: 'https://www.faforever.xyz' } as const;

const auth = useAuth();
const website = computed(() => WEBSITES[auth.value?.status === 'signedIn' ? auth.value.server : 'prod']);
const folderError = ref<string | null>(null);

const groups = computed<{ title: MessageKey; items: LinkItem[] }[]>(() => [
  {
    title: 'links.groups.help',
    items: [
      { label: 'links.wiki', hint: 'links.wikiHint', url: 'https://wiki.faforever.com/', icon: BookOpen },
      { label: 'links.techForum', hint: 'links.techForumHint', url: 'https://forum.faforever.com/category/4/i-need-help', icon: MessageCircleQuestionMark },
      { label: 'links.techDiscord', hint: 'links.techDiscordHint', url: 'https://discord.gg/6W6HKfzcsj', icon: LifeBuoy },
      { label: 'links.rules', hint: 'links.rulesHint', url: `${website.value}/rules`, icon: Scale },
      { label: 'links.vaultRules', hint: 'links.vaultRulesHint', url: VAULT_RULES_URL, icon: FileText },
    ],
  },
  {
    title: 'links.groups.community',
    items: [
      { label: 'links.discord', hint: 'links.discordHint', url: 'https://discord.gg/PfGcWas', icon: MessagesSquare },
      { label: 'links.youtube', hint: 'links.youtubeHint', url: 'https://www.youtube.com/channel/UCkAWiUu4QE172kv-ZuyR42w', icon: MonitorPlay },
      { label: 'links.twitch', hint: 'links.twitchHint', url: 'https://twitch.tv/faflive', icon: Tv },
      { label: 'links.patreon', hint: 'links.patreonHint', url: 'https://www.patreon.com/faf', icon: Heart },
    ],
  },
]);

const FOLDERS: { folder: AppFolder; label: MessageKey }[] = [
  { folder: 'launcherLogs', label: 'app.folders.launcherLogs' },
  { folder: 'gameLogs', label: 'app.folders.gameLogs' },
  { folder: 'data', label: 'app.folders.data' },
];

async function openFolder(folder: AppFolder): Promise<void> {
  folderError.value = null;
  try {
    await window.tfaf.folders.open(folder);
  } catch (cause) {
    folderError.value = errorMessage(cause);
  }
}
</script>

<template>
  <section class="flex max-w-[880px] flex-col gap-6 px-7 pt-3 pb-8">
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl">{{ t('links.title') }}</h1>
      <p class="text-sm text-muted-foreground">{{ t('links.intro') }}</p>
    </div>

    <section v-for="group in groups" :key="group.title" class="flex flex-col gap-2">
      <h2 class="font-sans text-xs font-normal text-muted-foreground">{{ t(group.title) }}</h2>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
        <button
          v-for="item in group.items"
          :key="item.url"
          type="button"
          class="plate plate-focus cut-sm flex items-start gap-3 bg-card p-3.5 text-left transition-colors hover:bg-secondary"
          :data-tooltip="item.url"
          @click="openExternal(item.url)"
        >
          <component :is="item.icon" class="mt-0.5 size-5 shrink-0 text-primary" />
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="flex items-center gap-1.5 font-medium">{{ t(item.label) }}<ExternalLink class="size-3 text-faint" /></span>
            <span class="text-[13px] text-muted-foreground">{{ t(item.hint) }}</span>
          </span>
        </button>
      </div>
    </section>

    <section class="flex flex-col gap-2">
      <h2 class="font-sans text-xs font-normal text-muted-foreground">{{ t('links.groups.trouble') }}</h2>
      <p class="text-sm text-muted-foreground">{{ t('links.troubleHint') }}</p>
      <div class="flex flex-wrap gap-2">
        <Button v-for="item in FOLDERS" :key="item.folder" variant="outline" size="sm" @click="openFolder(item.folder)">
          <FolderOpen />{{ t(item.label) }}
        </Button>
      </div>
      <Alert v-if="folderError" variant="destructive"><AlertDescription class="selectable">{{ folderError }}</AlertDescription></Alert>
    </section>
  </section>
</template>
