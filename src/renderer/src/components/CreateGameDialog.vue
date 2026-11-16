<script setup lang="ts">
import { Eye, EyeOff } from '@lucide/vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { toTypedSchema } from '@vee-validate/zod';
import { useForm } from 'vee-validate';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import {
  NumberField,
  NumberFieldContent,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@/components/ui/number-field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { HOST_GAME_LIMITS, type HostGameDraft, type HostGamePreset, isTfafLobbyFeaturedMod, type LobbyMode } from '../../../shared/contract.ts';
import { useDeferredClose } from '../composables/useDeferredClose.ts';
import { rememberMap } from '../composables/useRecentMaps.ts';
import { errorMessage } from '../format.ts';
import { createHostGameSchema, EMPTY_DRAFT, ratingOrderError, takeLegacyDraft } from '../lib/hostGameForm.ts';
import { t } from '../lib/i18n.ts';
import { queries } from '../lib/queries.ts';
import MapPicker from './MapPicker.vue';
import ModPicker from './ModPicker.vue';
import PresetBar from './PresetBar.vue';

// `map` opens the dialog on that map instead of the last one.
const props = defineProps<{ map?: string }>();
const emit = defineEmits<{ close: [] }>();
const { open: dialogOpen, close, onContentClosed } = useDeferredClose(() => emit('close'));

const DRAFT_SAVE_DELAY_MS = 600;
const RATING_FORMAT: Intl.NumberFormatOptions = { useGrouping: false, maximumFractionDigits: 0 };

const { defineField, errors, values, resetForm, handleSubmit, isSubmitting } = useForm({
  validationSchema: computed(() => toTypedSchema(createHostGameSchema())),
  initialValues: EMPTY_DRAFT,
});
const [title, titleAttrs] = defineField('title');
const [password, passwordAttrs] = defineField('password');
const [featuredMod] = defineField('featuredMod');
const [mapFolderName] = defineField('mapFolderName');
const [modUids] = defineField('modUids');
const [friendsOnly] = defineField('friendsOnly');
const [ratingMin] = defineField('ratingMin');
const [ratingMax] = defineField('ratingMax');
const [enforceRatingRange] = defineField('enforceRatingRange');
const [modIsolation] = defineField('modIsolation');
const [lobbyMode] = defineField('lobbyMode');

const queryClient = useQueryClient();
const featuredModsQuery = useQuery(queries.featuredMods());
const mapsQuery = useQuery(queries.installedMaps());
const modsQuery = useQuery(queries.installedMods());
const allFeaturedMods = computed(() => featuredModsQuery.data.value ?? []);
const maps = computed(() => mapsQuery.data.value ?? []);
const mods = computed(() => modsQuery.data.value ?? []);
const presets = ref<HostGamePreset[]>([]);
const activePresetId = ref<string | null>(null);
const loading = ref(true);
const loadErrors = computed(() => ({
  featuredMods: featuredModsQuery.error.value ? errorMessage(featuredModsQuery.error.value) : undefined,
  maps: mapsQuery.error.value ? errorMessage(mapsQuery.error.value) : undefined,
  mods: modsQuery.error.value ? errorMessage(modsQuery.error.value) : undefined,
}));
const submitError = ref<string | null>(null);
const showPassword = ref(false);
const draftLoaded = ref(false);
let draftTimer: ReturnType<typeof setTimeout> | undefined;
let draftDirty = false;

const ratingError = computed(() => ratingOrderError(ratingMin.value ?? null, ratingMax.value ?? null));
const tfafLobby = computed(() => lobbyMode.value === 'tfaf');
// A TFAF lobby plays only the featured mods whose files the launcher reads.
const featuredMods = computed(() => (tfafLobby.value ? allFeaturedMods.value.filter((mod) => isTfafLobbyFeaturedMod(mod.technicalName)) : allFeaturedMods.value));
const LOBBY_MODES: readonly LobbyMode[] = ['faf', 'tfaf'];

function pickLobbyMode(mode: LobbyMode): void {
  lobbyMode.value = mode;
  if (mode === 'tfaf' && !isTfafLobbyFeaturedMod(featuredMod.value ?? '')) {
    featuredMod.value = 'faf';
  }
}

const selectedMods = computed({
  get: () => modUids.value ?? [],
  set: (value: string[]) => {
    modUids.value = value;
  },
});
const selectedMap = computed({
  get: () => mapFolderName.value ?? '',
  set: (value: string) => {
    mapFolderName.value = value;
  },
});

function toRating(value: number | undefined): number | null {
  return value === undefined || !Number.isInteger(value) ? null : value;
}

function draftRating(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= HOST_GAME_LIMITS.ratingMax
    ? value
    : null;
}

/** The form as a draft the main process accepts: within the limits, but not necessarily ready to host. */
function currentDraft(): HostGameDraft {
  return {
    title: (values.title ?? '').slice(0, HOST_GAME_LIMITS.titleMaxLength),
    password: (values.password ?? '').slice(0, HOST_GAME_LIMITS.passwordMaxLength),
    featuredMod: /^[a-z0-9_]*$/i.test(values.featuredMod ?? '') ? (values.featuredMod ?? '') : '',
    mapFolderName: values.mapFolderName ?? '',
    modUids: [...(values.modUids ?? [])],
    friendsOnly: values.friendsOnly ?? false,
    ratingMin: draftRating(values.ratingMin),
    ratingMax: draftRating(values.ratingMax),
    enforceRatingRange: values.enforceRatingRange ?? false,
    modIsolation: values.modIsolation ?? false,
    lobbyMode: values.lobbyMode ?? 'faf',
  };
}

function saveDraftNow(): void {
  clearTimeout(draftTimer);
  if (!draftDirty) {
    return;
  }
  draftDirty = false;
  window.tfaf.presets.saveDraft(currentDraft()).catch((cause: unknown) => {
    console.warn('Could not save the create-game draft', errorMessage(cause));
  });
}

watch(
  values,
  () => {
    if (!draftLoaded.value) {
      return;
    }
    draftDirty = true;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftNow, DRAFT_SAVE_DELAY_MS);
  },
  { deep: true },
);
onBeforeUnmount(saveDraftNow);

