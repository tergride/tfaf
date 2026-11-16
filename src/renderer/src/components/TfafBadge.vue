<script setup lang="ts">
import { computed } from 'vue';
import logoUrl from '../assets/logo.png';
import { useChat } from '../composables/useChat.ts';
import { t } from '../lib/i18n.ts';

// The TFAF mark next to a player who plays with this launcher, as far as the chat can tell (ChatState.tfafPlayers).
const props = defineProps<{ login: string }>();
const { state } = useChat();
const label = computed(() => {
  const players = state.value.tfafPlayers;
  const key = props.login.toLowerCase();
  return Object.hasOwn(players, key) ? t('common.tfafPlayer', { version: players[key]! }) : null;
});
</script>

<template>
  <img v-if="label" :src="logoUrl" :alt="label" :data-tooltip="label" class="size-4 shrink-0" draggable="false" />
</template>
