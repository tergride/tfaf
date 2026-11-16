<script setup lang="ts">
import { ExternalLink, Newspaper, RefreshCw } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import PreviewImage from '../components/PreviewImage.vue';
import { formatDate, joinParts } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { openExternal } from '../lib/links.ts';
import { queries, queryState } from '../lib/queries.ts';

const { data: news, loading, error, reload } = queryState(useQuery(queries.news()));
</script>

<template>
  <section class="flex min-h-full flex-col gap-4 px-7 pt-3 pb-8">
    <header class="flex items-center gap-5">
      <h1 class="text-2xl">{{ t('news.title') }}</h1>
      <Button
        variant="ghost"
        size="icon"
        class="ml-auto"
        :data-tooltip="t('news.refresh')"
        :aria-label="t('news.refresh')"
        :disabled="loading"
        @click="reload"
      >
        <RefreshCw :class="{ 'animate-spin': loading }" />
      </Button>
    </header>

    <Alert v-if="error" variant="destructive" class="flex items-center gap-3">
      <AlertDescription class="flex-1 selectable">{{ error }}</AlertDescription>
      <Button variant="outline" size="sm" @click="reload"><RefreshCw />{{ t('common.retry') }}</Button>
    </Alert>

    <div v-if="!news && loading" class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4.5">
      <Skeleton v-for="index in 6" :key="index" class="h-80" />
    </div>
    <Empty v-else-if="news && news.length === 0">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Newspaper /></EmptyMedia>
        <EmptyTitle>{{ t('news.empty') }}</EmptyTitle>
      </EmptyHeader>
    </Empty>
    <div v-else-if="news" class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4.5">
      <article
        v-for="item in news"
        :key="item.id"
        class="group plate cut-lg flex min-w-0 flex-col overflow-hidden bg-card transition-colors"
        :class="{ 'cursor-pointer hover:[--plate-border:var(--color-input)]': item.link }"
        @click="item.link && openExternal(item.link)"
      >
        <div class="aspect-video overflow-hidden bg-background">
          <PreviewImage :src="item.imageUrl" :fallback="item.title.slice(0, 1).toUpperCase()" lazy />
        </div>
        <div class="flex flex-1 flex-col gap-2 p-4">
          <h2 class="font-display text-lg leading-snug font-semibold">{{ item.title }}</h2>
          <p class="text-xs text-faint">{{ joinParts(formatDate(item.date), item.author) }}</p>
          <p class="text-sm whitespace-pre-line text-muted-foreground">{{ item.excerpt }}</p>
          <button
            v-if="item.link"
            type="button"
            class="mt-auto flex w-fit items-center gap-1.5 pt-1 text-sm text-primary outline-none group-hover:underline focus-visible:underline"
            @click.stop="openExternal(item.link)"
          >
            <ExternalLink class="size-3.5" />
            {{ t('news.readMore') }}
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
