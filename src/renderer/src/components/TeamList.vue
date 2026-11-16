<script setup lang="ts" generic="P">
import { teamLabel } from '../format.ts';

defineProps<{ teams: { team: number; players: P[] }[]; playerKey: (player: P) => string }>();
defineSlots<{ default(props: { player: P }): unknown }>();
</script>

<template>
  <div class="flex flex-col gap-3">
    <section v-for="team in teams" :key="team.team" class="flex flex-col gap-1">
      <h3 class="font-sans text-xs font-normal text-muted-foreground">{{ teamLabel(team.team) }}</h3>
      <ul class="flex flex-col gap-px border bg-border">
        <li
          v-for="player in team.players"
          :key="playerKey(player)"
          class="flex min-h-8 items-center gap-2 bg-background px-2.5 py-1 text-[13px]"
        >
          <slot :player="player" />
        </li>
      </ul>
    </section>
  </div>
</template>
