<script setup lang="ts">
import type { TabsListProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { cn } from "@/lib/utils"
import { TabsList } from "reka-ui"

const props = defineProps<TabsListProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <TabsList
    data-slot="tabs-list"
    v-bind="delegatedProps"
    :class="cn(
      'plate bg-card text-muted-foreground inline-flex h-9 w-fit items-center justify-center gap-0.5 p-[3px]',
      props.class,
    )"
  >
    <slot />
  </TabsList>
</template>
