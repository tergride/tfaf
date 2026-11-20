<script setup lang="ts">
import { Dices } from '@lucide/vue';
import { Toggle } from '@/components/ui/toggle';
import { t } from '../../lib/i18n.ts';
import { useRandomChoice } from './randomChoice.ts';

const props = defineProps<{ path: string; label: string }>();
const { isRandom, toggle } = useRandomChoice();
</script>

<template>
  <Toggle
    size="sm"
    class="shrink-0"
    :model-value="isRandom(props.path)"
    :aria-label="t('stoneMap.settings.randomOf', { label: props.label })"
    :data-tooltip="t('stoneMap.settings.randomHint')"
    @update:model-value="(value) => toggle(props.path, value)"
  >
    <Dices />
  </Toggle>
</template>
