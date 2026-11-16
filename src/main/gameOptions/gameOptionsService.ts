import { randomUUID } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type GameOptionsView,
  type GameOptionValue,
  type GameSettingsImportCandidate,
  type GameSettingsImportResult,
  KEY_BINDINGS_PART,
  type KeyBindingsView,
  type KeyPreset,
} from '../../shared/contract.ts';
import { INTL_LOCALES } from '../../shared/i18n/index.ts';
import { KEY_MODIFIERS } from '../../shared/keyBindings.ts';
import type { GameRunner } from '../game/gameRunner.ts';
import { currentLocale, t } from '../i18n.ts';
import type { SettingsStore } from '../settings.ts';
import { ensureOwnPrefs, readGamePrefs, updateGamePrefs } from '../vault/gamePrefs.ts';
import { type GameFiles, gameFilesPaths, loadGameFiles, localizer } from './gameFiles.ts';
import {
  assignKey,
  currentKeyMap,
  isValidKeyBinding,
  type KeyMapContext,
  keyActionCategories,
  presetOf,
  profileKeyActions,
  type ProfileKeyMaps,
  readProfileKeyMaps,
  resetToPreset,
  unbindKey,
  usableKeyMaps,
  writeProfileKeyMaps,
  writeProfileKeys,
} from './keyMaps.ts';
import {
  importedOptions,
  optionChanges,
  optionCounts,
  optionSections,
  optionValues,
  profileOptions,
  resolveOptions,
} from './optionCatalog.ts';
import { NoProfileError, type PrefsDocument, profileName, readPrefsDocument, writePrefsDocument } from './prefsDocument.ts';
import { keyBindingCount, MAX_SETTINGS_FILE_BYTES, parseSettingsFile, type SettingsFile, serializeSettingsFile } from './settingsFile.ts';

export interface GameOptionsDeps {
  settings: Pick<SettingsStore, 'get'>;
  games: Pick<GameRunner, 'getState'>;
  /** Any Forged Alliance process, including one the launcher did not start. */
  isForgedAllianceRunning(): Promise<boolean>;
  /** Asks where to save a settings file; null when cancelled. */
  pickExportFile(defaultName: string): Promise<string | null>;
  /** Asks for a settings file to import; null when cancelled. */
  pickImportFile(): Promise<string | null>;
}

/**
 * Options and key bindings of the game's current profile. Forged Alliance writes the whole Game.prefs when it closes,
 * so nothing is changed while it runs: the change would be lost.
 */
export class GameOptionsService {
  private readonly deps: GameOptionsDeps;
  private loaded: { stamp: string; files: Promise<GameFiles> } | null = null;
  // Only a file the user picked in the dialog is imported, whatever the renderer asks for.
  private picked: { token: string; file: SettingsFile } | null = null;

  constructor(deps: GameOptionsDeps) {
    this.deps = deps;
  }

  async exportSettings(): Promise<string | null> {
    const [files, document] = await Promise.all([this.files(), this.read()]);
    const text = serializeSettingsFile({
      exportedAt: new Date().toISOString(),
      options: optionValues(resolveOptions(files, document.globals, document.profile)),
      keys: { preset: presetOf(document.profile), maps: readProfileKeyMaps(document.profile) },
    });
    const target = await this.deps.pickExportFile(`forged-alliance-settings-${new Date().toISOString().slice(0, 10)}.json`);
    if (!target) {
      return null;
    }
    await writeFile(target, text, 'utf8');
    return target;
  }

  async pickImport(): Promise<GameSettingsImportCandidate | null> {
    const source = await this.deps.pickImportFile();
    if (!source) {
      return null;
    }
    if ((await stat(source)).size > MAX_SETTINGS_FILE_BYTES) {
      throw new Error(t('main.gameOptions.notSettingsFile'));
    }
    const file = parseSettingsFile(await readFile(source, 'utf8'));
    const [files, document] = await Promise.all([this.files(), this.read()]);
    const localize = localizer(files, currentLocale());
    const sections = resolveOptions(files, document.globals, document.profile);
    const counts = optionCounts(sections, file.options);
    const parts = sections
      .map((section) => ({ id: section.id, title: localize(section.title), count: counts.get(section.id) ?? 0 }))
      .filter((part) => part.count > 0);
    if (file.keys) {
      parts.push({ id: KEY_BINDINGS_PART, title: t('main.gameOptions.keyBindingsPart'), count: keyBindingCount(file.keys) });
    }
    const token = randomUUID();
    this.picked = { token, file };
    return { token, fileName: path.basename(source), exportedAt: file.exportedAt, parts, keyPreset: file.keys?.preset ?? null };
  }

