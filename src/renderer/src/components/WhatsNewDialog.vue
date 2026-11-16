<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { AppRelease } from '../../../shared/contract.ts';
import { compareVersions, parseVersion } from '../../../shared/versions.ts';
import { locale, t } from '../lib/i18n.ts';
import ReleaseNotes from './ReleaseNotes.vue';

// After an update, the notes of the versions since the one the user saw last, from the changelog in the build.
const SEEN_VERSION_KEY = 'tfaf.seenVersion';
// App.vue remembers the last section from the first versions on, so a profile that has it is not a fresh install.
const LAST_VIEW_KEY = 'tfaf.lastView';

const emit = defineEmits<{ history: [] }>();
const open = ref(false);
const releases = ref<AppRelease[]>([]);
const latest = computed(() => releases.value[0]?.version ?? '');
const shown = computed(() => releases.value.map((release) => ({ version: release.version, notes: release.notes[locale.value] })));

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function showHistory(): void {
  open.value = false;
  emit('history');
}

onMounted(async () => {
  const current = (await window.tfaf.appUpdate.getState()).currentVersion;
  const seen = parseVersion(readStorage(SEEN_VERSION_KEY) ?? '');
  try {
    localStorage.setItem(SEEN_VERSION_KEY, current);
  } catch {
    // Without storage the dialog stays quiet rather than showing on every start.
    return;
  }
  // A version that predates this dialog left no mark: only the notes of the installed version are shown then.
  if (seen === current || (seen === null && readStorage(LAST_VIEW_KEY) === null)) {
    return;
  }
  if (!(await window.tfaf.settings.get()).notifications.whatsNew) {
    return;
  }
  const { releases: all } = await window.tfaf.appUpdate.releases(false);
  releases.value = all.filter(
    (release) =>
      compareVersions(release.version, current) <= 0 &&
      (seen === null ? release.version === current : compareVersions(release.version, seen) > 0),
  );
  open.value = releases.value.length > 0;
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="gap-4 sm:max-w-xl">
      <DialogHeader>
        <DialogTitle class="font-display text-lg">{{ t('about.whatsNew.title', { version: latest }) }}</DialogTitle>
        <DialogDescription>{{ t('about.whatsNew.description') }}</DialogDescription>
      </DialogHeader>
      <div class="-mr-2 flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-2">
        <section v-for="release in shown" :key="release.version" class="flex flex-col gap-2">
          <h3 v-if="shown.length > 1" class="font-display text-base font-semibold">{{ release.version }}</h3>
          <ReleaseNotes :blocks="release.notes" />
        </section>
      </div>
      <DialogFooter>
        <Button variant="ghost" @click="showHistory">{{ t('about.whatsNew.history') }}</Button>
        <Button @click="open = false">{{ t('about.whatsNew.close') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
