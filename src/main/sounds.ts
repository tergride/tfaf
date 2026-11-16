import type { SoundId } from '../shared/contract.ts';
import type { SettingsStore } from './settings.ts';

/** Sounds are played by the renderer, at the volume of the settings; this decides which events may sound. */
export class SoundPlayer {
  private readonly settings: Pick<SettingsStore, 'get'>;
  private readonly send: (sound: SoundId) => void;

  constructor(settings: Pick<SettingsStore, 'get'>, send: (sound: SoundId) => void) {
    this.settings = settings;
    this.send = send;
  }

  play(sound: SoundId): void {
    if (this.settings.get().sounds[sound]) {
      this.send(sound);
    }
  }
}
