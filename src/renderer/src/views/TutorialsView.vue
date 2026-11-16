<script setup lang="ts">
import { ExternalLink, GraduationCap, Play, RefreshCw } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import type { Tutorial } from '../../../shared/contract.ts';
import type { CardBadge } from '../components/cardBadge.ts';
import DetailPanel from '../components/DetailPanel.vue';
import DetailPreview from '../components/DetailPreview.vue';
import ListLayout from '../components/ListLayout.vue';
import VaultCard from '../components/VaultCard.vue';
import { useGameSession } from '../composables/useGameSession.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { openExternal } from '../lib/links.ts';
import { queries, queryState } from '../lib/queries.ts';

const launchableBadges = computed<CardBadge[]>(() => [{ text: t('tutorials.withBot'), tone: 'accent' }]);

const { data: categories, loading, error, reload } = queryState(useQuery(queries.tutorials()));
const { state: session } = useGameSession();
const selected = ref<Tutorial | null>(null);
const launching = ref(false);
const launchError = ref<string | null>(null);

const inGame = computed(() => session.value.phase !== 'idle');

function open(tutorial: Tutorial): void {
  selected.value = tutorial;
  launchError.value = null;
}

function close(): void {
  selected.value = null;
}

async function launch(tutorial: Tutorial): Promise<void> {
  launching.value = true;
  launchError.value = null;
  try {
    await window.tfaf.tutorials.launch(tutorial.id);
    selected.value = null;
  } catch (cause) {
    launchError.value = errorMessage(cause);
  } finally {
    launching.value = false;
  }
}
</script>

<template>
  <ListLayout :panel-open="selected !== null" :placeholder="t('vault.detailPanel.placeholder.tutorials')" @close-panel="close">
    <template #header>
      <div class="mb-2 flex items-center gap-5">
        <h1 class="text-2xl">{{ t('tutorials.title') }}</h1>
        <Button
          variant="ghost"
          size="icon"
          class="ml-auto"
          :data-tooltip="t('tutorials.refresh')"
          :aria-label="t('tutorials.refresh')"
          :disabled="loading"
          @click="reload"
        >
          <RefreshCw :class="{ 'animate-spin': loading }" />
        </Button>
      </div>
      <p class="mb-4 max-w-200 text-sm text-muted-foreground">{{ t('tutorials.intro') }}</p>
    </template>

    <div class="flex flex-col gap-6">
      <Alert v-if="error" variant="destructive" class="flex items-center gap-3">
        <AlertDescription class="flex-1 selectable">{{ error }}</AlertDescription>
        <Button variant="outline" size="sm" @click="reload"><RefreshCw />{{ t('common.retry') }}</Button>
      </Alert>

      <div v-if="!categories && loading" class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4.5">
        <Skeleton v-for="index in 8" :key="index" class="aspect-square" />
      </div>
      <Empty v-else-if="categories && categories.length === 0">
        <EmptyHeader>
          <EmptyMedia variant="icon"><GraduationCap /></EmptyMedia>
          <EmptyTitle>{{ t('tutorials.empty') }}</EmptyTitle>
        </EmptyHeader>
      </Empty>
      <section v-for="category in categories ?? []" :key="category.name" class="flex flex-col gap-3">
        <h2 class="flex items-center gap-2 text-lg">
          {{ category.name }}
          <span class="font-sans text-sm font-normal text-muted-foreground tabular-nums">{{ category.tutorials.length }}</span>
        </h2>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4.5 pt-1.5">
          <VaultCard
            v-for="tutorial in category.tutorials"
            :key="tutorial.id"
            :title="tutorial.title"
            :image="tutorial.mapPreviewUrl ?? tutorial.imageUrl"
            :subtitle="tutorial.mapName ? t('tutorials.map', { map: tutorial.mapName }) : null"
            :badges="tutorial.launchable ? launchableBadges : []"
            :selected="selected?.id === tutorial.id"
            @open="open(tutorial)"
          />
        </div>
      </section>
    </div>

    <template #panel>
      <DetailPanel
        v-if="selected"
        :title="selected.title"
        :kind="selected.launchable ? t('tutorials.kind.scenario') : t('tutorials.kind.material')"
        :item-key="selected.id"
        @close="close"
      >
        <template v-if="selected.mapPreviewUrl || selected.imageUrl" #media>
          <DetailPreview
            :preview="{
              title: selected.mapName ?? selected.title,
              details: selected.mapName ? selected.title : null,
              src: selected.mapPreviewUrl ?? selected.imageUrl,
            }"
            :wide="!selected.mapPreviewUrl"
            :map-folder="selected.mapFolderName"
          />
        </template>
        <div v-if="selected.launchable || selected.mapName" class="flex flex-wrap gap-1.5">
          <Badge v-if="selected.launchable" variant="accent">{{ t('tutorials.withBot') }}</Badge>
          <Badge v-if="selected.mapName" variant="muted">{{ t('tutorials.map', { map: selected.mapName }) }}</Badge>
        </div>
        <p class="text-sm leading-relaxed whitespace-pre-line text-foreground/85 wrap-anywhere selectable">
          {{ selected.description || t('tutorials.noDescription') }}
        </p>
        <div v-if="selected.links.length" class="flex flex-col gap-1">
          <h3 class="font-sans text-xs font-normal text-muted-foreground">{{ t('tutorials.links') }}</h3>
          <ul class="flex flex-col gap-px border bg-border">
            <li v-for="link in selected.links" :key="link.url">
              <button
                type="button"
                class="flex w-full items-center gap-2 bg-background px-2.5 py-2 text-left text-[13px] text-info outline-none hover:bg-accent focus-visible:bg-accent"
                :data-tooltip="link.url"
                @click="openExternal(link.url)"
              >
                <ExternalLink class="size-3.5 shrink-0" />
                <span class="min-w-0 flex-1 wrap-anywhere">{{ link.label }}</span>
              </button>
            </li>
          </ul>
        </div>
        <Alert v-if="launchError" variant="destructive">
          <AlertDescription class="selectable">{{ launchError }}</AlertDescription>
        </Alert>

        <template v-if="selected.launchable" #actions>
          <Button size="lg" :disabled="launching || inGame" @click="selected && launch(selected)">
            <Spinner v-if="launching" />
            <Play v-else />
            {{ t('tutorials.start') }}
          </Button>
          <p v-if="inGame" class="text-xs text-muted-foreground">{{ t('tutorials.anotherGameRunning') }}</p>
        </template>
      </DetailPanel>
    </template>
  </ListLayout>
</template>
