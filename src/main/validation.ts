// Narrowing of renderer input. The renderer is treated as untrusted: every IPC argument is checked here before it
// reaches a service.

import {
  APP_FOLDERS,
  type AppFolder,
  CHAT_LIMITS,
  type CoopHostRequest,
  type CustomMapRequest,
  DATE_FORMATS,
  type GameOptionValue,
  GENERATION_TYPES,
  type GeneratorPrefs,
  HOST_GAME_LIMITS,
  type HostGameDraft,
  type HostGameOptions,
  isTfafLobbyFeaturedMod,
  ICE_ADAPTER_KINDS,
  INTERFACE_SCALES,
  KEY_PRESETS,
  type KeyPreset,
  LANGUAGES,
  LIVE_REPLAY_ACTIONS,
  type LiveReplayAction,
  LOG_CLEANUP_LIMITS,
  MAP_MAX_PLAYERS,
  MAP_VIEW_BATCH,
  MAP_SIZES_PX,
  MAP_SORT_FIELDS,
  type MapQuery,
  MATCHMAKER_FACTIONS,
  type MatchmakerFaction,
  type ModerationReportInput,
  MOD_SORT_FIELDS,
  type ModQuery,
  type ModType,
  type NotificationPrefs,
  type PathField,
  PROFILE_PERIODS,
  type ProfilePeriod,
  REPLAY_PERIODS,
  REPLAY_SORTS,
  REPORT_LIMITS,
  REVIEW_LIMITS,
  type ReplayQuery,
  type ReviewInput,
  type ReviewKind,
  type ReviewTarget,
  type SettingsPatch,
  SOUND_IDS,
  type SoundPrefs,
  type SortOrder,
  THEMES,
  TIME_FORMATS,
  TOAST_POSITIONS,
  TOAST_SECONDS,
  UNIT_DATABASE_IDS,
  type UnitDatabaseId,
  WINDOW_CLOSE_ANSWERS,
  type WindowCloseAnswer,
} from '../shared/contract.ts';
import {
  GENERATOR_DENSITY_MAX,
  GENERATOR_MAP_SIZES,
  GENERATOR_TEAM_COUNTS,
  isGeneratorOptionName,
  isGeneratorSeed,
  isGeneratorSeedText,
  MAX_GENERATOR_OPTIONS,
  spawnCountsFor,
} from '../shared/mapGenerator.ts';
import { mergeChatPrefs } from './chat/chatPrefs.ts';
import { parseCustomTheme } from '../shared/themes.ts';
import { parseHostGameDraft, parsePresetName } from './gamePresets.ts';
import { t } from './i18n.ts';
import { normalizeGamePath } from './mapView/gamePaths.ts';
import { isAcceptablePath } from './settings.ts';

export class InvalidInputError extends Error {}

const MAX_TEXT_LENGTH = 100;
const MAX_PAGE_SIZE = 100;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return value as Record<string, unknown>;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return value as T;
}

function optionalOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return value === undefined ? undefined : oneOf(value, allowed);
}

function oneOfNumber<T extends number>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'number' || !(allowed as readonly number[]).includes(value)) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return value as T;
}

export function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return value;
}

function optionalInteger(value: unknown, min: number, max: number): number | undefined {
  return value === undefined ? undefined : integer(value, min, max);
}

/** Distinct values that each pass `item`; an empty list means no filter. */
function optionalSet<T>(value: unknown, maxLength: number, item: (entry: unknown) => T): T[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > maxLength) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  const items = [...new Set(value.map(item))];
  return items.length > 0 ? items : undefined;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return value;
}

