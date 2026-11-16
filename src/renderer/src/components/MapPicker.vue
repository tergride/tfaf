<script setup lang="ts">
import { Map, Sparkles, TriangleAlert } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, defineAsyncComponent, ref } from 'vue';
import { Button } from '@/components/ui/button';
import type { LocalMap, VaultMap } from '../../../shared/contract.ts';
import type { ImagePreview } from '../composables/useImagePreview.ts';
import { useRecentMaps } from '../composables/useRecentMaps.ts';
import { useStoredMode } from '../composables/useViewMode.ts';
import { joinParts, mapDisplayName, mapSizeLabel, playersLabel } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { queries } from '../lib/queries.ts';
import ImagePreviewButton from './ImagePreviewButton.vue';
import type { MapChoice } from './MapBrowserDialog.vue';
import MapViewButton from './MapViewButton.vue';
import PreviewImage from './PreviewImage.vue';
import StatusLamp from './StatusLamp.vue';
import LobbyMapRender from './tfafLobby/LobbyMapRender.vue';

const GenerateMapDialog = defineAsyncComponent(() => import('./GenerateMapDialog.vue'));
const MapBrowserDialog = defineAsyncComponent(() => import('./MapBrowserDialog.vue'));

// The chosen map, large; another one is picked in the map browser, among the recent ones or made by the generator.
const props = defineProps<{ installed: LocalMap[]; invalid?: boolean }>();
const model = defineModel<string>({ required: true });

const VIEWS = ['preview', 'render'] as const;
const RECENT_SHOWN = 3;

const view = useStoredMode('tfaf.mapPicker.view', VIEWS, 'preview');
const browserOpen = ref(false);
const generatorOpen = ref(false);
// A vault map is downloaded when the game is created, not when it is picked; its details are kept for the summary.
const pickedVault = ref<VaultMap | null>(null);

