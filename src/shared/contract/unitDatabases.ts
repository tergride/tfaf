/** The scheme of the unit databases inside the launcher: main answers it from their copies on disk. */
export const UNIT_DATABASE_SCHEME = 'tfaf-units';

export const UNIT_DATABASE_IDS = ['spooky', 'unitdb'] as const;

export type UnitDatabaseId = (typeof UNIT_DATABASE_IDS)[number];

// The unit databases of the official client (application.yml, unitDatabase). Its ETFreeman address now redirects to
// unitdb.faforever.com, where ETFreeman's database replaced Rackover's, so two of its three entries are the same site.
export const UNIT_DATABASE_SITES: Record<UnitDatabaseId, string> = {
  spooky: 'https://faforever.github.io/spooky-db',
  unitdb: 'https://unitdb.faforever.com',
};

export function unitDatabasePage(id: UnitDatabaseId): string {
  return `${UNIT_DATABASE_SCHEME}://${id}/`;
}
