<script setup lang="ts">
import { Copy, Play, RotateCw } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { STONEMAP_DOWNLOAD_MB, type GenerationRequest } from '../../../shared/contract.ts';
import { formToRequest, seedIsValid } from '../../../shared/stoneMap/form.ts';
import StoneMapHistory from '../components/stoneMap/StoneMapHistory.vue';
import StoneMapJobPanel from '../components/stoneMap/StoneMapJobPanel.vue';
import StoneMapPreview from '../components/stoneMap/StoneMapPreview.vue';
import StoneMapSettings from '../components/stoneMap/StoneMapSettings.vue';
import { useStoneMap } from '../composables/useStoneMap.ts';
import { errorMessage, isCancelled } from '../format.ts';
import { t } from '../lib/i18n.ts';

const { state, formState, selected, selectedId, result, resultError, acceptJob, refreshJobs, stateLoaded } = useStoneMap();
const working = ref<'generate' | 'validate' | 'start' | null>(null);
const panelBusy = ref(false);
const message = ref<{ error: boolean; text: string } | null>(null);
const busy = computed(() => working.value !== null || panelBusy.value);
/** Why StoneMap would refuse the form as it is now; checked a moment after each change while StoneMap runs. */
const invalid = ref<string | null>(null);
let validationTimer: ReturnType<typeof setTimeout> | undefined;
let validation = 0;

/** Vue's proxies cannot cross IPC; the request goes as plain data. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const status = computed(() => {
  const { phase, error, downloaded, buildId } = state.value;
  if (phase === 'installing') {
    return t('stoneMap.status.installing');
  }
  if (phase === 'starting') {
    return t('stoneMap.status.starting');
  }
  if (phase === 'ready') {
    return t('stoneMap.status.ready', { build: buildId });
  }
  if (error) {
    return error;
  }
  return downloaded ? t('stoneMap.status.stopped') : t('stoneMap.status.notDownloaded', { size: STONEMAP_DOWNLOAD_MB });
});

async function act(kind: NonNullable<typeof working.value>, work: () => Promise<void>): Promise<void> {
  working.value = kind;
  message.value = null;
  try {
    await work();
  } catch (cause) {
    if (!isCancelled(cause)) {
      message.value = { error: true, text: errorMessage(cause) };
    }
  } finally {
    working.value = null;
  }
}

function start(): void {
  void act('start', async () => {
    await window.tfaf.stoneMap.start();
    await refreshJobs();
  });
}

function generate(request: GenerationRequest = formToRequest(formState.value)): void {
  void act('generate', async () => {
    const job = await window.tfaf.stoneMap.generate(plain(request));
    acceptJob(job);
    selectedId.value = job.id;
  });
}

function validate(): void {
  void act('validate', async () => {
    const resolved = await window.tfaf.stoneMap.resolve(plain(formToRequest(formState.value)));
    message.value = { error: false, text: t('stoneMap.validated', { mapName: resolved.mapName, seed: resolved.seed }) };
  });
}

async function copyRequest(): Promise<void> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(formToRequest(formState.value), null, 2));
    message.value = { error: false, text: t('stoneMap.copied') };
  } catch {
    message.value = { error: true, text: t('stoneMap.copyFailed') };
  }
}

watch(
  [() => JSON.stringify(formToRequest(formState.value)), () => state.value.phase],
  ([request, phase]) => {
    clearTimeout(validationTimer);
    // An invalid seed is explained under its field; StoneMap would only repeat it in .NET's words.
    if (phase !== 'ready' || !seedIsValid(formState.value)) {
      validation++;
      invalid.value = null;
      return;
    }
    validationTimer = setTimeout(() => {
      const current = ++validation;
      window.tfaf.stoneMap.resolve(JSON.parse(request) as GenerationRequest).then(
        () => {
          if (current === validation) {
            invalid.value = null;
          }
        },
        (cause: unknown) => {
          if (current === validation) {
            invalid.value = errorMessage(cause);
          }
        },
      );
    }, 500);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearTimeout(validationTimer));

onMounted(async () => {
  await stateLoaded();
  if (state.value.phase === 'ready') {
    void refreshJobs().catch(() => undefined);
  } else if (state.value.downloaded && state.value.phase === 'stopped' && !state.value.error) {
    start();
  }
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header class="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <div class="mr-auto flex min-w-0 flex-col">
        <div class="flex items-center gap-2">
          <h1 class="font-display text-xl">{{ t('stoneMap.title') }}</h1>
          <Badge variant="warning" :data-tooltip="t('stoneMap.experimentalHint')">{{ t('stoneMap.experimental') }}</Badge>
        </div>
        <p class="truncate text-xs text-muted-foreground selectable" :class="{ 'text-destructive': state.phase === 'stopped' && state.error }">
          {{ status }}
        </p>
      </div>
      <Button
        v-if="state.phase === 'stopped'"
        variant="outline"
        size="sm"
        :disabled="busy"
        @click="start"
      >
        <Spinner v-if="working === 'start'" /><RotateCw v-else />
        {{ state.downloaded ? t('stoneMap.start') : t('stoneMap.download') }}
      </Button>
      <Button variant="outline" size="icon" :aria-label="t('stoneMap.copy')" :data-tooltip="t('stoneMap.copy')" @click="copyRequest">
        <Copy />
      </Button>
      <Button
        size="lg"
        :disabled="busy || state.phase === 'installing' || state.phase === 'starting' || !seedIsValid(formState)"
        @click="generate()"
      >
        <Spinner v-if="working === 'generate'" /><Play v-else />
        {{ t('stoneMap.generate') }}
      </Button>
    </header>
    <div
      v-if="message"
      class="border-b px-4 py-2 text-sm selectable"
      :class="message.error ? 'text-destructive' : 'text-muted-foreground'"
      :role="message.error ? 'alert' : 'status'"
    >
      {{ message.text }}
    </div>

    <div class="flex min-h-0 flex-1">
      <aside class="w-[22rem] shrink-0 overflow-y-auto border-r">
        <p v-if="invalid" class="sticky top-0 z-10 border-b bg-background px-4 py-2 text-xs text-warning selectable" role="status">
          {{ t('stoneMap.invalidSettings', { error: invalid }) }}
        </p>
        <StoneMapSettings :busy="busy" @validate="validate" @generate-by-name="(mapName) => generate({ mapName, preview: { kinds: [] } })" />
      </aside>
      <main class="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div class="flex h-[clamp(28rem,68vh,56rem)] shrink-0 flex-col">
          <StoneMapPreview :job="selected" :result="result" :busy="busy" @select="(id) => (selectedId = id)" />
        </div>
        <StoneMapJobPanel
          :job="selected"
          :result="result"
          :result-error="resultError"
          :busy="busy"
          @generate="generate"
          @busy="(value) => (panelBusy = value)"
        />
      </main>
      <aside class="flex w-64 shrink-0 flex-col border-l xl:w-72">
        <StoneMapHistory :busy="busy" />
      </aside>
    </div>
  </div>
</template>