/** The whole object, as the settings screen sends it. */
export function parseNotificationPrefs(input: unknown): NotificationPrefs {
  const raw = object(input);
  return {
    toasts: boolean(raw.toasts),
    toastPosition: oneOf(raw.toastPosition, TOAST_POSITIONS),
    toastSeconds: oneOfNumber(raw.toastSeconds, TOAST_SECONDS),
    desktop: boolean(raw.desktop),
    friendOnline: boolean(raw.friendOnline),
    friendOffline: boolean(raw.friendOffline),
    friendJoinedGame: boolean(raw.friendJoinedGame),
    friendStartedPlaying: boolean(raw.friendStartedPlaying),
    afterGameReview: boolean(raw.afterGameReview),
    whatsNew: boolean(raw.whatsNew),
  };
}

export function parseSoundPrefs(input: unknown): SoundPrefs {
  const raw = object(input);
  return Object.fromEntries(SOUND_IDS.map((sound) => [sound, boolean(raw[sound])])) as SoundPrefs;
}

/** Styles or symmetries of the generator: names of its options. */
function generatorChoices(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_GENERATOR_OPTIONS || !value.every(isGeneratorOptionName)) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return [...new Set(value)];
}

function generatorOption(value: unknown): string | null {
  if (value !== null && !isGeneratorOptionName(value)) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return value;
}

function densityRange(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  const low = integer(value[0], 0, GENERATOR_DENSITY_MAX);
  return [low, integer(value[1], low, GENERATOR_DENSITY_MAX)];
}

/** The whole custom map form, as the generator dialog sends it. */
export function parseGeneratorPrefs(input: unknown): GeneratorPrefs {
  const raw = object(input);
  const numTeams = oneOfNumber(raw.numTeams, GENERATOR_TEAM_COUNTS);
  if (!isGeneratorSeedText(raw.seed)) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return {
    generationType: oneOf(raw.generationType, GENERATION_TYPES),
    numTeams,
    spawnCount: oneOfNumber(raw.spawnCount, spawnCountsFor(numTeams)),
    mapSize: oneOfNumber(raw.mapSize, GENERATOR_MAP_SIZES),
    symmetries: generatorChoices(raw.symmetries),
    fixedSeed: boolean(raw.fixedSeed),
    seed: raw.seed,
    customStyle: boolean(raw.customStyle),
    styles: generatorChoices(raw.styles),
    terrainStyles: generatorChoices(raw.terrainStyles),
    textureStyles: generatorChoices(raw.textureStyles),
    resourceStyles: generatorChoices(raw.resourceStyles),
    propStyles: generatorChoices(raw.propStyles),
    resourceDensity: densityRange(raw.resourceDensity),
    reclaimDensity: densityRange(raw.reclaimDensity),
  };
}

/** The limits of the form; whether the generator offers the chosen styles is checked by the generator service. */
export function parseCustomMapRequest(input: unknown): CustomMapRequest {
  const raw = object(input);
  const numTeams = oneOfNumber(raw.numTeams, GENERATOR_TEAM_COUNTS);
  if (raw.seed !== null && (typeof raw.seed !== 'string' || !isGeneratorSeed(raw.seed))) {
    throw new InvalidInputError(t('main.generator.invalidSeed'));
  }
  const density = (value: unknown): number | null => (value === null ? null : integer(value, 0, GENERATOR_DENSITY_MAX));
  return {
    version: text(raw.version, 20),
    generationType: oneOf(raw.generationType, GENERATION_TYPES),
    numTeams,
    spawnCount: oneOfNumber(raw.spawnCount, spawnCountsFor(numTeams)),
    mapSize: oneOfNumber(raw.mapSize, GENERATOR_MAP_SIZES),
    seed: raw.seed,
    symmetry: generatorOption(raw.symmetry),
    style: generatorOption(raw.style),
    terrainStyle: generatorOption(raw.terrainStyle),
    textureStyle: generatorOption(raw.textureStyle),
    resourceStyle: generatorOption(raw.resourceStyle),
    propStyle: generatorOption(raw.propStyle),
    resourceDensity: density(raw.resourceDensity),
    reclaimDensity: density(raw.reclaimDensity),
  };
}

export function text(value: unknown, maxLength = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return value;
}

