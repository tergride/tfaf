<script setup lang="ts">
import { onActivated, onMounted, ref, useTemplateRef, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { PathField, PathsStatus, ServerInfo, Settings, SettingsPatch } from '../../../shared/contract.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import SettingsChatTab from '../components/SettingsChatTab.vue';
import SettingsForgedAllianceTab from '../components/SettingsForgedAllianceTab.vue';
import SettingsGameTab from '../components/SettingsGameTab.vue';
import SettingsGeneralTab from '../components/SettingsGeneralTab.vue';
import SettingsMaintenanceTab from '../components/SettingsMaintenanceTab.vue';
import SettingsNotificationsTab from '../components/SettingsNotificationsTab.vue';
import { useCloseQuestion } from '../composables/useCloseQuestion.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { localContent, refreshLists } from '../lib/queries.ts';

type SettingsTab = 'general' | 'game' | 'forgedAlliance' | 'chat' | 'notifications' | 'maintenance';

const TABS: { id: SettingsTab; label: MessageKey }[] = [
  { id: 'general', label: 'settings.tabs.general' },
  { id: 'game', label: 'settings.tabs.game' },
  { id: 'forgedAlliance', label: 'settings.tabs.forgedAlliance' },
  { id: 'chat', label: 'settings.tabs.chat' },
  { id: 'notifications', label: 'settings.tabs.notifications' },
  { id: 'maintenance', label: 'settings.tabs.maintenance' },
];

const tab = ref<SettingsTab>('general');
const page = useTemplateRef<HTMLElement>('page');
// Views scroll inside App.vue's <main>, so a tab opened from far down the previous one starts at its top.
watch(tab, () => page.value?.closest('main')?.scrollTo({ top: 0 }));
const settings = ref<Settings | null>(null);
const status = ref<PathsStatus | null>(null);
const servers = ref<ServerInfo[]>([]);
const error = ref<string | null>(null);

async function refresh(): Promise<void> {
  try {
    const [nextSettings, nextStatus, serverList] = await Promise.all([
      window.tfaf.settings.get(),
      window.tfaf.settings.pathsStatus(),
      window.tfaf.servers(),
    ]);
    settings.value = nextSettings;
    status.value = nextStatus;
    servers.value = serverList;
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}

async function pick(field: PathField): Promise<void> {
  error.value = null;
  try {
    settings.value = await window.tfaf.settings.pickPath(field);
    // Installed maps, mods and replays are read from these folders.
    void refreshLists(...localContent());
    status.value = await window.tfaf.settings.pathsStatus();
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}

async function update(patch: SettingsPatch): Promise<Settings | null> {
  error.value = null;
  try {
    settings.value = await window.tfaf.settings.update(patch);
    return settings.value;
  } catch (cause) {
    error.value = errorMessage(cause);
    return null;
  }
}

function showError(message: string | null): void {
  error.value = message;
}

function serverName(id: string): string {
  return servers.value.find((server) => server.id === id)?.name ?? id;
}

onMounted(refresh);
onActivated(refresh);
// The answer to the close question changes closeToTray behind this page.
watch(useCloseQuestion().answered, refresh);
</script>

<template>
  <!-- The header carries the page's top padding, so it already rests where it sticks and never moves on scroll. -->
  <section ref="page" class="flex max-w-[880px] flex-col gap-5 px-7 pb-8">
    <div class="sticky top-(--page-banner-height) z-5 -mx-7 -mb-3 flex flex-wrap items-center gap-x-5 gap-y-3 bg-background/90 px-7 py-3 backdrop-blur">
      <h1 class="text-2xl">{{ t('settings.title') }}</h1>
      <Tabs v-model="tab">
        <TabsList>
          <TabsTrigger v-for="item in TABS" :key="item.id" :value="item.id" class="px-4">{{ t(item.label) }}</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>

    <Alert v-if="error" variant="destructive">
      <AlertDescription class="selectable">{{ error }}</AlertDescription>
    </Alert>

    <!-- The tabs stay alive, so check results and a running cleanup survive switching between them. -->
    <KeepAlive v-if="settings && status">
      <SettingsGeneralTab v-if="tab === 'general'" :settings="settings" :update="update" :server-name="serverName(settings.server)" />
      <SettingsGameTab v-else-if="tab === 'game'" :settings="settings" :status="status" :update="update" @pick="pick" />
      <SettingsForgedAllianceTab v-else-if="tab === 'forgedAlliance'" />
      <SettingsChatTab v-else-if="tab === 'chat'" :settings="settings" :update="update" />
      <SettingsNotificationsTab v-else-if="tab === 'notifications'" :settings="settings" :update="update" />
      <SettingsMaintenanceTab v-else :settings="settings" :update="update" @error="showError" />
    </KeepAlive>
  </section>
</template>
