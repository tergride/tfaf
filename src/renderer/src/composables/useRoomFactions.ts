import { computed, type DeepReadonly } from 'vue';
import type { LobbyFaction, MapTexture } from '../../../shared/contract.ts';
import { randomFaction, spotFactions } from '../../../shared/tfafLobby.ts';
// The game's own vector emblems (faction_icon-lg/factionicons-mini_bordered.svg); random is its four coloured balls.
import aeonIcon from '../assets/factions/aeon.svg';
import cybranIcon from '../assets/factions/cybran.svg';
import randomIcon from '../assets/factions/random.svg';
import seraphimIcon from '../assets/factions/seraphim.svg';
import uefIcon from '../assets/factions/uef.svg';
import { t } from '../lib/i18n.ts';
import { decodeDxt } from '../lib/mapView/dxt.ts';
import { useLobbyCatalog } from './useLobbyCatalog.ts';
import { useTfafLobby } from './useTfafLobby.ts';

const OWN_ICONS: Readonly<Record<string, string>> = { uef: uefIcon, aeon: aeonIcon, cybran: cybranIcon, seraphim: seraphimIcon };
const STANDARD_NAMES = ['uef', 'aeon', 'cybran', 'seraphim'] as const;

export interface RoomFaction {
  /** The number the room and the game know the faction by. */
  value: number;
  name: string;
  icon: string | null;
}

// Emblems of the game's files are drawn once per texture.
const textureUrls = new WeakMap<object, string>();

function textureUrl(texture: DeepReadonly<MapTexture>): string | null {
  const known = textureUrls.get(texture);
  if (known) {
    return known;
  }
  const level = texture.levels[0];
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!level || !context) {
    return null;
  }
  canvas.width = texture.width;
  canvas.height = texture.height;
  const rgba = texture.format === 'rgba8' ? level : decodeDxt(texture.format, texture.width, texture.height, level);
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), texture.width, texture.height), 0, 0);
  const url = canvas.toDataURL();
  textureUrls.set(texture, url);
  return url;
}

/** The factions of the room's featured mod with their names and emblems, and those each position allows. */
export function useRoomFactions() {
  const { room } = useTfafLobby();
  const { catalog } = useLobbyCatalog();
  const known = computed(() => new Map<string, DeepReadonly<LobbyFaction>>((catalog.value?.factions ?? []).map((faction) => [faction.key, faction])));

  function faction(value: number): RoomFaction {
    const keys = room.value?.factions ?? [];
    if (value === randomFaction(keys)) {
      return { value, name: t('tfafLobby.factions.random'), icon: randomIcon };
    }
    const key = keys[value - 1] ?? '';
    if ((STANDARD_NAMES as readonly string[]).includes(key)) {
      return { value, name: t(`tfafLobby.factions.${key as (typeof STANDARD_NAMES)[number]}`), icon: OWN_ICONS[key] ?? null };
    }
    const custom = known.value.get(key);
    return { value, name: custom?.name ?? key, icon: custom?.icon ? textureUrl(custom.icon) : null };
  }

  /** The factions a seat on this position may take. */
  function choices(spot: number): RoomFaction[] {
    return room.value ? spotFactions(room.value, spot).map(faction) : [];
  }

  /** The emblem and name of a faction by its key, as the unit lists name factions. */
  function byKey(key: string): RoomFaction | null {
    const index = (room.value?.factions ?? []).indexOf(key.toLowerCase());
    return index < 0 ? null : faction(index + 1);
  }

  return { faction, choices, byKey };
}