const SORT_ORDERS: readonly SortOrder[] = ['asc', 'desc'];
const MOD_TYPES: readonly ModType[] = ['UI', 'SIM'];
const PATH_FIELDS: readonly PathField[] = ['gamePath', 'vaultPath', 'gamePrefsPath', 'dataPath'];

export function parseMapQuery(input: unknown): MapQuery {
  const raw = object(input);
  return {
    page: integer(raw.page, 1, 100_000),
    pageSize: integer(raw.pageSize, 1, MAX_PAGE_SIZE),
    name: optionalText(raw.name),
    author: optionalText(raw.author),
    players: optionalSet(raw.players, MAP_MAX_PLAYERS, (count) => integer(count, 1, MAP_MAX_PLAYERS)),
    sizes: optionalSet(raw.sizes, MAP_SIZES_PX.length, (size) => oneOfNumber(size, MAP_SIZES_PX)),
    onlyRanked: optionalBoolean(raw.onlyRanked),
    onlyRecommended: optionalBoolean(raw.onlyRecommended),
    onlyOwn: optionalBoolean(raw.onlyOwn),
    sortField: oneOf(raw.sortField, MAP_SORT_FIELDS),
    sortOrder: oneOf(raw.sortOrder, SORT_ORDERS),
  };
}

export function parseModQuery(input: unknown): ModQuery {
  const raw = object(input);
  return {
    page: integer(raw.page, 1, 100_000),
    pageSize: integer(raw.pageSize, 1, MAX_PAGE_SIZE),
    name: optionalText(raw.name),
    author: optionalText(raw.author),
    type: optionalOneOf(raw.type, MOD_TYPES),
    onlyRanked: optionalBoolean(raw.onlyRanked),
    onlyRecommended: optionalBoolean(raw.onlyRecommended),
    sortField: oneOf(raw.sortField, MOD_SORT_FIELDS),
    sortOrder: oneOf(raw.sortOrder, SORT_ORDERS),
  };
}

export function parseReplayQuery(input: unknown): ReplayQuery {
  const raw = object(input);
  return {
    page: integer(raw.page, 1, 100_000),
    pageSize: integer(raw.pageSize, 1, MAX_PAGE_SIZE),
    gameId: optionalInteger(raw.gameId, 1, 2 ** 31 - 1),
    player: optionalText(raw.player),
    map: optionalText(raw.map),
    featuredMod: optionalText(raw.featuredMod),
    onlyRanked: optionalBoolean(raw.onlyRanked),
    onlyOwn: optionalBoolean(raw.onlyOwn),
    period: oneOf(raw.period, REPLAY_PERIODS),
    sort: oneOf(raw.sort, REPLAY_SORTS),
  };
}

export function parseLiveReplayAction(input: unknown): LiveReplayAction {
  return oneOf(input, LIVE_REPLAY_ACTIONS);
}

