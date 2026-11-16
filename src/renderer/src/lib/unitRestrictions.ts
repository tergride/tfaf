// What the host picks in a room's unit manager: whole presets of the game and single units or upgrades. The room keeps
// them as one list, the game's `RestrictedCategories`.

import type { LobbyUnit, LobbyUnitGroup } from '../../../shared/contract.ts';

/** How the units of the dialog stand: under their type, under their tech level, or levels within each type. */
export const UNIT_GROUPINGS = ['type', 'tier', 'both'] as const;
export type UnitGrouping = (typeof UNIT_GROUPINGS)[number];

/** Upgrades are the units without a level. */
const TIER_ORDER: readonly LobbyUnit['tech'][] = ['T1', 'T2', 'T3', 'T4', null];

type Groupable = Pick<LobbyUnit, 'group' | 'tech'>;

export interface UnitRow<Unit> {
  tier: LobbyUnit['tech'];
  units: Unit[];
}

/** A heading with its units: the heading names `group`, or `tier` when there is no group. */
export interface UnitSection<Unit> {
  key: string;
  group: LobbyUnitGroup | null;
  tier: LobbyUnit['tech'];
  rows: UnitRow<Unit>[];
}

function byTier<Unit extends Groupable>(units: readonly Unit[]): UnitRow<Unit>[] {
  return TIER_ORDER.flatMap((tier) => {
    const own = units.filter((unit) => unit.tech === tier);
    return own.length > 0 ? [{ tier, units: own }] : [];
  });
}

/** `units` in the order they come, which keeps the order of the catalog within a section. */
export function unitSections<Unit extends Groupable>(units: readonly Unit[], grouping: UnitGrouping): UnitSection<Unit>[] {
  if (grouping === 'tier') {
    return byTier(units).map((row) => ({ key: String(row.tier), group: null, tier: row.tier, rows: [row] }));
  }
  return [...new Set(units.map((unit) => unit.group))].map((group) => {
    const own = units.filter((unit) => unit.group === group);
    return { key: group, group, tier: null, rows: grouping === 'both' ? byTier(own) : [{ tier: null, units: own }] };
  });
}

export interface RestrictionChoice {
  presets: ReadonlySet<string>;
  units: ReadonlySet<string>;
}

/** By preset key, what the preset forbids. */
export type RestrictionCovers = Readonly<Record<string, readonly string[]>>;

export function splitRestrictions(restrictions: readonly string[], presetKeys: ReadonlySet<string>): RestrictionChoice {
  return {
    presets: new Set(restrictions.filter((key) => presetKeys.has(key))),
    units: new Set(restrictions.filter((key) => !presetKeys.has(key))),
  };
}

export function forbiddenUnits(choice: RestrictionChoice, covers: RestrictionCovers): Set<string> {
  return new Set([...choice.units, ...[...choice.presets].flatMap((key) => covers[key] ?? [])]);
}

export function togglePreset(choice: RestrictionChoice, key: string): RestrictionChoice {
  const presets = new Set(choice.presets);
  if (!presets.delete(key)) {
    presets.add(key);
  }
  return { presets, units: choice.units };
}

/** A preset has no exceptions: allowing one of its units breaks it up into the units that stay forbidden. */
export function toggleUnit(choice: RestrictionChoice, id: string, covers: RestrictionCovers): RestrictionChoice {
  const units = new Set(choice.units);
  const presets = new Set(choice.presets);
  const covering = [...choice.presets].filter((key) => covers[key]?.includes(id));
  if (covering.length > 0) {
    for (const key of covering) {
      presets.delete(key);
      for (const unit of covers[key] ?? []) {
        units.add(unit);
      }
    }
    units.delete(id);
  } else if (!units.delete(id)) {
    units.add(id);
  }
  return { presets, units };
}

/** The room's list. A unit that left with a mod goes, and so does one a chosen preset forbids anyway. */
export function joinRestrictions(choice: RestrictionChoice, covers: RestrictionCovers, known: ReadonlySet<string>): string[] {
  const covered = forbiddenUnits({ presets: choice.presets, units: new Set() }, covers);
  return [...choice.presets, ...[...choice.units].filter((id) => known.has(id) && !covered.has(id))];
}
