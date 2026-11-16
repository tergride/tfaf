import type { Settings } from '../../../shared/contract.ts';
import { resolveTheme, themeStyle } from '../../../shared/themes.ts';

/** Contours come from CSS; the complete palette is applied before mounting the interface. */
export function setTheme(settings: Pick<Settings, 'theme' | 'customTheme'>): void {
  const { controls, colors } = resolveTheme(settings);
  const root = document.documentElement;
  root.dataset.theme = controls;
  for (const [name, value] of Object.entries(themeStyle(colors))) {
    root.style.setProperty(name, value);
  }
}
