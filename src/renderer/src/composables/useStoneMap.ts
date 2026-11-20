import { computed, ref, shallowRef, watch } from 'vue';
import type { GenerationCapabilities, MapResult, StoneMapJob, StoneMapState } from '../../../shared/contract.ts';
import { defaultCapabilities } from '../../../shared/stoneMap/catalog.ts';
import { createFormState, type StoneMapFormState } from '../../../shared/stoneMap/form.ts';
import { errorMessage } from '../format.ts';

const FORM_KEY = 'tfaf.stoneMap.form';
const HISTORY_LIMIT = 256;

const state = ref<StoneMapState>({ phase: 'stopped', error: null, buildId: '', downloaded: false });
const capabilities = shallowRef<GenerationCapabilities>(defaultCapabilities);
const jobs = ref<StoneMapJob[]>([]);
const selectedId = ref<string | null>(null);
const result = shallowRef<MapResult | null>(null);
const resultError = ref<string | null>(null);
const formState = ref<StoneMapFormState>(loadForm());
let initialized = false;
let resultRequest = 0;
/** Settles once main told the state; until then `state` is only a placeholder. */
let stateLoaded: Promise<void> = Promise.resolve();

/** The saved form over the editor preset: unknown fields and values of another type are left out. */
function loadForm(): StoneMapFormState {
  const initial = createFormState();
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(FORM_KEY) ?? 'null');
    if (typeof saved !== 'object' || saved === null) {
      return initial;
    }
    const { form, random } = saved as Partial<Record<keyof StoneMapFormState, unknown>>;
    const fields = typeof form === 'object' && form !== null ? (form as Record<string, unknown>) : {};
    const merged: Record<string, unknown> = { ...initial.form };
    for (const [key, value] of Object.entries(initial.form)) {
      const candidate = fields[key];
      if (candidate !== undefined && (typeof candidate === typeof value || (value === null && typeof candidate === 'number') || candidate === null)) {
        merged[key] = Array.isArray(value) && !Array.isArray(candidate) ? value : candidate;
      }
    }
    return {
      form: merged as StoneMapFormState['form'],
      random: Array.isArray(random) ? random.filter((path): path is string => typeof path === 'string') : initial.random,
    };
  } catch {
    return initial;
  }
}

function saveForm(): void {
  try {
    localStorage.setItem(FORM_KEY, JSON.stringify(formState.value));
  } catch {
    // The form only lives on in this launcher run.
  }
}

/** The newest snapshot of a job wins; an event may arrive after a listing that already had a later one. */
function acceptJob(job: StoneMapJob): void {
  const index = jobs.value.findIndex((candidate) => candidate.id === job.id);
  if (index < 0) {
    jobs.value.unshift(job);
  } else if ((jobs.value[index]?.sequence ?? -1) <= job.sequence) {
    jobs.value.splice(index, 1, job);
  }
}

async function refreshJobs(): Promise<void> {
  const list = await window.tfaf.stoneMap.jobs(HISTORY_LIMIT);
  jobs.value = list.jobs;
}

async function loadResult(id: string): Promise<void> {
  const request = ++resultRequest;
  resultError.value = null;
  try {
    const loaded = await window.tfaf.stoneMap.result(id);
    if (request === resultRequest) {
      result.value = loaded;
    }
  } catch (error) {
    if (request === resultRequest) {
      result.value = null;
      resultError.value = errorMessage(error);
    }
  }
}

function initialize(): void {
  initialized = true;
  stateLoaded = window.tfaf.stoneMap.getState().then(
    (value) => {
      state.value = value;
    },
    () => undefined,
  );
  window.tfaf.stoneMap.onStateChanged((value) => {
    const started = value.phase === 'ready' && state.value.phase !== 'ready';
    state.value = value;
    if (started) {
      void refreshJobs().catch(() => undefined);
      void window.tfaf.stoneMap.capabilities().then((value) => (capabilities.value = value), () => undefined);
    }
  });
  window.tfaf.stoneMap.onJobChanged((job) => {
    acceptJob(job);
    if (job.id === selectedId.value && job.status === 'completed') {
      void loadResult(job.id);
    }
  });
  watch(formState, saveForm, { deep: true });
  watch(selectedId, (id) => {
    result.value = null;
    resultError.value = null;
    const job = jobs.value.find((candidate) => candidate.id === id);
    if (id && job?.status === 'completed') {
      void loadResult(id);
    }
  });
}

/** StoneMap's state for the generator screen: the form, the jobs and the result of the chosen one. */
export function useStoneMap() {
  if (!initialized) {
    initialize();
  }
  const selected = computed(() => jobs.value.find((job) => job.id === selectedId.value) ?? null);
  return {
    state,
    capabilities,
    jobs,
    selectedId,
    selected,
    result,
    resultError,
    formState,
    refreshJobs,
    acceptJob,
    stateLoaded: () => stateLoaded,
    reloadResult: () => (selectedId.value ? loadResult(selectedId.value) : Promise.resolve()),
  };
}
