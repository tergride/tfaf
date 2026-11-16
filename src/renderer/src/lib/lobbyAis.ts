import type { LobbyAiType } from '../../../shared/contract.ts';

export interface LobbyAiGroup {
  /** The mod the AIs come with; null for the game's own. */
  mod: string | null;
  ais: LobbyAiType[];
}

/**
 * The ordinary AIs or the AIx that a search finds, grouped by where they come from: the game's own first, then the
 * mods in the catalog's order. Every word of the search must be in the AI's name, its mod's or its kind, `AI` or
 * `AIx`, which a translated name may not have.
 */
export function groupLobbyAis(ais: readonly LobbyAiType[], cheat: boolean, query: string): LobbyAiGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  const groups = new Map<string | null, LobbyAiType[]>([[null, []]]);
  for (const ai of ais) {
    const text = `${ai.name} ${ai.mod ?? ''} ${ai.cheat ? 'aix' : 'ai'}`.toLowerCase();
    if (ai.cheat !== cheat || !words.every((word) => text.includes(word))) {
      continue;
    }
    const group = groups.get(ai.mod);
    if (group) {
      group.push(ai);
    } else {
      groups.set(ai.mod, [ai]);
    }
  }
  return [...groups].filter(([, list]) => list.length > 0).map(([mod, list]) => ({ mod, ais: list }));
}
