<script setup lang="ts">
import { computed } from 'vue';
import type { ReleaseNoteBlock } from '../../../shared/contract.ts';

const props = defineProps<{ blocks: readonly ReleaseNoteBlock[] }>();

type Group = { kind: 'heading' | 'paragraph'; text: string } | { kind: 'list'; items: ReleaseNoteBlock[] };

// Items in a row form one list.
const groups = computed(() =>
  props.blocks.reduce<Group[]>((result, block) => {
    if (block.kind === 'heading' || block.kind === 'paragraph') {
      result.push({ kind: block.kind, text: block.text });
      return result;
    }
    const last = result.at(-1);
    if (last?.kind === 'list') {
      last.items.push(block);
    } else {
      result.push({ kind: 'list', items: [block] });
    }
    return result;
  }, []),
);
</script>

<template>
  <div class="flex flex-col gap-2 text-sm selectable">
    <template v-for="(group, index) in groups" :key="index">
      <h4 v-if="group.kind === 'heading'" class="font-sans text-[13px] font-semibold text-muted-foreground [&:not(:first-child)]:mt-1">
        {{ group.text }}
      </h4>
      <p v-else-if="group.kind === 'paragraph'">{{ group.text }}</p>
      <ul v-else-if="group.kind === 'list'" class="flex list-disc flex-col gap-1 pl-5 marker:text-primary">
        <li v-for="(item, itemIndex) in group.items" :key="itemIndex" :class="{ 'ml-5 list-[circle]': item.kind === 'subitem' }">
          {{ item.text }}
        </li>
      </ul>
    </template>
  </div>
</template>