  async importSettings(token: string, parts: string[]): Promise<GameSettingsImportResult> {
    const file = this.picked?.token === token ? this.picked.file : null;
    if (!file) {
      throw new Error(t('main.gameOptions.pickAgain'));
    }
    await this.requireGameClosed();
    const files = await this.files();
    const chosen = new Set(parts);
    let result: GameSettingsImportResult = { options: 0, keyBindings: null, skipped: [] };
    await this.change((document) => {
      const localize = localizer(files, currentLocale());
      const sections = resolveOptions(files, document.globals, document.profile);
      const { accepted, skippedTitles } = importedOptions(sections, file.options, chosen);
      const options = profileOptions(document.profile);
      for (const [key, value] of accepted) {
        options.set(key, value);
      }
      result = { options: accepted.size, keyBindings: null, skipped: skippedTitles.map(localize) };
      if (file.keys && chosen.has(KEY_BINDINGS_PART)) {
        const { context } = this.keyMaps(files, document);
        const usable = usableKeyMaps(file.keys.maps, new Set(files.keyNames.values()), context.actions);
        writeProfileKeys(document.profile, file.keys.preset, usable.maps);
        result.keyBindings = (usable.maps.user?.size ?? 0) + (usable.maps.debug?.size ?? 0);
        result.skipped.push(...usable.skipped);
      }
    });
    this.picked = null;
    return result;
  }

  async options(): Promise<GameOptionsView> {
    return this.optionsView(await this.gameRunning());
  }

  async setOption(key: string, value: GameOptionValue): Promise<GameOptionsView> {
    await this.requireGameClosed();
    const files = await this.files();
    await this.change((document) => {
      const changes = optionChanges(resolveOptions(files, document.globals, document.profile), key, value);
      const options = profileOptions(document.profile);
      for (const [name, next] of changes) {
        options.set(name, next);
      }
    });
    return this.optionsView(false);
  }

  private async optionsView(gameRunning: boolean): Promise<GameOptionsView> {
    const [files, document] = await Promise.all([this.files(), this.readProfile()]);
    if (!document) {
      return { profile: null, sections: [], gameRunning };
    }
    const sections = resolveOptions(files, document.globals, document.profile);
    return {
      profile: profileName(document.profile),
      sections: optionSections(sections, localizer(files, currentLocale()), files.optionTips),
      gameRunning,
    };
  }

  async keyBindings(): Promise<KeyBindingsView> {
    return this.keyBindingsView(await this.gameRunning());
  }

  private async keyBindingsView(gameRunning: boolean): Promise<KeyBindingsView> {
    const [files, document] = await Promise.all([this.files(), this.readProfile()]);
    const locale = currentLocale();
    const localize = localizer(files, locale);
    const keyLabels: Record<string, string> = {};
    for (const name of [...files.keyNames.values(), ...KEY_MODIFIERS]) {
      const title = files.keyTitles.get(name);
      keyLabels[name] = title ? localize(title) : name;
    }
    if (!document) {
      return { profile: null, preset: 'default', customized: false, categories: [], keyCodes: Object.fromEntries(files.keyNames), keyLabels, gameRunning };
    }
    const { context, maps } = this.keyMaps(files, document);
    const collator = new Intl.Collator(INTL_LOCALES[locale]);
    return {
      profile: profileName(document.profile),
      preset: presetOf(document.profile),
      customized: maps.user !== null,
      categories: keyActionCategories(files, context.actions, currentKeyMap(maps, context), {
        localize,
        shiftVariant: (title) => t('main.gameOptions.shiftVariant', { title }),
        compare: collator.compare,
      }),
      keyCodes: Object.fromEntries(files.keyNames),
      keyLabels,
      gameRunning,
    };
  }

