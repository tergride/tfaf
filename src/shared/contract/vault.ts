export interface ReviewsSummary {
  averageScore: number;
  numReviews: number;
  lowerBound: number;
}

export type ReviewKind = 'map' | 'mod' | 'game';

/** What reviews are about: a map or mod over all its versions, or a game. */
export interface ReviewTarget {
  kind: ReviewKind;
  /** The map, mod or game id. */
  id: number;
  /** The map or mod version shown, which a new review is about; null for a game. */
  versionId: number | null;
}

export interface VaultReview {
  id: string;
  text: string;
  /** 1 to 5 stars. */
  score: number;
  author: string | null;
  own: boolean;
  /** The map or mod version reviewed; null for a game. */
  versionId: number | null;
  version: string | null;
  updatedAt: string | null;
}

export interface ReviewInput {
  text: string;
  score: number;
}

export const REVIEW_LIMITS = { textMaxLength: 2000, minScore: 1, maxScore: 5 } as const;

/** A map or mod folder chosen for upload, as read and checked on this computer. */
export interface UploadCandidate {
  /** The token the upload refers to: only folders picked in the dialog can be uploaded. */
  token: string;
  folderName: string;
  name: string;
  description: string;
  version: string | null;
  /** Maps: players and size; mods: the author and whether it is UI only. */
  maxPlayers: number | null;
  widthPx: number | null;
  heightPx: number | null;
  author: string | null;
  uiOnly: boolean | null;
  /** The map's own preview from the .scmap file, as a data URL. */
  previewDataUrl: string | null;
  /** What stops the upload. */
  problems: string[];
  /** What the uploader should look at, without stopping it. */
  warnings: string[];
}

export const VAULT_RULES_URL = 'https://wiki.faforever.com/en/Development/Vault/Rules';

export interface VaultMap {
  mapId: number;
  versionId: number;
  displayName: string;
  folderName: string;
  description: string;
  version: string | null;
  maxPlayers: number;
  widthPx: number | null;
  heightPx: number | null;
  ranked: boolean;
  recommended: boolean;
  gamesPlayed: number;
  author: string | null;
  createTime: string | null;
  updateTime: string | null;
  thumbnailUrlSmall: string | null;
  thumbnailUrlLarge: string | null;
  reviews: ReviewsSummary | null;
}

export type ModType = 'UI' | 'SIM';

export interface VaultMod {
  modId: number;
  versionId: number;
  uid: string;
  displayName: string;
  description: string;
  version: string | null;
  type: ModType;
  ranked: boolean;
  recommended: boolean;
  author: string | null;
  uploader: string | null;
  createTime: string | null;
  updateTime: string | null;
  thumbnailUrl: string | null;
  reviews: ReviewsSummary | null;
}

export interface Page<T> {
  items: T[];
  page: number;
  totalPages: number;
  /** Items on all pages, when the server tells. */
  totalItems: number | null;
}

export type SortOrder = 'asc' | 'desc';

export const MAP_SORT_FIELDS = [
  'gamesPlayed',
  'reviewsSummary.lowerBound',
  'latestVersion.updateTime',
  'latestVersion.createTime',
  'displayName',
  'latestVersion.maxPlayers',
  'latestVersion.width',
] as const;
export type MapSortField = (typeof MAP_SORT_FIELDS)[number];

export const MAP_MAX_PLAYERS = 16;
/** Map edges of the size filter in pixels: 5, 10, 20, 40 and 81 km. */
export const MAP_SIZES_PX = [256, 512, 1024, 2048, 4096] as const;

/** A page of the map vault; every filter narrows the list, and none of them is required. */
export interface MapQuery {
  page: number;
  pageSize: number;
  /** Part of the map name. */
  name?: string;
  /** Part of the author's login. */
  author?: string;
  /** Numbers of start positions; a map matches when it has any of them. */
  players?: number[];
  /** Edges from MAP_SIZES_PX; a map matches when either of its sides has one of them. */
  sizes?: number[];
  onlyRanked?: boolean;
  onlyRecommended?: boolean;
  /** Maps uploaded by the signed-in player. */
  onlyOwn?: boolean;
  sortField: MapSortField;
  sortOrder: SortOrder;
}

export const MOD_SORT_FIELDS = [
  'latestVersion.createTime',
  'latestVersion.updateTime',
  'reviewsSummary.lowerBound',
  'displayName',
] as const;
export type ModSortField = (typeof MOD_SORT_FIELDS)[number];

/** A page of the mod vault; every filter narrows the list, and none of them is required. */
export interface ModQuery {
  page: number;
  pageSize: number;
  /** Part of the mod name. */
  name?: string;
  /** Part of the author's name. */
  author?: string;
  type?: ModType;
  onlyRanked?: boolean;
  onlyRecommended?: boolean;
  sortField: ModSortField;
  sortOrder: SortOrder;
}

export interface LocalMap {
  folderName: string;
  displayName: string;
  description: string;
  version: string | null;
  maxPlayers: number;
  widthPx: number | null;
  heightPx: number | null;
  official: boolean;
  /** When the map's folder was created on this computer, as an ISO date; null when the file system does not tell. */
  addedAt: string | null;
  /** Both previews are the generator's picture when the map folder has `<folder>_preview.png`. */
  previewUrl: string;
  /** The large preview of the content server, with spawns and resources marked. */
  previewLargeUrl: string;
}

/** Which of the asked map folders the FAF vault has; maps of the game and generated maps are in neither list. */
export interface MapVaultCheck {
  inVault: string[];
  notInVault: string[];
}

export interface LocalMod {
  uid: string;
  name: string;
  version: string | null;
  author: string;
  description: string;
  type: ModType;
  folderName: string;
  iconDataUrl: string | null;
  active: boolean;
}
