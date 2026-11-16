<script setup lang="ts">
import { CircleCheck, ExternalLink, FolderOpen, TriangleAlert, Upload } from '@lucide/vue';
import { computed, ref, shallowRef } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { type UploadCandidate, VAULT_RULES_URL } from '../../../shared/contract.ts';
import { useDeferredClose } from '../composables/useDeferredClose.ts';
import { errorMessage, isCancelled, joinParts, mapSizeLabel, playersLabel } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { openExternal } from '../lib/links.ts';
import { queryClient } from '../lib/queries.ts';

// A map or mod folder to the FAF vault: pick, check on this computer, agree to the rules, upload.
const props = defineProps<{ kind: 'map' | 'mod' }>();
const emit = defineEmits<{ close: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));

const candidate = shallowRef<UploadCandidate | null>(null);
const picking = ref(false);
const uploading = ref(false);
const done = ref(false);
const error = ref<string | null>(null);
const ranked = ref(false);
const rulesAccepted = ref(false);

const canUpload = computed(() => candidate.value !== null && candidate.value.problems.length === 0 && rulesAccepted.value && !uploading.value);
const details = computed(() => {
  const value = candidate.value;
  if (!value) {
    return null;
  }
  return props.kind === 'map'
    ? joinParts(value.maxPlayers ? playersLabel(value.maxPlayers) : null, mapSizeLabel(value.widthPx, value.heightPx))
    : joinParts(value.author ? t('vault.upload.byAuthor', { author: value.author }) : null, value.uiOnly ? t('vault.upload.uiMod') : t('vault.upload.simMod'));
});

async function pick(): Promise<void> {
  picking.value = true;
  error.value = null;
  done.value = false;
  try {
    const next = await window.tfaf.uploads.pick(props.kind);
    if (next) {
      candidate.value = next;
      rulesAccepted.value = false;
    }
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    picking.value = false;
  }
}

// The progress and the cancel are in the task card; closing the dialog does not stop the upload.
async function upload(): Promise<void> {
  const value = candidate.value;
  if (!value || !canUpload.value) {
    return;
  }
  uploading.value = true;
  error.value = null;
  try {
    await (props.kind === 'map' ? window.tfaf.uploads.uploadMap(value.token, ranked.value) : window.tfaf.uploads.uploadMod(value.token));
    done.value = true;
    candidate.value = null;
    void queryClient.invalidateQueries({ queryKey: [props.kind === 'map' ? 'maps' : 'mods', 'vault'] });
  } catch (cause) {
    error.value = isCancelled(cause) ? null : errorMessage(cause);
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && close()">
    <DialogContent class="gap-4 sm:max-w-xl" @close-auto-focus="onContentClosed">
      <DialogHeader>
        <DialogTitle class="font-display text-lg">{{ kind === 'map' ? t('vault.upload.mapTitle') : t('vault.upload.modTitle') }}</DialogTitle>
        <DialogDescription>{{ kind === 'map' ? t('vault.upload.mapDescription') : t('vault.upload.modDescription') }}</DialogDescription>
      </DialogHeader>

      <Alert v-if="done" class="flex items-start gap-2">
        <CircleCheck class="mt-0.5 size-4 shrink-0 text-success" />
        <AlertDescription>{{ kind === 'map' ? t('vault.upload.mapDone') : t('vault.upload.modDone') }}</AlertDescription>
      </Alert>

      <div v-if="candidate" class="plate cut-sm flex gap-4 bg-background p-3">
        <img v-if="candidate.previewDataUrl" :src="candidate.previewDataUrl" alt="" class="size-28 shrink-0 object-cover" draggable="false" />
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="font-display text-base font-semibold wrap-anywhere selectable">{{ candidate.name }}</span>
          <div class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge v-if="candidate.version" variant="muted">{{ t('vault.versionTitle', { version: candidate.version }) }}</Badge>
            <span v-if="details">{{ details }}</span>
          </div>
          <p class="line-clamp-4 text-[13px] whitespace-pre-line text-foreground/85 selectable">
            {{ candidate.description || t('vault.noDescription') }}
          </p>
          <span class="truncate text-xs text-faint selectable" :data-tooltip="candidate.folderName">{{ candidate.folderName }}</span>
        </div>
      </div>

      <ul v-if="candidate?.problems.length || candidate?.warnings.length" class="flex flex-col gap-1.5 text-[13px]">
        <li v-for="problem in candidate.problems" :key="problem" class="flex items-start gap-2 text-destructive">
          <TriangleAlert class="mt-0.5 size-4 shrink-0" /><span class="selectable">{{ problem }}</span>
        </li>
        <li v-for="warning in candidate.warnings" :key="warning" class="flex items-start gap-2 text-warning">
          <TriangleAlert class="mt-0.5 size-4 shrink-0" /><span class="selectable">{{ warning }}</span>
        </li>
      </ul>

      <div v-if="candidate && !candidate.problems.length" class="flex flex-col gap-3">
        <Label v-if="kind === 'map'" class="flex cursor-pointer items-start gap-2.5 font-normal">
          <Checkbox v-model="ranked" class="mt-0.5" />
          <span class="flex flex-col gap-0.5">
            {{ t('vault.upload.ranked') }}
            <span class="text-xs text-muted-foreground">{{ t('vault.upload.rankedHint') }}</span>
          </span>
        </Label>
        <Label class="flex cursor-pointer items-start gap-2.5 font-normal">
          <Checkbox v-model="rulesAccepted" class="mt-0.5" />
          <span class="flex flex-col gap-0.5">
            {{ t('vault.upload.rules') }}
            <button type="button" class="flex items-center gap-1 self-start text-xs text-info hover:underline" @click.prevent="openExternal(VAULT_RULES_URL)">
              {{ t('vault.upload.readRules') }}<ExternalLink class="size-3" />
            </button>
          </span>
        </Label>
      </div>

      <Alert v-if="error" variant="destructive"><AlertDescription class="whitespace-pre-line selectable">{{ error }}</AlertDescription></Alert>
      <p v-if="uploading" class="flex items-center gap-2 text-xs text-muted-foreground"><Spinner />{{ t('vault.upload.inProgress') }}</p>

      <DialogFooter>
        <Button variant="outline" class="mr-auto" :disabled="picking || uploading" @click="pick">
          <Spinner v-if="picking" />
          <FolderOpen v-else />
          {{ candidate ? t('vault.upload.pickOther') : t('vault.upload.pick') }}
        </Button>
        <Button variant="ghost" @click="close">{{ t('common.close') }}</Button>
        <Button :disabled="!canUpload" @click="upload">
          <Spinner v-if="uploading" />
          <Upload v-else />
          {{ t('vault.upload.upload') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