function sameFolder(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

const selected = computed(() => props.installed.find((map) => sameFolder(map.folderName, model.value)) ?? null);
const pending = computed(() =>
  !selected.value && pickedVault.value && sameFolder(pickedVault.value.folderName, model.value) ? pickedVault.value : null,
);
const title = computed(() => selected.value?.displayName ?? pending.value?.displayName ?? mapDisplayName(model.value));
const details = computed(() => {
  const map = selected.value ?? pending.value;
  return map ? joinParts(playersLabel(map.maxPlayers), mapSizeLabel(map.widthPx, map.heightPx)) : null;
});
const preview = computed<ImagePreview>(() => ({
  title: title.value,
  details: joinParts(details.value, model.value),
  src: selected.value?.previewLargeUrl ?? pending.value?.thumbnailUrlLarge ?? null,
  fallbackSrc: selected.value?.previewUrl ?? pending.value?.thumbnailUrlSmall ?? null,
}));

const onDiskQuery = useQuery(() => ({ ...queries.mapOnDisk(model.value), enabled: model.value !== '' }));
const canRender = computed(() => onDiskQuery.data.value === true);
const rendering = computed(() => view.value === 'render' && canRender.value);

const recentMaps = useRecentMaps();
const recent = computed(() =>
  recentMaps.value
    .filter((folderName) => !sameFolder(folderName, model.value))
    .map((folderName) => props.installed.find((map) => sameFolder(map.folderName, folderName)))
    .filter((map): map is LocalMap => map !== undefined)
    .slice(0, RECENT_SHOWN),
);

function choose(choice: MapChoice): void {
  pickedVault.value = choice.vaultMap;
  model.value = choice.folderName;
}

function chooseInstalled(folderName: string): void {
  pickedVault.value = null;
  model.value = folderName;
}
</script>

<template>
  <div
    class="plate cut-lg flex min-h-0 flex-1 flex-col gap-3 bg-card p-3.5"
    :class="{ '[--plate-border:var(--color-destructive)]': invalid && !model }"
  >
    <div v-if="model" class="flex min-w-0 items-start gap-3">
      <div class="min-w-0">
        <div class="truncate font-display text-lg leading-tight font-semibold" :data-tooltip="title">{{ title }}</div>
        <div class="truncate text-sm text-muted-foreground">
          {{ joinParts(details, model) }}
        </div>
        <div v-if="!selected" class="mt-0.5 flex items-center gap-1.5 text-sm text-warning">
          <TriangleAlert class="size-4 shrink-0" />{{ t('hostGame.mapPicker.notInstalled') }}
        </div>
      </div>
      <StatusLamp v-if="selected?.official" tone="info" class="mt-0.5 ml-auto">{{ t('maps.official') }}</StatusLamp>
    </div>

    <!-- The picture is the largest square that fits beside the recent maps. -->
    <div class="flex min-h-0 flex-1 [container-type:size]">
      <div class="mx-auto flex gap-4">
        <div
          class="group/map @container relative m-1.5 shrink-0"
          :class="[
            recent.length ? 'size-[calc(min(100cqh,100cqw_-_7rem)_-_0.75rem)]' : 'size-[calc(min(100cqh,100cqw)_-_0.75rem)]',
            { brackets: model },
          ]"
        >
          <template v-if="model">
            <!-- The picture and the render are shaped to match the brackets; the controls sit over it. -->
            <div class="plate cut-picture relative size-full bg-hull">
              <ImagePreviewButton v-if="!rendering" class="size-full" :preview="preview">
                <PreviewImage :src="preview.src ?? preview.fallbackSrc" :fallback="title.slice(0, 1).toUpperCase()" />
              </ImagePreviewButton>
              <template v-else>
                <div class="size-full">
                  <PreviewImage :src="preview.src ?? preview.fallbackSrc" :fallback="title.slice(0, 1).toUpperCase()" />
                </div>
                <LobbyMapRender :folder-name="model" />
              </template>
            </div>
            <MapViewButton variant="overlay" :folder-name="model" :title="title" :details="details" />
            <!-- A picture too small for the switch is too small to be worth a render as well. -->
            <div
              class="plate cut-sm absolute top-2 right-2 flex gap-0.5 bg-secondary/90 p-0.75 backdrop-blur-sm @max-[12rem]:hidden"
              role="group"
              :aria-label="t('hostGame.mapPicker.viewLabel')"
            >
              <button
                v-for="option in VIEWS"
                :key="option"
                type="button"
                class="plate plate-control plate-focus cut-xs h-6.5 px-2.5 text-sm font-medium transition-colors [--plate-border:transparent] disabled:opacity-50"
                :class="view === option ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-foreground'"
                :aria-pressed="view === option"
                :disabled="option === 'render' && !canRender"
                :data-tooltip="option === 'render' && !canRender ? t('hostGame.mapPicker.renderUnavailable') : undefined"
                @click="view = option"
              >
                {{ t(`hostGame.mapPicker.${option}`) }}
              </button>
            </div>
          </template>
          <div v-else class="plate cut-lg flex size-full flex-col items-center justify-center gap-3 bg-background px-6 text-center">
            <Map class="size-8 text-faint" />
            <p class="text-sm text-muted-foreground">{{ t('hostGame.mapPicker.none') }}</p>
          </div>
        </div>

        <div v-if="recent.length" class="flex w-24 min-h-0 shrink-0 flex-col gap-1.5 overflow-hidden pt-1.5">
          <span class="text-xs text-faint">{{ t('hostGame.mapPicker.recent') }}</span>
          <button
            v-for="map in recent"
            :key="map.folderName"
            type="button"
            class="plate plate-focus cut-sm group flex flex-col items-center gap-1 p-1 text-xs [--plate-border:transparent] transition-colors hover:bg-accent"
            :data-tooltip="joinParts(map.displayName, playersLabel(map.maxPlayers), mapSizeLabel(map.widthPx, map.heightPx))"
            @click="chooseInstalled(map.folderName)"
          >
            <span class="plate cut-xs block size-18 overflow-hidden bg-background [--plate-border:transparent]">
              <PreviewImage :src="map.previewLargeUrl" :fallback="map.displayName.slice(0, 1).toUpperCase()" small lazy />
            </span>
            <span class="w-full truncate text-center text-muted-foreground group-hover:text-foreground">{{ map.displayName }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="flex gap-2">
      <Button type="button" variant="outline" class="flex-1" @click="browserOpen = true">
        <Map />{{ model ? t('hostGame.mapPicker.change') : t('hostGame.mapPicker.choose') }}
      </Button>
      <Button type="button" variant="outline" :data-tooltip="t('hostGame.generator.openHint')" @click="generatorOpen = true">
        <Sparkles />{{ t('hostGame.generator.open') }}
      </Button>
    </div>

    <MapBrowserDialog
      v-if="browserOpen"
      :current="model"
      :title="t('maps.browser.title')"
      :description="t('maps.browser.forNewGame')"
      :pick-label="t('maps.browser.pick')"
      :apply="choose"
      @close="browserOpen = false"
    />
    <GenerateMapDialog v-if="generatorOpen" @close="generatorOpen = false" @generated="chooseInstalled" />
  </div>
</template>
