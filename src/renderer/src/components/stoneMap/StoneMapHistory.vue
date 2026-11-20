<script setup lang="ts">
import { Trash2, X } from '@lucide/vue';
import { computed, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { StoneMapJob } from '../../../../shared/contract.ts';
import { confirmAction } from '../../composables/useConfirm.ts';
import { useStoneMap } from '../../composables/useStoneMap.ts';
import { errorMessage } from '../../format.ts';
import { t } from '../../lib/i18n.ts';
import { islandModeLabel, mapSizeLabel, patternLabel, statusLabel, topologyLabel } from '../../lib/stoneMapLabels.ts';

const props = defineProps<{ busy: boolean }>();
const { jobs, selectedId, refreshJobs, state } = useStoneMap();
const working = ref(false);
const error = ref<string | null>(null);
const ready = computed(() => state.value.phase === 'ready');

function title(job: StoneMapJob): string {
  const { parameters } = job;
  return parameters.presentation?.name ?? (parameters.topology ? topologyLabel(parameters.topology.kind) : t('stoneMap.history.bySeed'));
}

function details(job: StoneMapJob): string {
  const { parameters } = job;
  const topology = parameters.topology;
  const parts = [t('stoneMap.preview.seed', { seed: parameters.seed }), statusLabel(job.status)];
  if (job.hasAdjustments) {
    parts.push(t('stoneMap.history.adjusted'));
  }
  if (topology) {
    if (topology.spawnIslandMode && topology.spawnIslandMode !== 'AUTO') {
      parts.push(islandModeLabel(topology.spawnIslandMode));
    }
    if (topology.rivers) {
      parts.push(t('stoneMap.history.rivers'));
    }
    parts.push(t('stoneMap.history.water', { water: Math.round((topology.waterRatio ?? 0) * 100) }));
    if (topology.landBridges) {
      parts.push(t('stoneMap.history.bridges'));
    }
    if (topology.mode === 'REALISM') {
      parts.push(t('stoneMap.history.realism'));
    }
    if (topology.symmetryPattern && topology.symmetryPattern !== 'CLASSIC') {
      parts.push(patternLabel(topology.symmetryPattern));
    }
    if (topology.spawnFreeIslands) {
      parts.push(t('stoneMap.history.freeIslands', { count: topology.spawnFreeIslands }));
    }
  }
  return parts.join(' · ');
}

async function run(work: () => Promise<void>): Promise<void> {
  working.value = true;
  error.value = null;
  try {
    await work();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    working.value = false;
    await refreshJobs().catch(() => undefined);
  }
}

function remove(job: StoneMapJob): void {
  void run(async () => {
    await window.tfaf.stoneMap.remove(job.id);
    if (selectedId.value === job.id) {
      selectedId.value = null;
    }
  });
}

async function clear(): Promise<void> {
  const finished = jobs.value.filter((job) => job.terminal);
  if (finished.length === 0) {
    return;
  }
  const confirmed = await confirmAction({
    title: t('stoneMap.history.clearTitle'),
    description: t('stoneMap.history.clearDescription', { count: finished.length }),
    confirmText: t('stoneMap.history.clear'),
    destructive: true,
  });
  if (!confirmed) {
    return;
  }
  await run(async () => {
    const failures: string[] = [];
    for (const job of finished) {
      try {
        await window.tfaf.stoneMap.remove(job.id);
      } catch (cause) {
        failures.push(errorMessage(cause));
      }
      if (selectedId.value === job.id) {
        selectedId.value = null;
      }
    }
    if (failures.length > 0) {
      throw new Error(t('stoneMap.history.clearFailed', { count: failures.length, error: failures[0] ?? '' }));
    }
  });
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col">
    <div class="flex items-center gap-2 border-b px-4 py-2.5">
      <h2 class="flex-1 font-display text-sm font-semibold tracking-wide uppercase">{{ t('stoneMap.history.title') }}</h2>
      <span class="text-xs text-muted-foreground tabular-nums">{{ jobs.length }}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        :disabled="!ready || props.busy || working || !jobs.some((job) => job.terminal)"
        :aria-label="t('stoneMap.history.clear')"
        :data-tooltip="t('stoneMap.history.clear')"
        @click="clear"
      >
        <Spinner v-if="working" /><Trash2 v-else />
      </Button>
    </div>
    <p v-if="error" class="px-4 py-2 text-xs text-destructive selectable">{{ error }}</p>
    <div v-if="jobs.length > 0" class="min-h-0 flex-1 overflow-y-auto py-1">
      <div
        v-for="job in jobs"
        :key="job.id"
        class="group/job flex items-start gap-1 px-2"
        :class="{ 'bg-accent/60': job.id === selectedId }"
      >
        <button
          type="button"
          class="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-accent/40"
          @click="selectedId = job.id"
        >
          <span class="flex w-full items-baseline gap-2">
            <strong class="truncate text-sm">{{ title(job) }}</strong>
            <span class="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{{ mapSizeLabel(job.parameters.mapSize) }}</span>
          </span>
          <span class="text-xs text-muted-foreground">{{ details(job) }}</span>
        </button>
        <Button
          v-if="job.terminal"
          variant="ghost"
          size="icon-xs"
          class="mt-1.5 opacity-0 group-hover/job:opacity-100 focus-visible:opacity-100"
          :disabled="props.busy || working"
          :aria-label="t('stoneMap.history.remove')"
          :data-tooltip="t('stoneMap.history.remove')"
          @click="remove(job)"
        >
          <X />
        </Button>
      </div>
    </div>
    <p v-else class="px-4 py-3 text-xs text-muted-foreground">
      {{ ready ? t('stoneMap.history.empty') : t('stoneMap.history.notStarted') }}
    </p>
  </section>
</template>
