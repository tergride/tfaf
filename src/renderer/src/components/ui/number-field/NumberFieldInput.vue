<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"
import { NumberFieldInput } from "reka-ui"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <NumberFieldInput
    data-slot="input"
    :class="cn('plate plate-focus cut-sm flex h-9 w-full bg-background py-1 text-sm text-center tabular-nums transition-colors placeholder:text-faint hover:[--plate-border:var(--color-input)] aria-invalid:[--plate-border:var(--color-destructive)] disabled:cursor-not-allowed disabled:opacity-50', props.class)"
  />
</template>
