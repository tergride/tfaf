import type { Settings, SettingsPatch } from '../../../shared/contract.ts';

/** Saves a change of the settings: the saved settings, or null when saving failed and the settings screen says why. */
export type SettingsUpdate = (patch: SettingsPatch) => Promise<Settings | null>;
