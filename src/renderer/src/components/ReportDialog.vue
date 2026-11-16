<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod';
import { Flag, Plus, RefreshCw, X } from '@lucide/vue';
import { useForm } from 'vee-validate';
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  type ModerationReportItem,
  type PlayerSearchResult,
  REPORT_LIMITS,
  type ReportStatus,
} from '../../../shared/contract.ts';
import { useDeferredClose } from '../composables/useDeferredClose.ts';
import type { ReportPrefill } from '../composables/usePlayerDialogs.ts';
import { errorMessage, formatDateTime } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { createReportSchema, incidentTimeError, parseGameIdText } from '../lib/reportForm.ts';

const STATUS: Record<ReportStatus, 'muted' | 'info' | 'success' | 'warning'> = {
  awaiting: 'muted',
  processing: 'info',
  completed: 'success',
  discarded: 'warning',
};
const SEARCH_DELAY_MS = 300;

const props = defineProps<{ prefill: ReportPrefill; tab: 'new' | 'list' }>();
const emit = defineEmits<{ close: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));

const activeTab = ref(props.tab);
const sent = ref(false);
const submitError = ref<string | null>(null);

const { defineField, errors, values, handleSubmit, isSubmitting, resetForm, setFieldError } = useForm({
  validationSchema: computed(() => toTypedSchema(createReportSchema())),
  initialValues: {
    players: props.prefill.players ?? [],
    gameId: props.prefill.gameId ? String(props.prefill.gameId) : '',
    incidentTime: '',
    description: '',
  },
});
const [players] = defineField('players');
const [gameId, gameIdAttrs] = defineField('gameId');
const [incidentTime, incidentTimeAttrs] = defineField('incidentTime');
const [description, descriptionAttrs] = defineField('description');

const query = ref('');
const found = shallowRef<PlayerSearchResult[]>([]);
const searching = ref(false);
const resolving = ref<string | null>(null);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searchRequest = 0;

const chosen = computed(() => new Set((values.players ?? []).map((player) => player.login.toLowerCase())));
const candidates = computed(() => (props.prefill.candidates ?? []).filter((login) => !chosen.value.has(login.toLowerCase())));
const suggestions = computed(() => found.value.filter((player) => !chosen.value.has(player.login.toLowerCase())));
const full = computed(() => (values.players?.length ?? 0) >= REPORT_LIMITS.maxPlayers);

