import { plural } from '../plural.ts';
import type { Messages } from '../ru.ts';

export const mods: Messages['mods'] = {
  title: 'Mods',
  count: plural({ one: '{count} mod', other: '{count} mods' }),
  searchPlaceholder: 'Mod name',
  noFiltersHint: 'No filters set: showing all mods in the vault',
  sort: {
    byAuthor: 'By author',
  },
  typeFilter: 'Type',
  types: {
    any: 'All',
    sim: 'Sim',
    simShort: 'Sim',
    uiMod: 'UI mod',
    simMod: 'Sim mod',
    uiMods: 'UI mods',
    simMods: 'Sim mods',
  },
  filters: {
    active: 'Active',
  },
  columns: {
    mod: 'Mod',
    type: 'Type',
    author: 'Author',
    updated: 'Updated',
    uploaded: 'Uploaded',
    active: 'Active',
  },
  vaultTable: 'Vault mods',
  installedTable: 'Installed mods',
  empty: {
    title: 'No mods match the filters',
  },
  status: {
    active: 'Active',
    installed: 'Installed',
    notInstalled: 'Not installed',
  },
  recommended: 'Recommended',
  ranked: 'Ranked',
  enable: 'Enable',
  disable: 'Disable',
  activeSwitch: '{name}: active',
  installed: {
    searchPlaceholder: 'Name or author',
    rescan: 'Rescan the mods folder',
    onlyActive: 'Active only',
    activeOf: '{active} of {total} active',
    hint: 'UI mods work in any game; sim mods are added when you host a game',
    noMods: 'No mods',
    noModsHint: 'Install mods from the vault or check the folder in the settings.',
  },
  detail: {
    vaultKind: 'Vault mod',
    installedKind: 'Installed mod',
    uploader: 'Uploaded by',
    uploaded: 'Uploaded',
    updated: 'Updated',
    folder: 'Folder',
    enabled: 'Mod enabled',
    disabled: 'Mod disabled',
    uninstall: 'Delete mod',
  },
  uninstallConfirm: {
    title: 'Delete mod “{name}”?',
    description: 'The mod folder will be deleted from disk.',
  },
};
