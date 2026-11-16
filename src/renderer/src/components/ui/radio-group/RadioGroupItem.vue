<script setup lang="ts">
import type { RadioGroupItemProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { cn } from "@/lib/utils"
import {
  RadioGroupIndicator,
  RadioGroupItem,
  useForwardProps,
} from "reka-ui"

const props = defineProps<RadioGroupItemProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <RadioGroupItem
    data-slot="radio-group-item"
    v-bind="forwardedProps"
    :class="
      cn(
        'relative grid aspect-square size-(--shape-mark-size) shrink-0 place-items-center rounded-(--shape-mark-radius) bg-input text-primary transition-[color,box-shadow] outline-none [clip-path:var(--shape-mark)] before:absolute before:inset-[calc((var(--shape-mark-size)_-_16px)/4_+_1px)] before:rounded-[inherit] before:[clip-path:inherit] before:bg-[color-mix(in_srgb,var(--color-input)_30%,var(--color-card))] focus-visible:bg-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:bg-destructive disabled:cursor-not-allowed disabled:opacity-50',
        props.class,
      )
    "
  >
    <!-- The dot is scaled down rather than sized and centered: grid centering snaps to device pixels and shifts it at fractional zoom. -->
    <RadioGroupIndicator
      data-slot="radio-group-indicator"
      class="absolute inset-0 scale-50 rounded-(--shape-mark-radius) bg-primary [clip-path:var(--shape-mark)]"
    >
      <slot />
    </RadioGroupIndicator>
  </RadioGroupItem>
</template>
