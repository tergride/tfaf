export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

/**
 * A message worded by the number in its `count` parameter. The forms are keyed by the plural categories of
 * Intl.PluralRules: Russian needs `one`, `few`, `many` and `other` (fractions), English `one` and `other`.
 */
export class Plural {
  readonly forms: PluralForms;

  constructor(forms: PluralForms) {
    this.forms = forms;
  }
}

export function plural(forms: PluralForms): Plural {
  return new Plural(forms);
}