export function parseSettingsPatch(input: unknown): SettingsPatch {
  const raw = object(input);
  const patch: SettingsPatch = {};
  if (raw.updateContentOnHost !== undefined) {
    patch.updateContentOnHost = optionalBoolean(raw.updateContentOnHost);
  }
  if (raw.rememberMe !== undefined) {
    patch.rememberMe = optionalBoolean(raw.rememberMe);
  }
  if (raw.chatNotifications !== undefined) {
    patch.chatNotifications = optionalBoolean(raw.chatNotifications);
  }
  if (raw.chat !== undefined) {
    // Cut down to what is valid rather than refused: the screen sends the whole object back with one change.
    patch.chat = mergeChatPrefs(object(raw.chat), null);
  }
  if (raw.soundVolume !== undefined) {
    patch.soundVolume = integer(raw.soundVolume, 0, 100);
  }
  if (raw.theme !== undefined) {
    patch.theme = oneOf(raw.theme, THEMES);
  }
  if (raw.customTheme !== undefined) {
    const customTheme = parseCustomTheme(raw.customTheme);
    if (!customTheme) {
      throw new InvalidInputError(t('main.validation.invalidRequest'));
    }
    patch.customTheme = customTheme;
  }
  if (raw.animations !== undefined) {
    patch.animations = optionalBoolean(raw.animations);
  }
  if (raw.reduceGameLoad !== undefined) {
    patch.reduceGameLoad = optionalBoolean(raw.reduceGameLoad);
  }
  if (raw.betaUpdates !== undefined) {
    patch.betaUpdates = optionalBoolean(raw.betaUpdates);
  }
  if (raw.closeToTray !== undefined) {
    patch.closeToTray = optionalBoolean(raw.closeToTray);
  }
  if (raw.confirmQuit !== undefined) {
    patch.confirmQuit = optionalBoolean(raw.confirmQuit);
  }
  if (raw.interfaceScale !== undefined) {
    patch.interfaceScale = oneOfNumber(raw.interfaceScale, INTERFACE_SCALES);
  }
  if (raw.iceAdapter !== undefined) {
    patch.iceAdapter = oneOf(raw.iceAdapter, ICE_ADAPTER_KINDS);
  }
  if (raw.language !== undefined) {
    patch.language = oneOf(raw.language, LANGUAGES);
  }
  if (raw.dateFormat !== undefined) {
    patch.dateFormat = oneOf(raw.dateFormat, DATE_FORMATS);
  }
  if (raw.timeFormat !== undefined) {
    patch.timeFormat = oneOf(raw.timeFormat, TIME_FORMATS);
  }
  if (raw.notifications !== undefined) {
    patch.notifications = parseNotificationPrefs(raw.notifications);
  }
  if (raw.sounds !== undefined) {
    patch.sounds = parseSoundPrefs(raw.sounds);
  }
  if (raw.generator !== undefined) {
    patch.generator = parseGeneratorPrefs(raw.generator);
  }
  if (raw.preferredTurnIds !== undefined) {
    patch.preferredTurnIds = parseTurnIds(raw.preferredTurnIds);
  }
  if (raw.discord !== undefined) {
    const discord = object(raw.discord);
    patch.discord = { showStatus: boolean(discord.showStatus), allowJoin: boolean(discord.allowJoin) };
  }
  if (raw.logCleanup !== undefined) {
    const logCleanup = object(raw.logCleanup);
    const { maxAgeDays, maxSizeMb } = LOG_CLEANUP_LIMITS;
    patch.logCleanup = {
      enabled: boolean(logCleanup.enabled),
      byAge: boolean(logCleanup.byAge),
      maxAgeDays: integer(logCleanup.maxAgeDays, maxAgeDays.min, maxAgeDays.max),
      bySize: boolean(logCleanup.bySize),
      maxSizeMb: integer(logCleanup.maxSizeMb, maxSizeMb.min, maxSizeMb.max),
    };
  }
  if (raw.gamePath !== undefined) {
    if (raw.gamePath !== null && !isAcceptablePath(raw.gamePath)) {
      throw new InvalidInputError(t('main.validation.invalidPath'));
    }
    patch.gamePath = raw.gamePath;
  }
  for (const field of ['vaultPath', 'gamePrefsPath', 'dataPath'] as const) {
    if (raw[field] !== undefined) {
      if (!isAcceptablePath(raw[field])) {
        throw new InvalidInputError(t('main.validation.invalidPath'));
      }
      patch[field] = raw[field];
    }
  }
  return patch;
}

export function parsePathField(input: unknown): PathField {
  return oneOf(input, PATH_FIELDS);
}

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

function optionalRating(value: unknown): number | null {
  return value === null || value === undefined
    ? null
    : integer(value, -HOST_GAME_LIMITS.ratingMax, HOST_GAME_LIMITS.ratingMax);
}

