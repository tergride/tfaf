interface HintedElement {
  dataset: { tooltip?: string };
  textContent: string | null;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

/** What an element's tooltip says: `data-tooltip`, unless that only repeats a text shown in full. */
export function tooltipText(element: HintedElement): string | null {
  const hint = element.dataset.tooltip;
  if (!hint) {
    return null;
  }
  const cut = element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight;
  return hint === element.textContent?.trim() && !cut ? null : hint;
}
