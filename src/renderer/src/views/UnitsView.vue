<script setup lang="ts">
import { ExternalLink, RefreshCw } from '@lucide/vue';
import { ref } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UNIT_DATABASE_SITES, type UnitDatabaseId, unitDatabasePage } from '../../../shared/contract.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { openExternal } from '../lib/links.ts';

const DATABASES: { id: UnitDatabaseId; label: string }[] = [
  { id: 'spooky', label: 'Spooky DB' },
  { id: 'unitdb', label: 'FAF Unit DB' },
];

const selected = ref<UnitDatabaseId>('spooky');
// A database stays loaded once opened, so switching back keeps its filters and scroll position.
const opened = ref(new Set<UnitDatabaseId>(['spooky']));
const refreshing = ref(false);
const error = ref<string | null>(null);
// The page has another origin and cannot be reloaded from here, so a refresh gives it a new frame.
const frames = ref<Record<UnitDatabaseId, number>>({ spooky: 0, unitdb: 0 });

function select(id: unknown): void {
  const database = DATABASES.find((candidate) => candidate.id === id);
  if (database) {
    selected.value = database.id;
    opened.value = new Set([...opened.value, database.id]);
    error.value = null;
  }
}

function openInBrowser(): void {
  openExternal(`${UNIT_DATABASE_SITES[selected.value]}/`);
}

async function refresh(): Promise<void> {
  const id = selected.value;
  refreshing.value = true;
  error.value = null;
  try {
    await window.tfaf.unitDatabases.refresh(id);
    frames.value = { ...frames.value, [id]: frames.value[id] + 1 };
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    refreshing.value = false;
  }
}
</script>

<template>
  <section class="flex min-h-[480px] flex-1 flex-col gap-4 px-7 pt-3 pb-6">
    <header class="flex items-center justify-between gap-4">
      <h1 class="text-2xl">{{ t('units.title') }}</h1>
      <div class="flex items-center gap-2">
        <Tabs :model-value="selected" @update:model-value="select">
          <TabsList>
            <TabsTrigger v-for="database in DATABASES" :key="database.id" :value="database.id" class="px-4">
              {{ database.label }}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          variant="ghost"
          size="icon"
          :data-tooltip="t('units.refresh')"
          :aria-label="t('units.refresh')"
          :disabled="refreshing"
          @click="refresh"
        >
          <RefreshCw :class="{ 'animate-spin': refreshing }" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          :data-tooltip="t('units.openInBrowser')"
          :aria-label="t('units.openInBrowser')"
          @click="openInBrowser"
        >
          <ExternalLink />
        </Button>
      </div>
    </header>
    <Alert v-if="error" variant="destructive">
      <AlertDescription class="selectable">{{ error }}</AlertDescription>
    </Alert>
    <div class="relative min-h-0 flex-1 overflow-hidden border bg-background">
      <template v-for="database in DATABASES" :key="`${database.id}:${frames[database.id]}`">
        <iframe
          v-if="opened.has(database.id)"
          v-show="selected === database.id"
          :src="unitDatabasePage(database.id)"
          :aria-label="database.label"
          class="absolute inset-0 size-full border-0"
          sandbox="allow-scripts allow-same-origin allow-popups"
          referrerpolicy="no-referrer"
        />
      </template>
    </div>
  </section>
</template>
