<script setup lang="ts">
import type { SwitchRootEmits, SwitchRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { cn } from "@/lib/utils"
import {
  SwitchRoot,
  SwitchThumb,
  useForwardPropsEmits,
} from "reka-ui"

const props = defineProps<SwitchRootProps & { class?: HTMLAttributes["class"] }>()

const emits = defineEmits<SwitchRootEmits>()

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <SwitchRoot
    v-slot="slotProps"
    data-slot="switch"
    v-bind="forwarded"
    :class="cn(
      'peer plate plate-control plate-focus cut-xs data-[state=checked]:bg-(--shape-switch-fill) data-[state=checked]:[--plate-border:var(--color-primary)] data-[state=unchecked]:bg-background data-[state=unchecked]:[--plate-border:var(--color-input)] inline-flex h-(--shape-switch-height) w-(--shape-switch-width) shrink-0 items-center transition-colors duration-(--shape-switch-duration) disabled:cursor-not-allowed disabled:opacity-50',
      props.class,
    )"
  >
    <SwitchThumb
      data-slot="switch-thumb"
      :class="cn('data-[state=unchecked]:bg-muted-foreground data-[state=checked]:bg-(--shape-switch-ink) pointer-events-none ml-(--shape-switch-inset) block size-3 rounded-(--shape-thumb-radius) transition-transform duration-(--shape-switch-duration) [clip-path:var(--shape-thumb)] data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0')"
    >
      <slot name="thumb" v-bind="slotProps" />
    </SwitchThumb>
  </SwitchRoot>
</template>
