<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { useVModel } from "@vueuse/core"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
  defaultValue?: string | number
  modelValue?: string | number
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
  <textarea
    v-model="value"
    data-slot="textarea"
    :class="cn('plate plate-focus cut-sm placeholder:text-faint aria-invalid:[--plate-border:var(--color-destructive)] hover:[--plate-border:var(--color-input)] flex field-sizing-content min-h-16 w-full bg-background px-3 py-2 text-base transition-colors disabled:cursor-not-allowed disabled:opacity-50 md:text-sm', props.class)"
  />
</template>