function applyDraft(draft: HostGameDraft): void {
  const allowed = (name: string): boolean => draft.lobbyMode !== 'tfaf' || isTfafLobbyFeaturedMod(name);
  const listed = allFeaturedMods.value.length === 0 || allFeaturedMods.value.some((mod) => mod.technicalName === draft.featuredMod);
  const fallback = allFeaturedMods.value.find((mod) => allowed(mod.technicalName))?.technicalName ?? 'faf';
  resetForm({
    values: { ...draft, featuredMod: listed && allowed(draft.featuredMod) ? draft.featuredMod : fallback },
  });
}

function applyPreset(preset: HostGamePreset): void {
  applyDraft(preset.draft);
  draftDirty = true;
  saveDraftNow();
}

onMounted(async () => {
  // The draft is checked against the lists, so they are there before it is applied; their errors come from the queries.
  const [stored] = await Promise.allSettled([
    window.tfaf.presets.get(),
    queryClient.query({ ...queries.featuredMods(), staleTime: 'static' }),
    queryClient.query({ ...queries.installedMaps(), staleTime: 'static' }),
    queryClient.query({ ...queries.installedMods(), staleTime: 'static' }),
  ]);
  presets.value = stored.status === 'fulfilled' ? stored.value.presets : [];

  const storeAvailable = stored.status === 'fulfilled';
  const lastDraft = storeAvailable ? stored.value.lastDraft : null;
  applyDraft(
    lastDraft ?? {
      ...EMPTY_DRAFT,
      ...(storeAvailable ? takeLegacyDraft() : null),
      modUids: mods.value.filter((mod) => mod.active).map((mod) => mod.uid),
    },
  );
  if (props.map) {
    mapFolderName.value = props.map;
  }
  loading.value = false;
  await nextTick();
  draftLoaded.value = true;
  // The first draft is saved right away, so options taken over from earlier versions survive the next opening.
  if (storeAvailable && !lastDraft) {
    draftDirty = true;
    saveDraftNow();
  }
});

const submit = handleSubmit(async (options) => {
  if (ratingError.value) {
    return;
  }
  submitError.value = null;
  saveDraftNow();
  try {
    await window.tfaf.game.host({ ...options, password: options.password || null });
    rememberMap(options.mapFolderName);
    close();
  } catch (cause) {
    submitError.value = errorMessage(cause);
  }
});

function onOpenChange(open: boolean): void {
  if (!open && !isSubmitting.value) {
    close();
  }
}
</script>

