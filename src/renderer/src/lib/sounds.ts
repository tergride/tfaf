// The launcher's own sounds, played at the volume set in the settings. The main process decides which events sound.
import type { SoundId } from '../../../shared/contract.ts';
// "Short alarm" by yd, OpenGameArt, CC0.
import filesDifferSound from '../assets/filesDiffer.ogg';
import friendJoinedGameSound from '../assets/friendJoinedGame.mp3';
import friendOfflineSound from '../assets/friendOffline.mp3';
import friendOnlineSound from '../assets/friendOnline.mp3';
import friendStartedPlayingSound from '../assets/friendStartedPlaying.mp3';
import matchFoundSound from '../assets/matchFound.mp3';
import mentionSound from '../assets/mention.mp3';
import notificationSound from '../assets/notification.mp3';
import privateMessageSound from '../assets/privateMessage.mp3';

const SOUNDS: Record<SoundId, string> = {
  matchFound: matchFoundSound,
  privateMessage: privateMessageSound,
  mention: mentionSound,
  friendOnline: friendOnlineSound,
  friendOffline: friendOfflineSound,
  friendJoinedGame: friendJoinedGameSound,
  friendStartedPlaying: friendStartedPlayingSound,
  notification: notificationSound,
  filesDiffer: filesDifferSound,
};

// A burst of the same event (several friends logging in after a server restart) sounds once.
const REPEAT_AFTER_MS = 5_000;

let volume: number | null = null;
const lastPlayed = new Map<SoundId, number>();
// Until the settings answer, a sound waits for them; without them it plays at full volume.
const loaded = window.tfaf.settings.get().then(
  (settings) => {
    volume ??= settings.soundVolume;
  },
  () => {
    volume ??= 100;
  },
);

/** Applies a volume the settings saved, 0–100. */
export function setSoundVolume(percent: number): void {
  volume = percent;
}

export async function playSound(sound: SoundId): Promise<void> {
  await loaded;
  const now = Date.now();
  if (!volume || now - (lastPlayed.get(sound) ?? 0) < REPEAT_AFTER_MS) {
    return;
  }
  lastPlayed.set(sound, now);
  const audio = new Audio(SOUNDS[sound]);
  audio.volume = Math.min(1, Math.max(0, volume / 100));
  await audio.play().catch(() => undefined);
}

window.tfaf.sounds.onPlay((sound) => void playSound(sound));
