<script setup lang="ts">
// The game's start marker, traced from the pixels of commander_alpha. Like there, it is a black outline until a player
// fills it with their colour. An empty one gets a light halo, or the outline would vanish on a dark map.
defineProps<{ color?: string | null }>();
</script>

<template>
  <svg viewBox="0 0 10 12" shape-rendering="crispEdges" aria-hidden="true" :class="!color && 'drop-shadow-[0_0_1px_rgb(255_255_255/0.8)]'">
    <path
      v-if="color"
      :fill="color"
      d="M4 1h2v1h-2zM1 2h2v1h-2zM4 2h2v1h-2zM7 2h2v1h-2zM1 3h8v1h-8zM1 4h1v1h-1zM4 4h2v1h-2zM8 4h1v1h-1zM1 5h1v1h-1zM3 5h4v1h-4zM8 5h1v1h-1zM3 6h1v1h-1zM6 6h1v1h-1zM3 7h1v1h-1zM6 7h1v1h-1zM2 8h2v1h-2zM6 8h2v1h-2zM2 9h2v1h-2zM6 9h2v1h-2zM2 10h2v1h-2zM6 10h2v1h-2z"
    />
    <path
      fill="#000"
      d="M3 0h4v1h-4zM0 1h4v1h-4zM6 1h4v1h-4zM0 2h1v1h-1zM3 2h1v1h-1zM6 2h1v1h-1zM9 2h1v1h-1zM0 3h1v1h-1zM9 3h1v1h-1zM0 4h1v1h-1zM2 4h2v1h-2zM6 4h2v1h-2zM9 4h1v1h-1zM0 5h1v1h-1zM2 5h1v1h-1zM7 5h1v1h-1zM9 5h1v1h-1zM0 6h3v1h-3zM4 6h2v1h-2zM7 6h3v1h-3zM1 7h2v1h-2zM4 7h2v1h-2zM7 7h2v1h-2zM1 8h1v1h-1zM4 8h2v1h-2zM8 8h1v1h-1zM1 9h1v1h-1zM4 9h2v1h-2zM8 9h1v1h-1zM1 10h1v1h-1zM4 10h2v1h-2zM8 10h1v1h-1zM1 11h8v1h-8z"
    />
  </svg>
</template>
