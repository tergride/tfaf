<script setup lang="ts">
import { Ban, Minus, Plus } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { MapPoolBracket, MapPoolMap, MatchmakerMapPool, MatchmakerQueue } from '../../../shared/contract.ts';
import { errorMessage, joinParts, mapSizeLabel, playersLabel } from '../format.ts';
import { t } from '../lib/i18n.ts';
import DetailPanel from './DetailPanel.vue';
import DetailStats from './DetailStats.vue';
import FilterChip from './FilterChip.vue';
import ImagePreviewButton from './ImagePreviewButton.vue';
import MapViewButton from './MapViewButton.vue';
import PreviewImage from './PreviewImage.vue';

const props = defineProps<{ queue: MatchmakerQueue }>();
const emit = defineEmits<{ close: [] }>();

const pool = ref<MatchmakerMapPool | null>(null);
const bracketId = ref<number | null>(null);
const error = ref<string | null>(null);
const saving = ref(false);
let latest = 0;

const current = computed(() => pool.value?.brackets.find((bracket) => bracket.id === bracketId.value) ?? null);
const used = computed(() => current.value?.maps.reduce((sum, map) => sum + map.vetoTokens, 0) ?? 0);
const left = computed(() => (current.value?.vetoTokensPerPlayer ?? 0) - used.value);

function bracketLabel(bracket: MapPoolBracket): string {
  const { minRating: min, maxRating: max } = bracket;
  if (min === null && max === null) {
    return t('matchmaker.pool.anyRating');
  }
  if (min === null) {
    return t('matchmaker.pool.ratingTo', { max: Math.ceil(max!) });
  }
  if (max === null) {
    return t('matchmaker.pool.ratingFrom', { min: Math.floor(min) });
  }
  return t('matchmaker.pool.ratingRange', { min: Math.round(min), max: Math.round(max) });
}

function details(map: MapPoolMap): string | null {
  if (map.generated) {
    const size = map.generated.size ? mapSizeLabel(map.generated.size, map.generated.size) : null;
    return joinParts(
      size,
      map.generated.spawns ? playersLabel(map.generated.spawns) : null,
      map.generated.version ? t('matchmaker.pool.generator', { version: map.generated.version }) : null,
    );
  }
  return joinParts(mapSizeLabel(map.widthPx, map.heightPx), map.maxPlayers ? playersLabel(map.maxPlayers) : null);
}

function canAdd(map: MapPoolMap): boolean {
  const bracket = current.value;
  return !!bracket && left.value > 0 && (bracket.maxTokensPerMap === 0 || map.vetoTokens < bracket.maxTokensPerMap);
}

function banned(map: MapPoolMap): boolean {
  const bracket = current.value;
  return !!bracket && bracket.maxTokensPerMap > 0 && map.vetoTokens >= bracket.maxTokensPerMap;
}

async function setVeto(map: MapPoolMap, tokens: number): Promise<void> {
  const bracket = current.value;
  if (!bracket || saving.value) {
    return;
  }
  saving.value = true;
  error.value = null;
  try {
    pool.value = await window.tfaf.matchmaker.setVeto(bracket.id, map.assignmentId, tokens);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    saving.value = false;
  }
}

// The panel stays open when another queue's pool is asked for; an answer for the previous queue is dropped.
watch(
  () => props.queue.name,
  async (name) => {
    const request = ++latest;
    pool.value = null;
    error.value = null;
    try {
      const loaded = await window.tfaf.matchmaker.mapPool(name);
      if (request === latest) {
        pool.value = loaded;
        bracketId.value = loaded.playerBracketId ?? loaded.brackets[0]?.id ?? null;
      }
    } catch (cause) {
      if (request === latest) {
        error.value = errorMessage(cause);
      }
    }
  },
  { immediate: true },
);
</script>

