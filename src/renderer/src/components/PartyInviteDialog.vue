<script setup lang="ts">
import { Check, UserPlus } from '@lucide/vue';
import { onMounted, ref, watch } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { MatchmakerPlayer } from '../../../shared/contract.ts';
import { useDeferredClose } from '../composables/useDeferredClose.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';
import CountryFlag from './CountryFlag.vue';
import SearchInput from './SearchInput.vue';

const emit = defineEmits<{ close: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));

const SEARCH_DELAY_MS = 200;

const query = ref('');
const players = ref<MatchmakerPlayer[]>([]);
const invited = ref(new Set<number>());
const error = ref<string | null>(null);
const loaded = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
let latest = 0;

// Without a query the friends who are online are offered. An answer to an older query is dropped.
async function load(text: string): Promise<void> {
  const request = ++latest;
  try {
    const found = await window.tfaf.matchmaker.findPlayers(text.trim());
    if (request === latest) {
      players.value = found;
      loaded.value = true;
      error.value = null;
    }
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}

watch(query, (text) => {
  if (timer) {
    clearTimeout(timer);
  }
  timer = setTimeout(() => void load(text), SEARCH_DELAY_MS);
});

onMounted(() => void load(''));

async function invite(player: MatchmakerPlayer): Promise<void> {
  error.value = null;
  try {
    await window.tfaf.matchmaker.invite(player.id);
    invited.value = new Set([...invited.value, player.id]);
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && close()">
    <DialogContent class="gap-4 sm:max-w-md" @close-auto-focus="onContentClosed">
      <DialogHeader>
        <DialogTitle class="font-display text-lg">{{ t('matchmaker.inviteDialog.title') }}</DialogTitle>
        <DialogDescription>{{ t('matchmaker.inviteDialog.description') }}</DialogDescription>
      </DialogHeader>
      <SearchInput v-model="query" :placeholder="t('matchmaker.inviteDialog.nickPlaceholder')" :maxlength="50" />
      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
      <span v-if="!query.trim() && players.length" class="-mb-2 text-xs text-faint">{{ t('matchmaker.inviteDialog.friendsOnline') }}</span>
      <div class="flex max-h-80 min-h-24 flex-col overflow-y-auto">
        <div v-for="player in players" :key="player.id" class="plate cut-xs flex h-10 shrink-0 items-center gap-2 px-2 [--plate-border:transparent] hover:bg-secondary">
          <CountryFlag :country="player.country" />
          <span class="min-w-0 flex-1 truncate">
            <span v-if="player.clan" class="text-primary">[{{ player.clan }}] </span>{{ player.login }}
          </span>
          <Badge v-if="player.friend && query.trim()" variant="success">{{ t('matchmaker.inviteDialog.friend') }}</Badge>
          <Button v-if="invited.has(player.id)" size="sm" variant="ghost" disabled><Check />{{ t('matchmaker.inviteDialog.sent') }}</Button>
          <Button v-else size="sm" variant="outline" @click="invite(player)"><UserPlus />{{ t('matchmaker.inviteDialog.invite') }}</Button>
        </div>
        <p v-if="!loaded" class="py-6 text-center text-sm text-muted-foreground">{{ t('common.loading') }}</p>
        <p v-else-if="query.trim() && players.length === 0" class="py-6 text-center text-sm text-muted-foreground">
          {{ t('matchmaker.inviteDialog.noneWithNick') }}
        </p>
        <p v-else-if="!query.trim() && players.length === 0" class="py-6 text-center text-sm text-muted-foreground">
          {{ t('matchmaker.inviteDialog.noFriendsOnline') }}
        </p>
      </div>
    </DialogContent>
  </Dialog>
</template>