/** Title and password must be ASCII, the lobby server and the game reject anything else (CreateGameController). */
function parseGameTitle(value: unknown): string {
  const title = text(value, HOST_GAME_LIMITS.titleMaxLength).trim();
  if (!title || !PRINTABLE_ASCII.test(title)) {
    throw new InvalidInputError(t('main.validation.gameTitleAscii'));
  }
  return title;
}

function parseGamePassword(value: unknown): string | null {
  const password = value === null || value === '' ? null : text(value, HOST_GAME_LIMITS.passwordMaxLength);
  if (password !== null && !PRINTABLE_ASCII.test(password)) {
    throw new InvalidInputError(t('main.validation.passwordAscii'));
  }
  return password;
}

export function parseHostGameOptions(input: unknown): HostGameOptions {
  const raw = object(input);
  const title = parseGameTitle(raw.title);
  const password = parseGamePassword(raw.password);
  const featuredMod = text(raw.featuredMod, 64);
  if (!/^[a-z0-9_]+$/i.test(featuredMod)) {
    throw new InvalidInputError(t('main.validation.invalidFeaturedMod'));
  }
  const ratingMin = optionalRating(raw.ratingMin);
  const ratingMax = optionalRating(raw.ratingMax);
  if (ratingMin !== null && ratingMax !== null && ratingMin > ratingMax) {
    throw new InvalidInputError(t('main.validation.ratingOrder'));
  }
  if (typeof raw.friendsOnly !== 'boolean' || typeof raw.enforceRatingRange !== 'boolean' || typeof raw.modIsolation !== 'boolean') {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  const lobbyMode = raw.lobbyMode;
  if (lobbyMode !== 'faf' && lobbyMode !== 'tfaf') {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  // The room reads the files of the featured mods it plays (gamePackages.ts); it knows no others.
  if (lobbyMode === 'tfaf' && !isTfafLobbyFeaturedMod(featuredMod)) {
    throw new InvalidInputError(t('main.validation.tfafLobbyFeaturedMod'));
  }
  return {
    title,
    password,
    featuredMod,
    mapFolderName: text(raw.mapFolderName, 255),
    modUids: parseUidList(raw.modUids),
    friendsOnly: raw.friendsOnly,
    ratingMin,
    ratingMax,
    enforceRatingRange: raw.enforceRatingRange,
    modIsolation: raw.modIsolation,
    lobbyMode,
  };
}

export function parseCoopHostRequest(input: unknown): CoopHostRequest {
  const raw = object(input);
  return { missionId: parseApiId(raw.missionId), title: parseGameTitle(raw.title), password: parseGamePassword(raw.password) };
}

/** A channel or a nick: the target of a chat command, which must stay a single IRC parameter. */
export function parseChatTarget(input: unknown): string {
  const value = text(input, Math.max(CHAT_LIMITS.channelNameMaxLength, CHAT_LIMITS.nickMaxLength));
  if (/[\s,\x00-\x1f]/.test(value) || value.startsWith(':')) {
    throw new InvalidInputError(t('main.validation.invalidChatTarget'));
  }
  return value;
}

/** Ids of chat messages come from the server; they too must stay a single IRC parameter. */
export function parseChatMessageId(input: unknown): string {
  const value = text(input, 200);
  if (/[\s\x00-\x1f]/.test(value) || value.startsWith(':')) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return value;
}

/** Chat text before the byte limit is checked; commands like `/msg` add a little. */
export function parseChatText(input: unknown): string {
  return text(input, CHAT_LIMITS.messageMaxBytes * 2);
}

export function parseChatTopic(input: unknown): string {
  if (typeof input !== 'string' || input.length > CHAT_LIMITS.topicMaxLength) {
    throw new InvalidInputError(t('main.validation.topicTooLong'));
  }
  return input;
}

export function parseChatRelation(input: unknown): 'friend' | 'foe' | null {
  return input === null ? null : oneOf(input, ['friend', 'foe'] as const);
}

export function parseOptionalPassword(input: unknown): string | null {
  return input === null || input === undefined || input === '' ? null : text(input, HOST_GAME_LIMITS.passwordMaxLength);
}

export function parseDraftInput(input: unknown): HostGameDraft {
  const draft = parseHostGameDraft(input);
  if (!draft) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return draft;
}

export function parsePresetNameInput(input: unknown): string {
  const name = parsePresetName(input);
  if (!name) {
    throw new InvalidInputError(t('main.validation.presetNameLength', { max: HOST_GAME_LIMITS.presetNameMaxLength }));
  }
  return name;
}

export function parseUidList(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 1000) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return [...new Set(input.map((uid) => text(uid, 256)))];
}

/** Map folder names; a collection of maps can be much larger than one of mods. */
export function parseFolderNameList(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 20_000) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return [...new Set(input.map((name) => text(name, 255)))];
}

