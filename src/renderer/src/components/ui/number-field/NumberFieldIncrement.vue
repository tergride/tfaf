<script setup lang="ts">
import type { NumberFieldIncrementProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { Plus } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import { cn } from "@/lib/utils"
import { NumberFieldIncrement, useForwardProps } from "reka-ui"

const props = defineProps<NumberFieldIncrementProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardProps(delegatedProps)
</script>

<template>
  <NumberFieldIncrement data-slot="increment" v-bind="forwarded" :class="cn('absolute top-1/2 -translate-y-1/2 right-0 z-1 p-3 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40', props.class)">
    <slot>
      <Plus class="h-4 w-4" />
    </slot>
  </NumberFieldIncrement>
</template>
