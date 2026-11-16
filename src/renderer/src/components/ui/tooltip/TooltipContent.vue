<script setup lang="ts">
import type { TooltipContentEmits, TooltipContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { cn } from "@/lib/utils"
import { TooltipContent, TooltipPortal, useForwardPropsEmits } from "reka-ui"

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<TooltipContentProps & { class?: HTMLAttributes["class"] }>(), {
  sideOffset: 4,
})

const emits = defineEmits<TooltipContentEmits>()

const delegatedProps = reactiveOmit(props, "class")
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      data-slot="tooltip-content"
      v-bind="{ ...forwarded, ...$attrs }"
      :class="cn('plate cut-xs bg-popover text-popover-foreground [--plate-border:var(--color-input)] animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 z-50 w-fit px-3 py-1.5 text-xs text-balance', props.class)"
    >
      <slot />
    </TooltipContent>
  </TooltipPortal>
</template>