/** Game paths of files the map view asks for, such as `/env/common/decals/x.dds`; only those with the extension. */
export function parseGamePaths(input: unknown, extension: '.dds' | '.scm'): string[] {
  if (!Array.isArray(input) || input.length > MAP_VIEW_BATCH) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return input.map((value) => {
    const normalized = normalizeGamePath(text(value, 512));
    if (!normalized || !normalized.toLowerCase().endsWith(extension)) {
      throw new InvalidInputError(t('main.validation.invalidRequest'));
    }
    return normalized;
  });
}

/** Ids of FAF API resources are numeric; they become part of request paths. */
export function parseApiId(input: unknown): string {
  if (typeof input !== 'string' || !/^\d{1,18}$/.test(input)) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return input;
}

export function parseHttpsUrl(input: unknown): string {
  const value = text(input, 2048);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidInputError(t('main.validation.invalidUrl'));
  }
  if (url.protocol !== 'https:') {
    throw new InvalidInputError(t('main.validation.httpsOnly'));
  }
  return url.toString();
}

/** Text to look players up by; empty is allowed. */
export function parsePlayerQuery(input: unknown): string {
  if (typeof input !== 'string' || input.length > 50) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return input;
}

export function parseQueueName(input: unknown): string {
  if (typeof input !== 'string' || !/^[\w-]{1,100}$/.test(input)) {
    throw new InvalidInputError(t('main.validation.invalidQueue'));
  }
  return input;
}

export function parseFactions(input: unknown): MatchmakerFaction[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MATCHMAKER_FACTIONS.length) {
    throw new InvalidInputError(t('main.validation.invalidFactions'));
  }
  const factions = MATCHMAKER_FACTIONS.filter((faction) => input.includes(faction));
  if (factions.length !== new Set(input).size) {
    throw new InvalidInputError(t('main.validation.invalidFactions'));
  }
  return factions;
}

const MAX_PLAYER_ID = 2 ** 31 - 1;
const LOGIN_PATTERN = /^[^\s,\x00-\x1f]{1,50}$/;

/** A player by id, or by exact login as the replays and the chat know them. */
export function parsePlayerRef(input: unknown): number | string {
  if (typeof input === 'number') {
    return integer(input, 1, MAX_PLAYER_ID);
  }
  if (typeof input !== 'string' || !LOGIN_PATTERN.test(input)) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return input;
}

export function parsePlayerId(input: unknown): number {
  return integer(input, 1, MAX_PLAYER_ID);
}

export function parseProfilePeriod(input: unknown): ProfilePeriod {
  return oneOf(input, PROFILE_PERIODS);
}

/** The avatar to wear: one of the FAF content server, or null for none. */
export function parseAvatarUrl(input: unknown): string | null {
  return input === null ? null : parseHttpsUrl(input);
}

