<script setup lang="ts">
import { Check, Minus, Plus, Redo2, RotateCcw, Trash2, Undo2, X } from '@lucide/vue';
import { useElementSize } from '@vueuse/core';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import type { AdjustmentPlacementMap, AdjustmentScene, MapAdjustments } from '../../../../shared/contract.ts';
import {
  type AdjustmentHistory,
  commitDraft,
  mapPoint,
  placementPixels,
  previewMove,
  redoDraft,
  samePositions,
  sceneDraft,
  unchangedIssues,
  undoDraft,
} from '../../../../shared/stoneMap/adjustments.ts';
import type { AdjustmentIssue, PreviewQuality } from '../../../../shared/stoneMap/contracts.ts';
import { usePanZoom } from '../../composables/usePanZoom.ts';
import { useStoneMap } from '../../composables/useStoneMap.ts';
import { errorMessage } from '../../format.ts';
import { t } from '../../lib/i18n.ts';
import { stageLabel } from '../../lib/stoneMapLabels.ts';

interface SavedDraft extends AdjustmentHistory {
  selected: string | null;
  /** The job that applies the draft, while it runs. */
  pending: string | null;
  issues: AdjustmentIssue[];
  issuesAt: MapAdjustments | null;
}

interface Drag {
  id: string;
  pointerId: number;
  draft: MapAdjustments;
  dx: number;
  dz: number;
  x: number;
  z: number;
}

// Drafts outlive the tab: switching to another preview and back keeps unapplied changes.
const drafts = new Map<string, SavedDraft>();
const PLACEMENT_DELAY_MS = 180;
const MAX_ZOOM = 8;

const props = defineProps<{ jobId: string; quality: PreviewQuality; busy: boolean }>();
const emit = defineEmits<{ select: [jobId: string] }>();
const { jobs, refreshJobs } = useStoneMap();

const scene = shallowRef<AdjustmentScene | null>(null);
const saved = shallowRef<SavedDraft | null>(null);
const preview = shallowRef<MapAdjustments | null>(null);
const error = ref<string | null>(null);
const moving = ref(false);
const background = ref<string | null>(null);
const showPlacement = ref(true);
const placement = shallowRef<{ map: AdjustmentPlacementMap; pixels: Uint8ClampedArray } | null>(null);
const placementState = ref<'idle' | 'loading' | 'error'>('idle');
const placementError = ref<string | null>(null);
const search = ref('');
const kindFilter = ref<'all' | 'spawn' | 'mex' | 'hydro'>('all');
const onlyErrors = ref(false);
const drag = shallowRef<Drag | null>(null);
const svg = useTemplateRef<SVGSVGElement>('svg');
const stage = useTemplateRef<HTMLElement>('stage');
const canvas = useTemplateRef<HTMLCanvasElement>('canvas');
const { width: stageWidth, height: stageHeight } = useElementSize(stage);
/** The side of the square map that fits the stage with a margin, in screen pixels. */
const side = computed(() => Math.max(0, Math.min(stageWidth.value, stageHeight.value) - 32));
const panZoom = usePanZoom(MAX_ZOOM);

const draft = computed(() => preview.value ?? saved.value?.draft ?? null);
const baseline = computed(() => (scene.value ? sceneDraft(scene.value) : null));
const dirty = computed(() => !!saved.value && !!baseline.value && !samePositions(saved.value.draft, baseline.value));
const pendingJob = computed(() => jobs.value.find((job) => job.id === saved.value?.pending) ?? null);
const locked = computed(() => props.busy || moving.value || !!saved.value?.pending);
const deleted = computed(() => new Set(draft.value?.deletedIds ?? []));
const positions = computed(() => new Map(draft.value?.positions.map((position) => [position.id, position])));
const issues = computed(() => {
  const state = saved.value;
  const byObject = new Map<string, string[]>();
  for (const issue of state ? unchangedIssues(state.issues, state.issuesAt ?? state.draft, state.draft) : []) {
    byObject.set(issue.objectId, [...(byObject.get(issue.objectId) ?? []), issue.message]);
  }
  return byObject;
});
const objects = computed(() => scene.value?.objects.filter((object) => !object.isDeleted) ?? []);
const selected = computed(() => scene.value?.objects.find((object) => object.id === saved.value?.selected) ?? null);
const point = computed(() => (selected.value ? (positions.value.get(selected.value.id) ?? null) : null));
const group = computed(() => scene.value?.groups.find((candidate) => candidate.members.some((member) => member.id === selected.value?.id)) ?? null);
const linked = computed(() => {
  const ids = new Set(group.value?.members.map((member) => member.id));
  if (selected.value?.kind === 'spawn') {
    for (const object of scene.value?.objects ?? []) {
      if (object.ownerSpawnId && ids.has(object.ownerSpawnId)) {
        ids.add(object.id);
      }
    }
  }
  return ids;
});
/** Map units per screen pixel, so markers keep their size on screen at any zoom. */
const unit = computed(() => (scene.value && side.value > 0 ? scene.value.mapSize / (side.value * panZoom.zoom.value) : 1));
const visible = computed(() =>
  [...objects.value].filter((object) => !deleted.value.has(object.id)).sort((a, b) => Number(a.kind === 'spawn') - Number(b.kind === 'spawn')),
);
const rows = computed(() => {
  const query = search.value.trim().toLowerCase();
  return objects.value
    .filter(
      (object) =>
        (kindFilter.value === 'all' || object.kind === kindFilter.value) &&
        (!onlyErrors.value || issues.value.has(object.id)) &&
        `${object.name} ${object.id} ${kindLabel(object.kind)}`.toLowerCase().includes(query),
    )
    .sort((a, b) => Number(issues.value.has(b.id)) - Number(issues.value.has(a.id)));
});

