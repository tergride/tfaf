<script setup lang="ts">
import { Download, FolderInput, FolderOpen, Repeat2, Square, Wrench, X } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { STONEMAP_PRESENTATION_LIMITS, type GenerationRequest, type MapResult, type StoneMapJob } from '../../../../shared/contract.ts';
import { mountainHollowsRequest } from '../../../../shared/stoneMap/form.ts';
import { useStoneMap } from '../../composables/useStoneMap.ts';
import { errorMessage, formatNumber, isCancelled } from '../../format.ts';
import { t } from '../../lib/i18n.ts';
import { queries, refreshLists } from '../../lib/queries.ts';
import { stageLabel, statusLabel } from '../../lib/stoneMapLabels.ts';
import StoneMapResultDetails from './StoneMapResultDetails.vue';

const props = defineProps<{ job: StoneMapJob | null; result: MapResult | null; resultError: string | null; busy: boolean }>();
const emit = defineEmits<{ generate: [request: GenerationRequest]; busy: [busy: boolean] }>();
const { acceptJob, reloadResult } = useStoneMap();

const working = ref<'cancel' | 'save' | 'zip' | 'presentation' | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const savedFolder = ref<string | null>(null);
const name = ref('');
const description = ref('');

const running = computed(() => !!props.job && !props.job.terminal);
const completed = computed(() => props.job?.status === 'completed');
const progress = computed(() => props.job?.progress ?? null);
const issues = computed(() => props.job?.error?.issues ?? []);
const presentationChanged = computed(() => {
  const current = props.result?.parameters.presentation;
  return name.value.trim() !== (current?.name ?? '') || description.value.trim() !== (current?.description ?? '');
});

watch(
  () => [props.job?.id, props.result?.parameters.presentation] as const,
  (current, previous) => {
    const presentation = props.result?.parameters.presentation;
    name.value = presentation?.name ?? '';
    description.value = presentation?.description ?? '';
    if (current[0] !== previous?.[0]) {
      error.value = null;
      notice.value = null;
      savedFolder.value = null;
    }
  },
  { immediate: true },
);

async function act(kind: NonNullable<typeof working.value>, work: () => Promise<void>): Promise<void> {
  working.value = kind;
  emit('busy', true);
  error.value = null;
  notice.value = null;
  try {
    await work();
  } catch (cause) {
    if (!isCancelled(cause)) {
      error.value = errorMessage(cause);
    }
  } finally {
    working.value = null;
    emit('busy', false);
  }
}

function cancel(): void {
  const job = props.job;
  if (job) {
    void act('cancel', async () => acceptJob(await window.tfaf.stoneMap.cancel(job.id)));
  }
}

function repeat(): void {
  const job = props.job;
  if (job) {
    emit('generate', {
      mapName: job.parameters.mapName,
      adjustments: props.result?.adjustments ?? null,
      presentation: props.result?.parameters.presentation ?? null,
      preview: { kinds: [] },
    });
  }
}

function fillHollows(): void {
  const parameters = props.result?.parameters ?? props.job?.parameters;
  if (parameters) {
    emit('generate', JSON.parse(JSON.stringify(mountainHollowsRequest(parameters))) as GenerationRequest);
  }
}

function saveToMaps(): void {
  const job = props.job;
  if (job) {
    void act('save', async () => {
      const saved = await window.tfaf.stoneMap.saveToMaps(job.id);
      savedFolder.value = saved.folderName;
      notice.value = saved.existed ? t('stoneMap.job.alreadySaved', { folder: saved.folderName }) : t('stoneMap.job.saved', { folder: saved.folderName });
      await refreshLists(queries.installedMaps());
    });
  }
}

function exportZip(): void {
  const job = props.job;
  if (job) {
    void act('zip', async () => {
      if (await window.tfaf.stoneMap.exportZip(job.id)) {
        notice.value = t('stoneMap.job.zipSaved');
      }
    });
  }
}

function applyPresentation(): void {
  const job = props.job;
  if (job) {
    void act('presentation', async () => {
      await window.tfaf.stoneMap.updatePresentation(job.id, { name: name.value.trim() || null, description: description.value.trim() || null });
      await reloadResult();
      savedFolder.value = null;
      notice.value = t('stoneMap.job.presentationApplied');
    });
  }
}

function reveal(): void {
  if (savedFolder.value) {
    void window.tfaf.maps.reveal(savedFolder.value).catch((cause: unknown) => (error.value = errorMessage(cause)));
  }
}
</script>

