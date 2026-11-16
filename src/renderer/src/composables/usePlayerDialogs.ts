import { computed, ref, shallowRef } from 'vue';

export interface ReportPrefill {
  players?: { id: number; login: string }[];
  /** Logins offered for a quick pick, such as the players of a replay. */
  candidates?: string[];
  gameId?: number | null;
}

// The player dialogs open from many places (chat, game teams, replays, leaderboards, the user menu); the app shows them.
const profile = shallowRef<{ player: number | string; at: number } | null>(null);
const report = shallowRef<{ prefill: ReportPrefill; tab: 'new' | 'list'; at: number } | null>(null);
const avatars = ref(false);

export function usePlayerDialogs() {
  return {
    profile: computed(() => profile.value),
    report: computed(() => report.value),
    avatars: computed(() => avatars.value),
    /** By id, or by login where only that is known (replays). */
    openProfile(player: number | string): void {
      profile.value = { player, at: Date.now() };
    },
    closeProfile(): void {
      profile.value = null;
    },
    openReport(prefill: ReportPrefill = {}, tab: 'new' | 'list' = 'new'): void {
      report.value = { prefill, tab, at: Date.now() };
    },
    closeReport(): void {
      report.value = null;
    },
    openAvatars(): void {
      avatars.value = true;
    },
    closeAvatars(): void {
      avatars.value = false;
    },
  };
}