function kindLabel(kind: string): string {
  return kind === 'spawn' ? t('stoneMap.adjust.spawn') : kind === 'mex' ? t('stoneMap.adjust.mex') : kind === 'hydro' ? t('stoneMap.adjust.hydro') : kind;
}

function issueText(list: AdjustmentIssue[]): string | null {
  return list.length > 0 ? list.slice(0, 5).map((issue) => `${issue.objectId}: ${issue.message}`).join('; ') : null;
}

function remember(next: SavedDraft): void {
  drafts.set(props.jobId, next);
  saved.value = next;
}

async function loadScene(): Promise<void> {
  try {
    const loaded = await window.tfaf.stoneMap.adjustments(props.jobId);
    scene.value = loaded;
    const previous = drafts.get(props.jobId);
    remember(
      previous?.draft.baseFingerprint === loaded.baseFingerprint
        ? previous
        : { draft: sceneDraft(loaded), undo: [], redo: [], selected: null, pending: null, issues: [], issuesAt: null },
    );
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}

async function loadBackground(): Promise<void> {
  try {
    const png = await window.tfaf.stoneMap.preview(props.jobId, { kind: 'terrain', markers: false, quality: props.quality, waterContours: true });
    if (background.value) {
      URL.revokeObjectURL(background.value);
    }
    background.value = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}

function history(direction: 'undo' | 'redo'): void {
  const state = saved.value;
  if (!state || locked.value || (direction === 'undo' ? state.undo.length === 0 : state.redo.length === 0)) {
    return;
  }
  const next = direction === 'undo' ? undoDraft(state) : redoDraft(state);
  const remaining = unchangedIssues(state.issues, state.issuesAt ?? state.draft, next.draft);
  remember({ ...state, ...next, issues: remaining });
  error.value = issueText(remaining);
}

function resetDraft(): void {
  const state = saved.value;
  if (!state || !baseline.value || locked.value) {
    return;
  }
  const remaining = unchangedIssues(state.issues, state.issuesAt ?? state.draft, baseline.value);
  remember({ ...state, ...commitDraft(state, baseline.value), issues: remaining });
  error.value = issueText(remaining);
}

/** Sends a move or deletion to the API; the draft it answers with replaces the local one. */
async function change(work: (before: MapAdjustments) => Promise<MapAdjustments>, before: MapAdjustments): Promise<void> {
  const state = saved.value;
  if (!state) {
    return;
  }
  const previousError = error.value;
  moving.value = true;
  error.value = null;
  try {
    const answered = await work(before);
    const current = drafts.get(props.jobId) ?? state;
    const remaining = unchangedIssues(current.issues, current.issuesAt ?? before, answered);
    remember({ ...current, ...commitDraft({ ...current, draft: before }, answered), issues: remaining });
    error.value = issueText(remaining) ?? (samePositions(before, answered) ? previousError : null);
  } catch (cause) {
    remember({ ...state, draft: before });
    error.value = errorMessage(cause);
  } finally {
    preview.value = null;
    moving.value = false;
  }
}

function move(id: string, x: number, z: number, before: MapAdjustments): Promise<void> {
  return change((draft) => window.tfaf.stoneMap.moveAdjustment(props.jobId, plain({ draft, id, x, z })), before);
}

function removeSelected(): void {
  const state = saved.value;
  if (!state?.selected || locked.value || deleted.value.has(state.selected)) {
    return;
  }
  const id = state.selected;
  void change((draft) => window.tfaf.stoneMap.deleteAdjustment(props.jobId, plain({ draft, id })), state.draft);
}

async function apply(): Promise<void> {
  const state = saved.value;
  if (!state || !dirty.value || locked.value) {
    return;
  }
  moving.value = true;
  error.value = null;
  try {
    const job = await window.tfaf.stoneMap.applyAdjustments(props.jobId, plain(state.draft));
    remember({ ...state, pending: job.id });
    await refreshJobs();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    moving.value = false;
  }
}

function cancelPending(): void {
  const id = saved.value?.pending;
  if (id) {
    void window.tfaf.stoneMap.cancel(id).catch((cause: unknown) => (error.value = errorMessage(cause)));
  }
}

/** Vue's proxies cannot cross IPC. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function select(id: string): void {
  if (saved.value) {
    remember({ ...saved.value, selected: id });
  }
}

function pointerDown(event: PointerEvent, id: string): void {
  const state = saved.value;
  if (!scene.value || !state || locked.value || event.button !== 0 || !svg.value || deleted.value.has(id)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  select(id);
  const owner = scene.value.groups.find((candidate) => candidate.members.some((member) => member.id === id));
  if (owner?.error) {
    error.value = owner.error;
    return;
  }
  const mouse = mapPoint(event.clientX, event.clientY, svg.value.getBoundingClientRect(), scene.value.mapSize);
  const position = positions.value.get(id);
  if (!position) {
    return;
  }
  drag.value = { id, pointerId: event.pointerId, draft: state.draft, dx: position.x - mouse.x, dz: position.z - mouse.z, x: position.x, z: position.z };
  svg.value.setPointerCapture(event.pointerId);
}

function pointerMove(event: PointerEvent): void {
  const current = drag.value;
  if (!current || current.pointerId !== event.pointerId || !scene.value || !svg.value) {
    return;
  }
  const mouse = mapPoint(event.clientX, event.clientY, svg.value.getBoundingClientRect(), scene.value.mapSize);
  current.x = mouse.x + current.dx;
  current.z = mouse.z + current.dz;
  preview.value = previewMove(scene.value, current.draft, current.id, current.x, current.z);
}

function release(event: PointerEvent, cancelled = false): void {
  const current = drag.value;
  if (!current || current.pointerId !== event.pointerId) {
    return;
  }
  drag.value = null;
  if (svg.value?.hasPointerCapture(event.pointerId)) {
    svg.value.releasePointerCapture(event.pointerId);
  }
  const before = current.draft.positions.find((position) => position.id === current.id);
  if (cancelled || !before || (before.x === current.x && before.z === current.z)) {
    preview.value = null;
    return;
  }
  void move(current.id, current.x, current.z, current.draft);
}

function nudge(event: KeyboardEvent): boolean {
  const object = selected.value;
  const position = point.value;
  const state = saved.value;
  const step = event.shiftKey ? 10 : 1;
  const offsets: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const offset = offsets[event.key];
  if (!offset || !object || !position || !state || deleted.value.has(object.id)) {
    return false;
  }
  void move(object.id, position.x + offset[0], position.z + offset[1], state.draft);
  return true;
}

function onKey(event: KeyboardEvent): void {
  if (event.defaultPrevented || (event.target as Element).closest('input, textarea, [contenteditable="true"]') || locked.value) {
    return;
  }
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'z') {
    history(event.shiftKey ? 'redo' : 'undo');
  } else if ((event.ctrlKey || event.metaKey) && key === 'y') {
    history('redo');
  } else if (event.key === 'Delete') {
    removeSelected();
  } else if (!nudge(event)) {
    return;
  }
  event.preventDefault();
}

let placementTimer: ReturnType<typeof setTimeout> | undefined;
let placementRequest = 0;
watch(
  [() => saved.value?.selected, () => drag.value?.draft ?? saved.value?.draft, showPlacement],
  ([id, current, enabled]) => {
    clearTimeout(placementTimer);
    const request = ++placementRequest;
    placementError.value = null;
    if (!enabled || !id || !current || current.deletedIds?.includes(id)) {
      placement.value = null;
      placementState.value = 'idle';
      return;
    }
    // The previous mask stays until the new one arrives, so the layer does not blink on every selection or move.
    placementState.value = 'loading';
    placementTimer = setTimeout(() => {
      void window.tfaf.stoneMap.adjustmentPlacement(props.jobId, plain({ id, draft: current })).then(
        (map) => {
          if (request === placementRequest) {
            placement.value = { map, pixels: placementPixels(map) };
            placementState.value = 'idle';
          }
        },
        (cause: unknown) => {
          if (request === placementRequest) {
            placement.value = null;
            placementState.value = 'error';
            placementError.value = errorMessage(cause);
          }
        },
      );
    }, PLACEMENT_DELAY_MS);
  },
);

// After the DOM update: a new canvas size clears the canvas, so the mask is drawn once the size is set.
watch(
  [placement, canvas],
  ([current, element]) => {
    const context = element?.getContext('2d');
    if (current && context) {
      const image = context.createImageData(current.map.width, current.map.height);
      image.data.set(current.pixels);
      context.putImageData(image, 0, 0);
    }
  },
  { flush: 'post' },
);

watch(pendingJob, (job) => {
  const state = drafts.get(props.jobId);
  if (!job || !job.terminal || !state || state.pending !== job.id) {
    return;
  }
  const reported = job.error?.issues ?? [];
  const reportedIds = new Set(reported.map((issue) => issue.objectId));
  const retained = unchangedIssues(state.issues, state.issuesAt ?? state.draft, state.draft).filter((issue) => !reportedIds.has(issue.objectId));
  remember({ ...state, pending: null, issues: job.status === 'completed' ? [] : [...retained, ...reported], issuesAt: state.draft });
  if (job.status === 'completed') {
    emit('select', job.id);
  } else {
    error.value = job.error?.message ?? t('stoneMap.adjust.cancelled');
  }
});

watch(() => props.quality, () => void loadBackground());
onMounted(() => {
  void loadScene();
  void loadBackground();
});
onBeforeUnmount(() => {
  clearTimeout(placementTimer);
  if (background.value) {
    URL.revokeObjectURL(background.value);
  }
});

function zoomBy(factor: number): void {
  panZoom.zoom.value = Math.min(MAX_ZOOM, Math.max(1, panZoom.zoom.value * factor));
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col outline-none" tabindex="-1" :aria-label="t('stoneMap.adjust.title')" @keydown="onKey">
    <!-- Fixed heights and no wrapping: the map below must not move when the texts here change. -->
    <div class="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b px-4 [&>*]:shrink-0">
      <Button variant="outline" size="sm" :disabled="locked || !saved?.undo.length" data-tooltip="Ctrl+Z" @click="history('undo')">
        <Undo2 />{{ t('stoneMap.adjust.undo') }}
      </Button>
      <Button variant="outline" size="sm" :disabled="locked || !saved?.redo.length" data-tooltip="Ctrl+Shift+Z / Ctrl+Y" @click="history('redo')">
        <Redo2 />{{ t('stoneMap.adjust.redo') }}
      </Button>
      <Button variant="outline" size="sm" :disabled="locked || !dirty" @click="resetDraft"><RotateCcw />{{ t('stoneMap.adjust.reset') }}</Button>
      <Button
        variant="outline"
        size="sm"
        :disabled="locked || !selected || deleted.has(selected.id) || !!group?.error"
        :data-tooltip="t('stoneMap.adjust.deleteHint')"
        @click="removeSelected"
      >
        <Trash2 />{{ selected?.kind === 'spawn' ? t('stoneMap.adjust.deleteSpawn') : t('stoneMap.adjust.delete') }}
      </Button>
      <Button size="sm" :disabled="locked || !dirty" @click="apply"><Spinner v-if="moving" /><Check v-else />{{ t('stoneMap.adjust.apply') }}</Button>
      <div class="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" :aria-label="t('stoneMap.preview.zoomOut')" :disabled="panZoom.zoom.value <= 1" @click="zoomBy(1 / 1.25)">
          <Minus />
        </Button>
        <Button variant="ghost" size="sm" class="w-16 tabular-nums" :data-tooltip="t('stoneMap.preview.fit')" @click="panZoom.reset">
          {{ Math.round(panZoom.zoom.value * 100) }}%
        </Button>
        <Button variant="ghost" size="icon-sm" :aria-label="t('stoneMap.preview.zoomIn')" :disabled="panZoom.zoom.value >= MAX_ZOOM" @click="zoomBy(1.25)">
          <Plus />
        </Button>
      </div>
    </div>
    <div class="grid h-16 shrink-0 grid-rows-2 border-b px-4 text-xs text-muted-foreground">
      <div class="flex min-w-0 items-center gap-3">
        <span class="min-w-0 truncate tabular-nums">
          <template v-if="selected && point">
            {{ t('stoneMap.adjust.selected', { name: selected.name, x: point.x.toFixed(1), z: point.z.toFixed(1), copies: group?.members.length ?? 1 }) }}
            <template v-if="deleted.has(selected.id)"> · {{ t('stoneMap.adjust.willDelete') }}</template>
            <template v-else-if="selected.ownerSpawnId"> · {{ t('stoneMap.adjust.baseResource') }}</template>
          </template>
          <template v-else>{{ t('stoneMap.adjust.pick') }}</template>
        </span>
        <span v-if="moving" class="shrink-0">{{ t('stoneMap.adjust.checking') }}</span>
        <span v-else-if="pendingJob" class="shrink-0 tabular-nums">{{ stageLabel(pendingJob.progress.stage) }}: {{ pendingJob.progress.percent.toFixed(0) }}%</span>
        <span v-else-if="dirty" class="shrink-0">{{ t('stoneMap.adjust.unapplied') }}</span>
        <Button v-if="saved?.pending" variant="ghost" size="xs" class="shrink-0" @click="cancelPending">{{ t('stoneMap.adjust.cancelJob') }}</Button>
      </div>
      <div class="flex min-w-0 items-center gap-3">
        <Label class="shrink-0 cursor-pointer gap-2 text-xs font-normal">
          <Switch v-model="showPlacement" />{{ t('stoneMap.adjust.placement') }}
        </Label>
        <span v-if="showPlacement" class="min-w-0 truncate" :class="{ 'text-destructive': placementState === 'error' }">
          {{
            !selected || deleted.has(selected.id)
              ? t('stoneMap.adjust.placementPick')
              : placementState === 'loading' && !placement
                ? t('stoneMap.adjust.placementLoading')
                : (placementError ?? t('stoneMap.adjust.placementLegend'))
          }}
        </span>
        <Spinner v-if="showPlacement && placementState === 'loading' && placement" class="size-3 shrink-0" />
      </div>
    </div>

    <div class="flex min-h-0 flex-1">
      <div
        ref="stage"
        class="relative min-w-0 flex-1 overflow-hidden bg-muted/30"
        :class="{ 'cursor-grab': panZoom.zoom.value > 1 && !panZoom.drag.value, 'cursor-grabbing': panZoom.drag.value }"
        @wheel.prevent="panZoom.onWheel"
        @pointerdown="panZoom.onPointerDown"
        @pointermove="panZoom.onPointerMove"
        @pointerup="panZoom.onPointerUp"
        @pointercancel="panZoom.onPointerUp"
      >
        <div v-if="!scene || !saved" class="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          <Spinner v-if="!error" class="size-6 text-primary" />
          <span v-else>{{ t('stoneMap.adjust.failed') }}</span>
        </div>
        <div v-else class="absolute inset-0 flex items-center justify-center">
          <div class="relative shrink-0" :style="{ width: `${side}px`, height: `${side}px`, transform: panZoom.transform.value }">
            <img v-if="background" :src="background" alt="" draggable="false" class="absolute inset-0 size-full" />
            <canvas
              v-if="showPlacement && placement"
              ref="canvas"
              :width="placement.map.width"
              :height="placement.map.height"
              class="pointer-events-none absolute inset-0 size-full [image-rendering:pixelated]"
            />
            <svg
              ref="svg"
              class="absolute inset-0 size-full touch-none"
              :viewBox="`0 0 ${scene.mapSize} ${scene.mapSize}`"
              @pointermove="pointerMove"
              @pointerup="release($event)"
              @pointercancel="release($event, true)"
            >
              <g
                v-for="object in visible"
                :key="object.id"
                role="button"
                :tabindex="locked ? -1 : 0"
                :aria-label="`${object.name}, ${kindLabel(object.kind)}`"
                :aria-pressed="selected?.id === object.id"
                :data-tooltip="[object.name, ...(issues.get(object.id) ?? [])].join(' · ')"
                class="cursor-pointer outline-none"
                :transform="`translate(${positions.get(object.id)?.x ?? object.x} ${positions.get(object.id)?.z ?? object.z})`"
                @pointerdown="pointerDown($event, object.id)"
                @focus="select(object.id)"
              >
                <circle :r="9 * unit" fill="transparent" />
                <circle
                  v-if="object.kind === 'spawn'"
                  :r="6 * unit"
                  :stroke-width="(selected?.id === object.id ? 2.5 : linked.has(object.id) ? 2 : 1) * unit"
                  :class="issues.has(object.id) ? 'fill-destructive' : 'fill-primary'"
                  :stroke="linked.has(object.id) ? 'white' : 'black'"
                />
                <rect
                  v-else
                  :x="-4 * unit"
                  :y="-4 * unit"
                  :width="8 * unit"
                  :height="8 * unit"
                  :transform="object.kind === 'mex' ? 'rotate(45)' : undefined"
                  :stroke-width="(selected?.id === object.id ? 2.5 : linked.has(object.id) ? 2 : 1) * unit"
                  :fill="issues.has(object.id) ? undefined : object.kind === 'mex' ? '#2dd4bf' : '#facc15'"
                  :class="{ 'fill-destructive': issues.has(object.id) }"
                  :stroke="linked.has(object.id) ? 'white' : 'black'"
                />
                <text
                  v-if="object.kind === 'spawn'"
                  :y="-10 * unit"
                  :font-size="11 * unit"
                  text-anchor="middle"
                  class="pointer-events-none fill-foreground font-semibold"
                >
                  {{ Number(object.id.split(':')[1]) + 1 }}
                </text>
              </g>
            </svg>
          </div>
        </div>
        <div
          v-if="error"
          class="absolute inset-x-4 bottom-4 flex items-start gap-2 rounded-md border border-destructive/50 bg-background/95 px-3 py-2 text-sm text-destructive shadow-md"
          role="alert"
          @pointerdown.stop
          @wheel.stop
        >
          <span class="min-w-0 flex-1 selectable">{{ error }}</span>
          <Button variant="ghost" size="icon-xs" :aria-label="t('common.close')" @click="error = null"><X /></Button>
        </div>
      </div>

      <aside class="flex w-60 shrink-0 flex-col gap-2 border-l p-3">
        <div class="flex items-center justify-between">
          <strong class="text-sm">{{ t('stoneMap.adjust.objects') }}</strong>
          <span class="text-xs text-muted-foreground tabular-nums">{{ visible.length }}</span>
        </div>
        <Input v-model="search" type="search" :placeholder="t('stoneMap.adjust.search')" :aria-label="t('stoneMap.adjust.search')" />
        <Select v-model="kindFilter">
          <SelectTrigger size="sm" class="w-full" :aria-label="t('stoneMap.adjust.kind')"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{{ t('stoneMap.adjust.allKinds') }}</SelectItem>
            <SelectItem value="spawn">{{ t('stoneMap.adjust.spawns') }}</SelectItem>
            <SelectItem value="mex">{{ t('stoneMap.adjust.mexes') }}</SelectItem>
            <SelectItem value="hydro">{{ t('stoneMap.adjust.hydros') }}</SelectItem>
          </SelectContent>
        </Select>
        <Label class="cursor-pointer gap-2 text-xs font-normal">
          <Switch v-model="onlyErrors" />{{ t('stoneMap.adjust.onlyErrors', { count: issues.size }) }}
        </Label>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <button
            v-for="object in rows"
            :key="object.id"
            type="button"
            class="flex w-full flex-col items-start rounded px-2 py-1 text-left text-xs hover:bg-accent/40"
            :class="{ 'bg-accent/60': selected?.id === object.id, 'opacity-50': deleted.has(object.id) }"
            @click="select(object.id)"
          >
            <span class="font-medium" :class="{ 'text-destructive': issues.has(object.id) }">{{ kindLabel(object.kind) }} · {{ object.name }}</span>
            <span class="text-muted-foreground tabular-nums">
              {{
                deleted.has(object.id)
                  ? t('stoneMap.adjust.willDelete')
                  : `X ${(positions.get(object.id)?.x ?? object.x).toFixed(1)} · Z ${(positions.get(object.id)?.z ?? object.z).toFixed(1)}`
              }}
            </span>
            <span v-if="issues.has(object.id)" class="text-destructive">{{ issues.get(object.id)?.join('; ') }}</span>
          </button>
          <p v-if="rows.length === 0" class="px-2 text-xs text-muted-foreground">{{ t('stoneMap.adjust.noObjects') }}</p>
        </div>
        <p class="text-xs text-muted-foreground">{{ t('stoneMap.adjust.hint') }}</p>
      </aside>
    </div>
  </section>
</template>