  async assignKey(action: string, key: string): Promise<KeyBindingsView> {
    return this.changeKeys(action, (maps, context, files) => {
      if (!isValidKeyBinding(key, new Set(files.keyNames.values()))) {
        throw new Error(t('main.gameOptions.invalidKey', { key }));
      }
      return assignKey(maps, context, action, key);
    });
  }

  async unbindKey(action: string, key: string): Promise<KeyBindingsView> {
    return this.changeKeys(action, (maps, context) => unbindKey(maps, context, action, key));
  }

  async resetKeys(preset: KeyPreset): Promise<KeyBindingsView> {
    await this.requireGameClosed();
    await this.change((document) => resetToPreset(document.profile, preset));
    return this.keyBindingsView(false);
  }

  private async changeKeys(
    action: string,
    change: (maps: ProfileKeyMaps, context: KeyMapContext, files: GameFiles) => ProfileKeyMaps,
  ): Promise<KeyBindingsView> {
    await this.requireGameClosed();
    const files = await this.files();
    await this.change((document) => {
      const { context, maps } = this.keyMaps(files, document);
      if (!context.actions.has(action)) {
        throw new Error(t('main.gameOptions.unknownAction', { action }));
      }
      writeProfileKeyMaps(document.profile, change(maps, context, files));
    });
    return this.keyBindingsView(false);
  }

  private keyMaps(files: GameFiles, document: PrefsDocument): { context: KeyMapContext; maps: ProfileKeyMaps } {
    return {
      context: {
        preset: files.presets[presetOf(document.profile)],
        defaults: files.presets.default,
        actions: profileKeyActions(files, document.profile),
      },
      maps: readProfileKeyMaps(document.profile),
    };
  }

  /** TFAF's own TFAF.prefs, which the games it starts use; the official client's Game.prefs is never changed. */
  private prefsPath(): Promise<string> {
    return ensureOwnPrefs(this.deps.settings.get().gamePrefsPath);
  }

  private async read(): Promise<PrefsDocument> {
    return readPrefsDocument(await readGamePrefs(await this.prefsPath()));
  }

  /** The document, or null while the game has not made a profile yet: the views show that as a state, not an error. */
  private async readProfile(): Promise<PrefsDocument | null> {
    try {
      return await this.read();
    } catch (error) {
      if (error instanceof NoProfileError) {
        return null;
      }
      throw error;
    }
  }

  private async change(apply: (document: PrefsDocument) => void): Promise<void> {
    await updateGamePrefs(await this.prefsPath(), (content) => {
      const document = readPrefsDocument(content);
      apply(document);
      return writePrefsDocument(document, content);
    });
  }

  private async gameRunning(): Promise<boolean> {
    return this.deps.games.getState().phase !== 'idle' || (await this.deps.isForgedAllianceRunning());
  }

  private async requireGameClosed(): Promise<void> {
    if (await this.gameRunning()) {
      throw new Error(t('main.gameOptions.closeGameFirst'));
    }
  }

  /** The game's scripts, parsed once per version of lua.nx2 and loc.nx2. */
  private async files(): Promise<GameFiles> {
    const paths = gameFilesPaths(this.deps.settings.get().dataPath);
    let stamp: string;
    try {
      const [lua, loc] = await Promise.all([stat(paths.lua), stat(paths.loc)]);
      stamp = [paths.lua, lua.mtimeMs, lua.size, loc.mtimeMs, loc.size].join('|');
    } catch {
      throw new Error(t('main.gameOptions.noGameFiles'));
    }
    if (this.loaded?.stamp !== stamp) {
      const files = loadGameFiles(paths.lua, paths.loc);
      this.loaded = { stamp, files };
      files.catch(() => {
        if (this.loaded?.files === files) {
          this.loaded = null;
        }
      });
    }
    return this.loaded.files;
  }
}
