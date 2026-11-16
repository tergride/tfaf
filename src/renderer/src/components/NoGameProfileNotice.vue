<script setup lang="ts">
import { Play, TriangleAlert } from '@lucide/vue';
import { ref } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useGameSession } from '../composables/useGameSession.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';

const { state: game } = useGameSession();
const starting = ref(false);
const error = ref<string | null>(null);

// The game makes its profile on the first start. It starts as with «Without server» in the games list: FAF files and
// no lobby; once it closes, the panels read Game.prefs again and show the new profile.
async function launch(): Promise<void> {
  error.value = null;
  starting.value = true;
  try {
    await window.tfaf.game.skirmish(true);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <Alert variant="warning">
    <TriangleAlert />
    <AlertDescription class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span class="min-w-0 flex-1">{{ t('settings.forgedAlliance.noProfile') }}</span>
      <Button size="sm" :disabled="starting || game.phase !== 'idle'" @click="launch">
        <Spinner v-if="starting" />
        <Play v-else />
        {{ t('settings.forgedAlliance.launchGame') }}
      </Button>
    </AlertDescription>
  </Alert>
  <p v-if="error" class="text-[13px] text-destructive selectable">{{ error }}</p>
</template>