<template>
  <Dialog :open="dialogOpen" @update:open="onOpenChange">
    <DialogContent
      class="flex h-[min(800px,calc(100vh-var(--titlebar-height)-3rem))] max-w-[1080px] flex-col gap-0 p-0 sm:max-w-[1080px]"
      :show-close-button="false"
      @close-auto-focus="onContentClosed"
    >
      <DialogHeader class="flex-row items-center gap-4 border-b px-6 py-4">
        <div class="flex flex-col gap-0.5">
          <DialogTitle class="font-display text-xl">{{ t('hostGame.title') }}</DialogTitle>
          <DialogDescription>{{ t('hostGame.description') }}</DialogDescription>
        </div>
        <PresetBar
          v-if="!loading"
          v-model:presets="presets"
          v-model:active-id="activePresetId"
          class="ml-auto"
          :current-draft="currentDraft"
          :suggested-name="title ?? ''"
          @apply="applyPreset"
        />
      </DialogHeader>

      <div v-if="loading" class="grid flex-1 place-items-center"><Spinner class="size-6 text-primary" /></div>
      <form
        v-else
        id="create-game"
        class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-6 px-6 py-5"
        novalidate
        @submit.prevent="submit"
      >
        <FieldGroup class="min-h-0 gap-5 overflow-y-auto pr-2">
          <Field>
            <FieldLabel>{{ t('hostGame.lobbyMode') }}</FieldLabel>
            <div class="grid grid-cols-2 gap-2" role="radiogroup" :aria-label="t('hostGame.lobbyMode')">
              <button
                v-for="mode in LOBBY_MODES"
                :key="mode"
                type="button"
                role="radio"
                class="plate plate-focus flex flex-col gap-1 px-3 py-2.5 text-left transition-colors"
                :class="lobbyMode === mode ? 'bg-primary/10 [--plate-border:var(--color-primary)]' : 'bg-secondary hover:bg-accent'"
                :aria-checked="lobbyMode === mode"
                @click="pickLobbyMode(mode)"
              >
                <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span class="font-display text-sm font-semibold">{{ t(`hostGame.lobbyModes.${mode}.title`) }}</span>
                  <Badge v-if="mode === 'tfaf'" variant="warning" :data-tooltip="t('tfafLobby.badges.experimentalHint')">{{ t('tfafLobby.badges.experimental') }}</Badge>
                </span>
                <span class="text-[13px] leading-snug text-muted-foreground">{{ t(`hostGame.lobbyModes.${mode}.hint`) }}</span>
              </button>
            </div>
          </Field>

          <Field :data-invalid="!!errors.title">
            <FieldLabel for="game-title">{{ t('hostGame.name') }}</FieldLabel>
            <Input
              id="game-title"
              v-model="title"
              v-bind="titleAttrs"
              :maxlength="HOST_GAME_LIMITS.titleMaxLength"
              :placeholder="t('hostGame.namePlaceholder')"
              :aria-invalid="!!errors.title"
            />
            <FieldError :errors="[errors.title]" />
          </Field>

          <Field :data-invalid="!!errors.password">
            <FieldLabel for="game-password">{{ t('hostGame.password') }}</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="game-password"
                v-model="password"
                v-bind="passwordAttrs"
                :type="showPassword ? 'text' : 'password'"
                :maxlength="HOST_GAME_LIMITS.passwordMaxLength"
                :placeholder="t('hostGame.noPassword')"
                :aria-invalid="!!errors.password"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  size="icon-xs"
                  :aria-label="showPassword ? t('hostGame.hidePassword') : t('hostGame.showPassword')"
                  @click="showPassword = !showPassword"
                >
                  <EyeOff v-if="showPassword" />
                  <Eye v-else />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription v-if="tfafLobby && !password">{{ t('hostGame.tfafLobbyPassword') }}</FieldDescription>
            <FieldError :errors="[errors.password]" />
          </Field>

          <Field :data-invalid="!!errors.featuredMod">
            <FieldLabel for="game-featured-mod">{{ t('hostGame.featuredMod') }}</FieldLabel>
            <Select v-model="featuredMod">
              <SelectTrigger id="game-featured-mod" class="w-full">
                <SelectValue :placeholder="t('hostGame.chooseFeaturedMod')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="mod in featuredMods" :key="mod.technicalName" :value="mod.technicalName">
                  {{ mod.displayName }}
                </SelectItem>
                <SelectItem v-if="featuredMods.length === 0" value="faf">FAF</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription v-if="loadErrors.featuredMods" class="text-warning">
              {{ t('hostGame.featuredModsFailed', { error: loadErrors.featuredMods }) }}
            </FieldDescription>
            <FieldError :errors="[errors.featuredMod]" />
          </Field>

          <Field v-if="!tfafLobby" :data-invalid="!!(errors.ratingMin || errors.ratingMax || ratingError)">
            <FieldLabel>{{ t('hostGame.rating') }}</FieldLabel>
            <div class="flex items-center gap-2">
              <NumberField
                :model-value="ratingMin ?? undefined"
                :min="-HOST_GAME_LIMITS.ratingMax"
                :max="HOST_GAME_LIMITS.ratingMax"
                :step="100"
                :format-options="RATING_FORMAT"
                class="w-36"
                :aria-label="t('hostGame.ratingMin')"
                @update:model-value="(value) => (ratingMin = toRating(value))"
              >
                <NumberFieldContent>
                  <NumberFieldDecrement />
                  <NumberFieldInput :placeholder="t('hostGame.ratingFrom')" />
                  <NumberFieldIncrement />
                </NumberFieldContent>
              </NumberField>
              <span class="text-muted-foreground">—</span>
              <NumberField
                :model-value="ratingMax ?? undefined"
                :min="-HOST_GAME_LIMITS.ratingMax"
                :max="HOST_GAME_LIMITS.ratingMax"
                :step="100"
                :format-options="RATING_FORMAT"
                class="w-36"
                :aria-label="t('hostGame.ratingMax')"
                @update:model-value="(value) => (ratingMax = toRating(value))"
              >
                <NumberFieldContent>
                  <NumberFieldDecrement />
                  <NumberFieldInput :placeholder="t('hostGame.ratingTo')" />
                  <NumberFieldIncrement />
                </NumberFieldContent>
              </NumberField>
            </div>
            <FieldError :errors="[errors.ratingMin, errors.ratingMax, ratingError ?? undefined]" />
          </Field>

          <Label v-if="!tfafLobby" class="cursor-pointer gap-2 font-normal">
            <Switch v-model="enforceRatingRange" />
            {{ t('hostGame.enforceRatingRange') }}
          </Label>

          <Label class="cursor-pointer gap-2 font-normal">
            <Switch v-model="friendsOnly" />
            {{ t('hostGame.friendsOnly') }}
          </Label>

          <Label class="flex items-start gap-2 font-normal" :class="tfafLobby ? 'cursor-not-allowed' : 'cursor-pointer'">
            <Switch
              :model-value="tfafLobby || modIsolation"
              :disabled="tfafLobby"
              class="mt-0.5"
              @update:model-value="(value) => (modIsolation = value)"
            />
            <span class="flex flex-col gap-1">
              <span>{{ t('hostGame.modIsolation') }}</span>
              <span class="text-[13px] text-muted-foreground">{{ t(tfafLobby ? 'hostGame.tfafModIsolationHint' : 'hostGame.modIsolationHint') }}</span>
            </span>
          </Label>

          <Field>
            <FieldLabel>
              {{ t('hostGame.mods') }}
              <span class="text-muted-foreground tabular-nums">{{ selectedMods.length }}</span>
            </FieldLabel>
            <FieldDescription v-if="loadErrors.mods" class="text-warning">
              {{ t('hostGame.modsFailed', { error: loadErrors.mods }) }}
            </FieldDescription>
            <ModPicker v-model="selectedMods" :mods="mods" />
          </Field>
        </FieldGroup>

        <Field class="min-h-0">
          <FieldLabel :class="{ 'text-destructive': errors.mapFolderName }">{{ t('hostGame.map') }}</FieldLabel>
          <FieldDescription v-if="loadErrors.maps" class="text-warning">
            {{ t('hostGame.mapsFailed', { error: loadErrors.maps }) }}
          </FieldDescription>
          <MapPicker v-model="selectedMap" :installed="maps" :invalid="!!errors.mapFolderName" />
          <FieldError :errors="[errors.mapFolderName]" />
        </Field>
      </form>

      <DialogFooter class="items-center border-t px-6 py-4">
        <p v-if="submitError" class="mr-auto text-sm text-destructive selectable">{{ submitError }}</p>
        <Button variant="ghost" :disabled="isSubmitting" @click="close">{{ t('common.cancel') }}</Button>
        <Button type="submit" form="create-game" size="lg" :disabled="loading || isSubmitting">
          <Spinner v-if="isSubmitting" />
          {{ t(tfafLobby ? 'hostGame.createLobby' : 'hostGame.create') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