<template>
  <DetailPanel :title="queue.title" :kind="t('matchmaker.pool.kind')" :item-key="queue.name" @close="emit('close')">
    <p class="text-[13px] text-muted-foreground">
      {{ t('matchmaker.pool.description') }}
    </p>
    <Alert v-if="error" variant="destructive">
      <AlertDescription class="selectable">{{ error }}</AlertDescription>
    </Alert>
    <div v-if="!pool && !error" class="flex flex-col gap-px">
      <Skeleton v-for="index in 6" :key="index" class="h-16" />
    </div>
    <template v-if="pool">
      <div v-if="pool.brackets.length > 1" class="flex flex-wrap gap-1" role="group" :aria-label="t('matchmaker.pool.brackets')">
        <FilterChip
          v-for="bracket in pool.brackets"
          :key="bracket.id"
          :pressed="bracket.id === bracketId"
          @toggle="bracketId = bracket.id"
        >
          {{ bracketLabel(bracket) }}
          <span v-if="bracket.id === pool.playerBracketId" class="text-xs font-normal opacity-75">{{ t('matchmaker.pool.yourBracket') }}</span>
        </FilterChip>
      </div>
      <template v-if="current && current.vetoTokensPerPlayer > 0">
        <DetailStats
          :items="[
            {
              label: t('matchmaker.pool.vetoesLeft'),
              value: t('matchmaker.pool.vetoesLeftValue', { left, total: current.vetoTokensPerPlayer }),
            },
            {
              label: t('matchmaker.pool.vetoesPerMap'),
              value:
                current.maxTokensPerMap > 0
                  ? t('matchmaker.pool.vetoesPerMapValue', { max: current.maxTokensPerMap })
                  : t('matchmaker.pool.unlimited'),
            },
          ]"
        />
        <p class="text-[13px] text-muted-foreground">
          {{
            current.maxTokensPerMap > 0
              ? t('matchmaker.pool.vetoLimitHint', { count: current.maxTokensPerMap })
              : t('matchmaker.pool.vetoHint')
          }}
        </p>
      </template>
      <p v-if="current && current.maps.length === 0" class="text-sm text-muted-foreground">{{ t('matchmaker.pool.noMaps') }}</p>
      <ul v-else-if="current" class="flex flex-col gap-px border bg-border">
        <li
          v-for="map in current.maps"
          :key="map.assignmentId"
          class="flex items-center gap-3 p-2"
          :class="
            banned(map)
              ? 'bg-[color-mix(in_srgb,var(--color-destructive)_7%,var(--color-background))] shadow-[inset_3px_0_0_var(--color-destructive)]'
              : 'bg-background'
          "
        >
          <div class="group/map relative shrink-0">
            <ImagePreviewButton
              class="plate cut-xs size-14 bg-card [--plate-border:transparent]"
              :preview="{ title: map.displayName, details: details(map), src: map.previewLargeUrl, fallbackSrc: map.previewUrl }"
            >
              <PreviewImage
                small
                :src="map.previewUrl"
                :fallback="map.generated ? 'NX' : ''"
                lazy
                :class="{ 'grayscale opacity-60': banned(map) }"
              />
            </ImagePreviewButton>
            <MapViewButton variant="overlay" :folder-name="map.folderName" :title="map.displayName" :details="details(map)" />
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="truncate font-display text-sm font-semibold" :data-tooltip="map.folderName ?? undefined">{{ map.displayName }}</span>
            <span class="truncate text-xs text-muted-foreground">{{ details(map) }}</span>
            <span v-if="banned(map)" class="flex items-center gap-1 text-xs text-destructive"><Ban class="size-3" />{{ t('matchmaker.pool.banned') }}</span>
          </div>
          <div v-if="current.vetoTokensPerPlayer > 0" class="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              :data-tooltip="t('matchmaker.pool.removeVeto')"
              :aria-label="t('matchmaker.pool.removeVeto')"
              :disabled="saving || map.vetoTokens === 0"
              @click="setVeto(map, map.vetoTokens - 1)"
            >
              <Minus />
            </Button>
            <span
              class="w-5 text-center font-display font-semibold tabular-nums"
              :class="map.vetoTokens > 0 ? 'text-primary' : 'text-faint'"
              :aria-label="t('matchmaker.pool.vetoCount', { tokens: map.vetoTokens })"
            >
              {{ map.vetoTokens }}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              :data-tooltip="t('matchmaker.pool.addVeto')"
              :aria-label="t('matchmaker.pool.addVeto')"
              :disabled="saving || !canAdd(map)"
              @click="setVeto(map, map.vetoTokens + 1)"
            >
              <Plus />
            </Button>
          </div>
        </li>
      </ul>
    </template>
  </DetailPanel>
</template>
