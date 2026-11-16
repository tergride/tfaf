// The 16×16 flags of the official client; its A1 and A2 (anonymous proxy, satellite provider) show the globe there too.
const flags = import.meta.glob<string>('../assets/flags/*.png', { eager: true, import: 'default' });

const NON_COUNTRY_CODES = new Set(['A1', 'A2']);

export function countryFlagUrl(country: string): string | undefined {
  const name = NON_COUNTRY_CODES.has(country.toUpperCase()) ? 'earth' : country.toLowerCase();
  return flags[`../assets/flags/${name}.png`];
}