watch(query, (text) => {
  if (searchTimer) {
    clearTimeout(searchTimer);
  }
  const current = ++searchRequest;
  if (text.trim().length < 2) {
    found.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  searchTimer = setTimeout(async () => {
    try {
      const result = await window.tfaf.profile.search(text.trim());
      if (current === searchRequest) {
        found.value = result;
      }
    } catch {
      if (current === searchRequest) {
        found.value = [];
      }
    } finally {
      if (current === searchRequest) {
        searching.value = false;
      }
    }
  }, SEARCH_DELAY_MS);
});
onBeforeUnmount(() => {
  if (searchTimer) {
    clearTimeout(searchTimer);
  }
});

function addPlayer(player: PlayerSearchResult): void {
  if (!full.value && !chosen.value.has(player.login.toLowerCase())) {
    players.value = [...(players.value ?? []), { id: player.id, login: player.login }];
  }
  query.value = '';
}

function removePlayer(id: number): void {
  players.value = (players.value ?? []).filter((player) => player.id !== id);
}

// The players of a replay are known by login only; the id comes from their profile.
async function addCandidate(login: string): Promise<void> {
  resolving.value = login;
  submitError.value = null;
  try {
    const profile = await window.tfaf.profile.get(login);
    addPlayer({ id: profile.id, login: profile.login });
  } catch (cause) {
    submitError.value = errorMessage(cause);
  } finally {
    resolving.value = null;
  }
}

const submit = handleSubmit(async (form) => {
  const timeError = incidentTimeError(form.gameId, form.incidentTime);
  if (timeError) {
    setFieldError('incidentTime', timeError);
    return;
  }
  submitError.value = null;
  try {
    await window.tfaf.reports.submit({
      players: form.players.map((player) => player.id),
      gameId: form.gameId ? parseGameIdText(form.gameId) : null,
      incidentTime: form.incidentTime,
      description: form.description,
    });
    resetForm({ values: { players: [], gameId: '', incidentTime: '', description: '' } });
    sent.value = true;
    activeTab.value = 'list';
    void loadReports();
  } catch (cause) {
    submitError.value = errorMessage(cause);
  }
});

const reports = shallowRef<ModerationReportItem[] | null>(null);
const reportsError = ref<string | null>(null);
const loadingReports = ref(false);

async function loadReports(): Promise<void> {
  loadingReports.value = true;
  reportsError.value = null;
  try {
    reports.value = await window.tfaf.reports.list();
  } catch (cause) {
    reportsError.value = errorMessage(cause);
  } finally {
    loadingReports.value = false;
  }
}

watch(
  activeTab,
  (value) => {
    if (value === 'list' && reports.value === null) {
      void loadReports();
    }
  },
  { immediate: true },
);
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && close()">
    <DialogContent
      class="flex h-[min(680px,calc(100vh-var(--titlebar-height)-3rem))] max-w-[640px] flex-col gap-0 p-0 sm:max-w-[640px]"
      @close-auto-focus="onContentClosed"
    >
      <DialogHeader class="border-b px-6 py-4 pr-14">
        <DialogTitle class="font-display text-xl">{{ t('profile.report.title') }}</DialogTitle>
        <DialogDescription>{{ t('profile.report.description') }}</DialogDescription>
      </DialogHeader>

      <Tabs v-model="activeTab" class="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList class="mx-6 mt-4 grid grid-cols-2">
          <TabsTrigger value="new">{{ t('profile.report.tabs.new') }}</TabsTrigger>
          <TabsTrigger value="list">{{ t('profile.report.tabs.list') }}</TabsTrigger>
        </TabsList>

        <TabsContent value="new" class="min-h-0 overflow-y-auto px-6 py-4">
          <form id="report-form" class="flex flex-col gap-5" @submit.prevent="submit">
            <FieldGroup class="gap-5">
              <Field :data-invalid="!!errors.players">
                <FieldLabel for="report-player">{{ t('profile.report.players') }}</FieldLabel>
                <div v-if="players?.length" class="flex flex-wrap gap-1.5">
                  <span
                    v-for="player in players"
                    :key="player.id"
                    class="plate cut-xs flex h-7 items-center gap-1 bg-secondary pr-0.5 pl-2 text-[13px]"
                  >
                    {{ player.login }}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      :data-tooltip="t('profile.report.removePlayer', { login: player.login })"
                      :aria-label="t('profile.report.removePlayer', { login: player.login })"
                      @click="removePlayer(player.id)"
                    >
                      <X />
                    </Button>
                  </span>
                </div>
                <div class="relative">
                  <Input
                    id="report-player"
                    v-model="query"
                    :placeholder="t('profile.report.playerPlaceholder')"
                    :maxlength="50"
                    :disabled="full"
                    autocomplete="off"
                    :aria-invalid="!!errors.players"
                  />
                  <Spinner v-if="searching" class="absolute top-2.5 right-2.5 size-4 text-muted-foreground" />
                </div>
                <ul v-if="suggestions.length && query.trim()" class="flex flex-col border" role="listbox" :aria-label="t('profile.report.found')">
                  <li v-for="player in suggestions" :key="player.id" role="option" :aria-selected="false">
                    <button
                      type="button"
                      class="flex h-8 w-full items-center gap-2 px-2.5 text-left text-[13px] outline-none hover:bg-secondary focus-visible:bg-secondary"
                      @click="addPlayer(player)"
                    >
                      <Plus class="size-3.5 text-muted-foreground" />{{ player.login }}
                    </button>
                  </li>
                </ul>
                <div v-if="candidates.length" class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {{ t('profile.report.fromGame') }}
                  <Button
                    v-for="login in candidates"
                    :key="login"
                    type="button"
                    variant="outline"
                    size="xs"
                    :disabled="full || resolving !== null"
                    @click="addCandidate(login)"
                  >
                    <Spinner v-if="resolving === login" />{{ login }}
                  </Button>
                </div>
                <FieldError :errors="[errors.players]" />
              </Field>

              <div class="grid grid-cols-2 gap-4">
                <Field :data-invalid="!!errors.gameId">
                  <FieldLabel for="report-game">{{ t('profile.report.gameId') }}</FieldLabel>
                  <Input
                    id="report-game"
                    v-model="gameId"
                    v-bind="gameIdAttrs"
                    :placeholder="t('profile.report.gameIdPlaceholder')"
                    :maxlength="12"
                    :aria-invalid="!!errors.gameId"
                  />
                  <FieldError :errors="[errors.gameId]" />
                </Field>
                <Field :data-invalid="!!errors.incidentTime">
                  <FieldLabel for="report-time">{{ t('profile.report.incidentTime') }}</FieldLabel>
                  <Input
                    id="report-time"
                    v-model="incidentTime"
                    v-bind="incidentTimeAttrs"
                    :placeholder="t('profile.report.incidentTimePlaceholder')"
                    :maxlength="REPORT_LIMITS.incidentTimeMaxLength"
                    :aria-invalid="!!errors.incidentTime"
                  />
                  <FieldError :errors="[errors.incidentTime]" />
                </Field>
              </div>
              <FieldDescription class="-mt-3">{{ t('profile.report.gameHint') }}</FieldDescription>

              <Field :data-invalid="!!errors.description">
                <FieldLabel for="report-description">{{ t('profile.report.text') }}</FieldLabel>
                <Textarea
                  id="report-description"
                  v-model="description"
                  v-bind="descriptionAttrs"
                  rows="6"
                  :maxlength="REPORT_LIMITS.descriptionMaxLength"
                  :placeholder="t('profile.report.textPlaceholder')"
                  :aria-invalid="!!errors.description"
                />
                <FieldError :errors="[errors.description]" />
              </Field>
            </FieldGroup>

            <Alert v-if="submitError" variant="destructive"><AlertDescription class="selectable">{{ submitError }}</AlertDescription></Alert>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
              <Button type="submit" :disabled="isSubmitting">
                <Spinner v-if="isSubmitting" />
                <Flag v-else />
                {{ t('profile.report.send') }}
              </Button>
            </div>
          </form>
        </TabsContent>

        <TabsContent value="list" class="flex min-h-0 flex-col gap-3 overflow-y-auto px-6 py-4">
          <Alert v-if="sent"><AlertDescription>{{ t('profile.report.sent') }}</AlertDescription></Alert>
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted-foreground">{{ t('profile.report.lastYear') }}</span>
            <Button variant="ghost" size="icon-xs" class="ml-auto" :data-tooltip="t('common.refresh')" :aria-label="t('common.refresh')" :disabled="loadingReports" @click="loadReports">
              <RefreshCw />
            </Button>
          </div>
          <Alert v-if="reportsError" variant="destructive"><AlertDescription class="selectable">{{ reportsError }}</AlertDescription></Alert>
          <div v-else-if="reports === null" class="grid h-24 place-items-center"><Spinner class="size-5 text-primary" /></div>
          <p v-else-if="reports.length === 0" class="text-sm text-muted-foreground">{{ t('profile.report.noReports') }}</p>
          <ul v-else class="flex flex-col gap-2">
            <li v-for="report in reports" :key="report.id" class="plate cut-sm flex flex-col gap-1.5 bg-background p-3 text-[13px]">
              <div class="flex flex-wrap items-center gap-2">
                <Badge :variant="STATUS[report.status]">{{ t(`profile.report.statuses.${report.status}`) }}</Badge>
                <span class="font-semibold">{{ report.reported.join(', ') }}</span>
                <span class="ml-auto text-xs text-muted-foreground">{{ formatDateTime(report.createdAt) }}</span>
              </div>
              <span v-if="report.gameId" class="text-xs text-muted-foreground">
                {{ t('profile.report.inGame', { id: report.gameId, time: report.incidentTime ?? '—' }) }}
              </span>
              <p class="line-clamp-4 whitespace-pre-line selectable">{{ report.description }}</p>
              <p v-if="report.moderatorNotice" class="text-xs text-info selectable">
                {{ t('profile.report.moderatorNotice', { notice: report.moderatorNotice }) }}
              </p>
            </li>
          </ul>
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>
</template>
