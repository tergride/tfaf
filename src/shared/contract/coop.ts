/** `sc` and `scfa`: the original campaigns of both games; `custom`: missions made by the community. */
export type CoopCampaignType = 'sc' | 'scfa' | 'custom';
export type CoopFaction = 'uef' | 'aeon' | 'cybran' | 'seraphim' | 'custom';

export interface CoopMission {
  id: string;
  name: string;
  description: string;
  version: number | null;
  /** The map folder, which is also the map name of a hosted game. */
  folderName: string;
  previewUrl: string | null;
  previewLargeUrl: string | null;
}

/** A campaign: missions played one after another. */
export interface CoopScenario {
  id: string;
  name: string;
  description: string;
  type: CoopCampaignType | null;
  faction: CoopFaction | null;
  missions: CoopMission[];
}

export interface CoopResult {
  rank: number;
  players: string[];
  /** Mission time as the game reported it. */
  durationSeconds: number;
  secondaryObjectives: boolean;
  endedAt: string | null;
  /** The game id, which is also the id of its replay. */
  replayId: number;
}

export const COOP_MAX_PLAYERS = 4;

export interface CoopHostRequest {
  missionId: string;
  title: string;
  password: string | null;
}
