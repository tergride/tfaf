<script setup lang="ts">
import { EMOTICON_GROUPS } from '../lib/chatText.ts';

defineEmits<{ pick: [shortcode: string] }>();
</script>

<template>
  <div class="flex max-h-72 w-72 flex-col gap-3 overflow-y-auto p-1">
    <div v-for="group in EMOTICON_GROUPS" :key="group.name" class="flex flex-col gap-1.5">
      <div class="px-1 text-xs text-faint">{{ group.name }}</div>
      <div class="grid grid-cols-8 gap-0.5">
        <button
          v-for="emoticon in group.emoticons"
          :key="emoticon.shortcodes[0]"
          type="button"
          class="plate plate-focus cut-xs grid size-8 place-items-center [--plate-border:transparent] hover:bg-accent"
          :data-tooltip="emoticon.shortcodes.join('  ')" :aria-label="emoticon.shortcodes.join('  ')"
          @click="$emit('pick', emoticon.shortcodes[0]!)"
        >
          <img :src="emoticon.src" alt="" class="size-5" draggable="false" />
        </button>
      </div>
    </div>
  </div>
</template>
