<template>
  <div class="plate cut-lg @container flex flex-col gap-3 bg-card px-3.5 py-3">
    <div class="flex flex-wrap items-center gap-2.5">
      <slot />
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <slot name="end" />
      </div>
    </div>
    <div v-if="$slots.filters" class="flex flex-wrap items-center gap-x-4.5 gap-y-2.5">
      <slot name="filters" />
    </div>
  </div>
</template>
