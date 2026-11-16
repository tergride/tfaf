<script setup lang="ts">
import type { NumberFieldDecrementProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { Minus } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import { cn } from "@/lib/utils"
import { NumberFieldDecrement, useForwardProps } from "reka-ui"

const props = defineProps<NumberFieldDecrementProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardProps(delegatedProps)
</script>

<template>
  <!-- z-1: the input after it is a plate, and its clip-path would paint it over the button. -->
  <NumberFieldDecrement data-slot="decrement" v-bind="forwarded" :class="cn('absolute top-1/2 -translate-y-1/2 left-0 z-1 p-3 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40', props.class)">
    <slot>
      <Minus class="h-4 w-4" />
    </slot>
  </NumberFieldDecrement>
</template>
