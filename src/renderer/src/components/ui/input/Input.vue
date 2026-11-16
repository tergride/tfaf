<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { useVModel } from "@vueuse/core"
import { cn } from "@/lib/utils"

const props = defineProps<{
  defaultValue?: string | number
  modelValue?: string | number
  class?: HTMLAttributes["class"]
}>()

const emits = defineEmits<{
  (e: "update:modelValue", payload: string | number): void
}>()

const value = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue,
})
</script>

<template>
  <input
    v-model="value"
    data-slot="input"
    :class="cn(
      'plate plate-focus cut-sm file:text-foreground placeholder:text-faint selection:bg-primary selection:text-primary-foreground h-9 w-full min-w-0 bg-background px-3 py-1 text-base transition-colors file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium hover:[--plate-border:var(--color-input)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
      'aria-invalid:[--plate-border:var(--color-destructive)]',
      props.class,
    )"
  >
</template>
