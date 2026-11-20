<script setup lang="ts">
import { computed } from 'vue';
import { FieldDescription } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import RandomToggle from './RandomToggle.vue';
import { useRandomChoice } from './randomChoice.ts';

const props = defineProps<{
  id: string;
  label: string;
  modelValue: boolean;
  disabled?: boolean;
  randomPath?: string;
  hint?: string | null;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
const { isRandom } = useRandomChoice();
const random = computed(() => isRandom(props.randomPath));
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex min-h-8 items-center gap-2">
      <Label :for="id" class="flex-1 cursor-pointer gap-2 font-normal" :class="{ 'opacity-50': disabled && !random }">
        <Switch
          :id="id"
          :model-value="random ? false : modelValue"
          :disabled="disabled || random"
          @update:model-value="(value) => emit('update:modelValue', value)"
        />
        {{ label }}
      </Label>
      <RandomToggle v-if="randomPath" :path="randomPath" :label="label" />
    </div>
    <FieldDescription v-if="hint" class="text-xs">{{ hint }}</FieldDescription>
  </div>
</template>