/** Mirrors the report form: players, a description, and with a game the time of the incident in it. */
export function parseReportInput(input: unknown): ModerationReportInput {
  const raw = object(input);
  if (!Array.isArray(raw.players) || raw.players.length === 0 || raw.players.length > REPORT_LIMITS.maxPlayers) {
    throw new InvalidInputError(t('main.validation.reportPlayers'));
  }
  const players = [...new Set(raw.players.map(parsePlayerId))];
  const gameId = raw.gameId === null ? null : integer(raw.gameId, 1, MAX_PLAYER_ID);
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  if (description.length === 0 || description.length > REPORT_LIMITS.descriptionMaxLength) {
    throw new InvalidInputError(t('main.validation.reportDescription', { limit: REPORT_LIMITS.descriptionMaxLength }));
  }
  const incidentTime = typeof raw.incidentTime === 'string' ? raw.incidentTime.trim() : '';
  if (incidentTime.length > REPORT_LIMITS.incidentTimeMaxLength || (gameId !== null && incidentTime.length === 0)) {
    throw new InvalidInputError(t('main.validation.reportIncidentTime'));
  }
  return { players, gameId, incidentTime, description };
}

const REVIEW_KINDS: readonly ReviewKind[] = ['map', 'mod', 'game'];
const UPLOAD_KINDS = ['map', 'mod'] as const;

export function parseReviewKind(input: unknown): ReviewKind {
  return oneOf(input, REVIEW_KINDS);
}

/** A map or mod needs the version a new review is about; a game has none. */
export function parseReviewTarget(input: unknown): ReviewTarget {
  const raw = object(input);
  const kind = parseReviewKind(raw.kind);
  const id = integer(raw.id, 1, MAX_PLAYER_ID);
  const versionId = raw.versionId === null || kind === 'game' ? null : integer(raw.versionId, 1, MAX_PLAYER_ID);
  if (kind !== 'game' && versionId === null) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return { kind, id, versionId };
}

export function parseReviewInput(input: unknown): ReviewInput {
  const raw = object(input);
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (text.length > REVIEW_LIMITS.textMaxLength) {
    throw new InvalidInputError(t('main.validation.reviewText', { limit: REVIEW_LIMITS.textMaxLength }));
  }
  return { text, score: integer(raw.score, REVIEW_LIMITS.minScore, REVIEW_LIMITS.maxScore) };
}

export function parseUploadKind(input: unknown): (typeof UPLOAD_KINDS)[number] {
  return oneOf(input, UPLOAD_KINDS);
}

export function parseUnitDatabaseId(input: unknown): UnitDatabaseId {
  return oneOf(input, UNIT_DATABASE_IDS);
}

export function parseUploadToken(input: unknown): string {
  if (typeof input !== 'string' || !/^[0-9a-f-]{36}$/.test(input)) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return input;
}

export function parseBoolean(input: unknown): boolean {
  return boolean(input);
}

const MAX_TURN_SERVERS = 50;
const MAX_ID_TEXT_LENGTH = 100;

/** Ids of TURN servers, as `/ice/server` names them. */
export function parseTurnIds(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > MAX_TURN_SERVERS) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return [...new Set(input.map((id) => text(id, MAX_ID_TEXT_LENGTH)))];
}

export function parseAppFolder(input: unknown): AppFolder {
  return oneOf(input, APP_FOLDERS);
}

export function parseWindowCloseAnswer(input: unknown): WindowCloseAnswer {
  return oneOf(input, WINDOW_CLOSE_ANSWERS);
}

const MAX_GAME_OPTION_TEXT = 200;

/** A value for a game option; which ones the option takes is checked against the game's options. */
export function parseGameOptionValue(input: unknown): GameOptionValue {
  if (typeof input === 'boolean' || (typeof input === 'number' && Number.isFinite(input))) {
    return input;
  }
  return text(input, MAX_GAME_OPTION_TEXT);
}

export function parseKeyPreset(input: unknown): KeyPreset {
  return oneOf(input, KEY_PRESETS);
}

const MAX_SETTINGS_PARTS = 20;

/** Parts of a game settings file to import: option sections and the key bindings; at least one. */
export function parseSettingsParts(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_SETTINGS_PARTS) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return [...new Set(input.map((part) => text(part, MAX_ID_TEXT_LENGTH)))];
}
