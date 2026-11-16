<script setup lang="ts">
import { Pencil, Trash2 } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, toRaw, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { REVIEW_LIMITS, type ReviewTarget, type VaultReview } from '../../../shared/contract.ts';
import { confirmAction } from '../composables/useConfirm.ts';
import { errorMessage, formatDate } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { queries, queryClient, refreshLists } from '../lib/queries.ts';
import PlayerName from './PlayerName.vue';
import StarRating from './StarRating.vue';

// Reviews of a map or mod (all its versions) or of a game, with the signed-in player's own one to write or change.
const props = defineProps<{ target: ReviewTarget }>();

const SHOWN_AT_FIRST = 5;
// Lists show the review summaries, so they are read again after a change.
const LIST_KEYS: Record<ReviewTarget['kind'], readonly string[]> = {
  map: ['maps', 'vault'],
  mod: ['mods', 'vault'],
  game: ['replays', 'vault'],
};

const query = useQuery(() => queries.reviews(props.target));
const reviews = computed(() => query.data.value ?? []);
const loadError = computed(() => (query.error.value ? errorMessage(query.error.value) : null));
/** The own review of the shown version; one of an older version is listed with the others. */
const own = computed(
  () => reviews.value.find((review) => review.own && (props.target.kind === 'game' || review.versionId === props.target.versionId)) ?? null,
);
const others = computed(() => reviews.value.filter((review) => review !== own.value));
const showAll = ref(false);
const shown = computed(() => (showAll.value ? others.value : others.value.slice(0, SHOWN_AT_FIRST)));

const editing = ref(false);
const score = ref(0);
const text = ref('');
const busy = ref(false);
const error = ref<string | null>(null);

watch(
  () => [props.target.kind, props.target.id, props.target.versionId],
  () => {
    editing.value = false;
    showAll.value = false;
    error.value = null;
  },
);

function edit(review: VaultReview | null): void {
  score.value = review?.score ?? 0;
  text.value = review?.text ?? '';
  error.value = null;
  editing.value = true;
}

async function refresh(): Promise<void> {
  await Promise.all([
    refreshLists(queries.reviews(props.target)),
    queryClient.invalidateQueries({ queryKey: [...LIST_KEYS[props.target.kind]] }),
  ]);
}

async function save(): Promise<void> {
  if (score.value < REVIEW_LIMITS.minScore) {
    error.value = t('reviews.scoreRequired');
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await window.tfaf.reviews.save(toRaw(props.target), own.value?.id ?? null, { text: text.value.trim(), score: score.value });
    editing.value = false;
    await refresh();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}

async function remove(review: VaultReview): Promise<void> {
  const confirmed = await confirmAction({
    title: t('reviews.deleteTitle'),
    description: t('reviews.deleteDescription'),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!confirmed) {
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await window.tfaf.reviews.delete(props.target.kind, review.id);
    editing.value = false;
    await refresh();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="flex flex-col gap-2" :aria-label="t('reviews.title')">
    <h3 class="flex items-center gap-2 font-sans text-xs font-normal text-muted-foreground">
      {{ t('reviews.title') }}
      <span v-if="reviews.length" class="tabular-nums">{{ reviews.length }}</span>
      <Spinner v-if="query.isFetching.value" class="size-3" />
    </h3>

    <p v-if="loadError" class="text-xs text-destructive selectable">{{ loadError }}</p>

    <form v-if="editing" class="plate cut-sm flex flex-col gap-2 bg-background p-3" @submit.prevent="save">
      <span class="text-xs text-muted-foreground">{{ own ? t('reviews.editYours') : t('reviews.writeYours') }}</span>
      <StarRating v-model:score="score" editable />
      <Textarea v-model="text" rows="3" :maxlength="REVIEW_LIMITS.textMaxLength" :placeholder="t('reviews.textPlaceholder')" />
      <div class="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" :disabled="busy" @click="editing = false">{{ t('common.cancel') }}</Button>
        <Button type="submit" size="sm" :disabled="busy"><Spinner v-if="busy" />{{ t('reviews.publish') }}</Button>
      </div>
    </form>
    <div v-else-if="own" class="plate cut-sm flex flex-col gap-1 bg-primary/6 p-3 [--plate-border:color-mix(in_srgb,var(--color-primary)_35%,transparent)]">
      <div class="flex items-center gap-2">
        <span class="text-xs font-semibold text-primary">{{ t('reviews.yours') }}</span>
        <StarRating :score="own.score" />
        <Button variant="ghost" size="icon-xs" class="ml-auto" :data-tooltip="t('reviews.edit')" :aria-label="t('reviews.edit')" :disabled="busy" @click="edit(own)">
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          class="hover:text-destructive"
          :data-tooltip="t('reviews.delete')"
          :aria-label="t('reviews.delete')"
          :disabled="busy"
          @click="remove(own)"
        >
          <Trash2 />
        </Button>
      </div>
      <p v-if="own.text" class="text-[13px] whitespace-pre-line wrap-anywhere selectable">{{ own.text }}</p>
    </div>
    <Button v-else-if="!query.isPending.value" variant="outline" size="sm" class="self-start" @click="edit(null)">
      {{ target.kind === 'game' ? t('reviews.rateGame') : t('reviews.writeYours') }}
    </Button>

    <Alert v-if="error" variant="destructive"><AlertDescription class="selectable">{{ error }}</AlertDescription></Alert>

    <ul v-if="others.length" class="flex flex-col gap-px border bg-border">
      <li v-for="review in shown" :key="review.id" class="flex flex-col gap-1 bg-background px-3 py-2 text-[13px]">
        <div class="flex min-w-0 items-center gap-2">
          <span v-if="review.author" class="flex max-w-1/2 min-w-0 font-semibold"><PlayerName :login="review.author" /></span>
          <StarRating :score="review.score" />
          <Badge v-if="review.version && review.versionId !== target.versionId" variant="muted">
            {{ t('vault.versionTitle', { version: review.version }) }}
          </Badge>
          <Button
            v-if="review.own"
            variant="ghost"
            size="icon-xs"
            class="hover:text-destructive"
            :data-tooltip="t('reviews.delete')"
            :aria-label="t('reviews.delete')"
            :disabled="busy"
            @click="remove(review)"
          >
            <Trash2 />
          </Button>
          <span class="ml-auto shrink-0 text-xs text-muted-foreground">{{ formatDate(review.updatedAt) }}</span>
        </div>
        <p v-if="review.text" class="whitespace-pre-line wrap-anywhere text-foreground/85 selectable">{{ review.text }}</p>
      </li>
    </ul>
    <Button v-if="others.length > SHOWN_AT_FIRST && !showAll" variant="ghost" size="sm" class="self-start" @click="showAll = true">
      {{ t('reviews.showAll', { count: others.length }) }}
    </Button>
    <p v-else-if="!others.length && !own && !query.isPending.value && !loadError" class="text-xs text-faint">{{ t('reviews.none') }}</p>
  </section>
</template>
