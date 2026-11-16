<script setup lang="ts">
import { Search, X } from '@lucide/vue';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { t } from '../lib/i18n.ts';

const model = defineModel<string>({ required: true });
defineProps<{ placeholder?: string; maxlength?: number }>();

// Esc first clears the text; only an empty field lets it through to close a dialog.
function onEscape(event: KeyboardEvent): void {
  if (model.value) {
    event.stopPropagation();
    model.value = '';
  }
}
</script>

<template>
  <InputGroup>
    <InputGroupAddon><Search /></InputGroupAddon>
    <InputGroupInput
      v-model="model"
      type="search"
      :placeholder="placeholder"
      :maxlength="maxlength ?? 100"
      class="[&::-webkit-search-cancel-button]:hidden"
      @keydown.esc="onEscape"
    />
    <InputGroupAddon v-if="model" align="inline-end">
      <InputGroupButton type="button" size="icon-xs" :aria-label="t('vault.search.clear')" @click="model = ''"><X /></InputGroupButton>
    </InputGroupAddon>
  </InputGroup>
</template>
