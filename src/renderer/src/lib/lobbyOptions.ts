import type { LobbyOptionGroup } from '../../../shared/contract.ts';

/** The groups with the options a search finds, by name, description or any value; empty groups go. */
export function searchLobbyOptions(groups: readonly LobbyOptionGroup[], query: string): readonly LobbyOptionGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return groups;
  }
  const matches = (text: string): boolean => text.toLowerCase().includes(needle);
  return groups.flatMap((group) => {
    const options = group.options.filter(
      (option) => matches(option.label) || matches(option.help) || option.choices.some((choice) => matches(choice.label)),
    );
    return options.length > 0 ? [{ ...group, options }] : [];
  });
}
