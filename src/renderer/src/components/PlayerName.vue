<script setup lang="ts">
import type { PlayerAvatar } from '../../../shared/contract.ts';
import { usePlayerDialogs } from '../composables/usePlayerDialogs.ts';
import { t } from '../lib/i18n.ts';
import AvatarImage from './AvatarImage.vue';
import TfafBadge from './TfafBadge.vue';

// A player in a list (game teams, replays, leaderboards): the name opens the profile.
const props = defineProps<{ login: string; id?: number | null; clan?: string | null; avatar?: PlayerAvatar | null }>();
const { openProfile } = usePlayerDialogs();
</script>

<template>
  <button
    type="button"
    class="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none hover:underline focus-visible:underline"
    :data-tooltip="t('profile.open', { login })"
    @click="openProfile(props.id ?? login)"
  >
    <AvatarImage v-if="avatar" :avatar="avatar" />
    <span class="truncate"><span v-if="clan" class="mr-1 text-primary">[{{ clan }}]</span>{{ login }}</span>
    <TfafBadge :login="login" />
  </button>
</template>