<template>
  <section class="flex flex-col gap-3 border-t px-4 py-3" aria-live="polite">
    <div class="flex flex-wrap items-center gap-2">
      <div class="mr-auto flex flex-col">
        <span class="text-xs tracking-wide text-muted-foreground uppercase">{{ t('stoneMap.job.current') }}</span>
        <strong class="font-display text-lg">{{ job ? statusLabel(job.status) : t('stoneMap.job.idle') }}</strong>
      </div>
      <Button v-if="running" variant="outline" size="sm" :disabled="busy || job?.status === 'cancelling'" @click="cancel">
        <Spinner v-if="working === 'cancel'" /><Square v-else />{{ t('stoneMap.job.cancel') }}
      </Button>
      <template v-if="completed">
        <Button variant="outline" size="sm" :disabled="busy" :data-tooltip="t('stoneMap.job.repeatHint')" @click="repeat">
          <Repeat2 />{{ t('stoneMap.job.repeat') }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="busy || !!result?.adjustments"
          :data-tooltip="result?.adjustments ? t('stoneMap.job.fillHollowsAdjusted') : t('stoneMap.job.fillHollowsHint')"
          @click="fillHollows"
        >
          <Wrench />{{ t('stoneMap.job.fillHollows') }}
        </Button>
        <Button variant="outline" size="sm" :disabled="busy" @click="exportZip">
          <Spinner v-if="working === 'zip'" /><Download v-else />{{ t('stoneMap.job.zip') }}
        </Button>
        <Button size="sm" :disabled="busy" @click="saveToMaps">
          <Spinner v-if="working === 'save'" /><FolderInput v-else />{{ t('stoneMap.job.save') }}
        </Button>
      </template>
    </div>

    <template v-if="job && progress">
      <Progress :model-value="progress.percent" />
      <div class="flex justify-between gap-2 text-xs text-muted-foreground tabular-nums">
        <span>
          {{ stageLabel(progress.stage) }}
          <template v-if="progress.totalOperations > 0">
            · {{ t('stoneMap.job.operations', { done: progress.completedOperations, total: progress.totalOperations }) }}
          </template>
        </span>
        <span>{{ progress.isEstimated ? '≈ ' : '' }}{{ progress.percent.toFixed(1) }}%</span>
      </div>
      <p v-if="job.error" class="text-sm text-destructive selectable">{{ job.error.message }}</p>
      <ul v-if="issues.length > 0" class="list-disc pl-5 text-xs text-destructive selectable">
        <li v-for="issue in issues" :key="issue.objectId">{{ issue.objectId }}: {{ issue.message }}</li>
      </ul>
    </template>

    <p v-if="completed && result" class="text-xs text-muted-foreground">
      {{
        result.adjustments
          ? t('stoneMap.job.hollowsAdjusted')
          : job?.parameters.features?.fillMountainHollows
            ? t('stoneMap.job.hollowsOn')
            : t('stoneMap.job.hollowsOff')
      }}
    </p>
    <p v-if="resultError" class="text-sm text-destructive selectable">{{ resultError }}</p>

    <div
      v-if="error || notice"
      class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
      :class="error ? 'border-destructive/50 text-destructive' : 'border-primary/40'"
      :role="error ? 'alert' : 'status'"
    >
      <span class="flex-1 selectable">{{ error ?? notice }}</span>
      <Button v-if="!error && savedFolder" variant="ghost" size="sm" @click="reveal"><FolderOpen />{{ t('stoneMap.job.reveal') }}</Button>
      <Button variant="ghost" size="icon-xs" :aria-label="t('common.close')" @click="error = notice = null"><X /></Button>
    </div>

    <template v-if="result">
      <Field class="gap-1">
        <FieldLabel for="sm-result-seed">{{ t('stoneMap.job.seed') }}</FieldLabel>
        <Input id="sm-result-seed" class="tabular-nums" :model-value="result.parameters.seed" readonly @focus="($event.target as HTMLInputElement).select()" />
      </Field>
      <StoneMapResultDetails :result="result" />
      <div class="flex flex-col gap-2 rounded-md border p-3">
        <Field class="gap-1">
          <FieldLabel for="sm-result-name">{{ t('stoneMap.settings.mapTitle') }}</FieldLabel>
          <Input id="sm-result-name" v-model="name" :maxlength="STONEMAP_PRESENTATION_LIMITS.name" :placeholder="t('stoneMap.settings.automatic')" />
        </Field>
        <Field class="gap-1">
          <FieldLabel for="sm-result-description">{{ t('stoneMap.settings.mapDescription') }}</FieldLabel>
          <Textarea
            id="sm-result-description"
            v-model="description"
            rows="2"
            :maxlength="STONEMAP_PRESENTATION_LIMITS.description"
            :placeholder="t('stoneMap.settings.automatic')"
          />
        </Field>
        <div class="flex items-center gap-2">
          <p class="flex-1 text-xs text-muted-foreground">{{ t('stoneMap.job.presentationHint') }}</p>
          <Button variant="outline" size="sm" :disabled="busy || !presentationChanged" @click="applyPresentation">
            <Spinner v-if="working === 'presentation'" />{{ t('stoneMap.job.applyPresentation') }}
          </Button>
        </div>
      </div>
      <p class="text-xs text-muted-foreground tabular-nums">
        {{ t('stoneMap.job.counts', { mexes: formatNumber(result.counts.mexes), hydros: formatNumber(result.counts.hydros), props: formatNumber(result.counts.props) }) }}
      </p>
    </template>
  </section>
</template>
