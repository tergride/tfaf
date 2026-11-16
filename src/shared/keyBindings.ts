// Key bindings as the game writes them: modifiers and a key name joined with `-`, e.g. `Ctrl-Shift-A`. The same rules
// serve the main process, which changes the key map, and the interface, which records keys and finds conflicts.

export const KEY_MODIFIERS = ['Ctrl', 'Alt', 'Shift'] as const;

export interface KeyModifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

/** One spelling per combination, `Ctrl-Shift-Alt-key`, as the game's key mapper compares bindings (NormalizeKeyBinding). */
export function normalizeKeyBinding(binding: string): string {
  let ctrl = false;
  let alt = false;
  let shift = false;
  let key = '';
  for (const part of binding.split('-')) {
    if (part === 'Ctrl') {
      ctrl = true;
    } else if (part === 'Shift') {
      shift = true;
    } else if (part === 'Alt') {
      alt = true;
    } else if (part) {
      key = part;
    }
  }
  if (key !== 'Alt' && alt) {
    key = `Alt-${key}`;
  }
  if (key !== 'Shift' && shift) {
    key = `Shift-${key}`;
  }
  if (key !== 'Ctrl' && ctrl) {
    key = `Ctrl-${key}`;
  }
  return key;
}

/** What the game's key dialog records for a key pressed with modifiers: `Ctrl-Alt-Shift-key`. */
export function keyBinding(key: string, modifiers: KeyModifiers): string {
  let binding = '';
  if (key !== 'Ctrl' && modifiers.ctrl) {
    binding += 'Ctrl-';
  }
  if (key !== 'Alt' && modifiers.alt) {
    binding += 'Alt-';
  }
  if (key !== 'Shift' && modifiers.shift) {
    binding += 'Shift-';
  }
  return binding + key;
}

/** Like the game's ContainsKeyModifiers: the binding starts with a modifier, a modifier pressed alone included. */
export function hasKeyModifiers(binding: string): boolean {
  return KEY_MODIFIERS.some((modifier) => binding.startsWith(modifier));
}

/** A binding for people, with the game's key names: `Ctrl + Shift + A`. */
export function formatKeyBinding(binding: string, labels: Readonly<Record<string, string>>): string {
  return binding
    .split('-')
    .map((part) => labels[part] ?? part)
    .join(' + ');
}
