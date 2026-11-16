// RSQL filter fragments for the Elide based FAF API. Values are always quoted so user input cannot change the query.

export function rsqlQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function rsqlContains(field: string, value: string): string {
  return `${field}==${rsqlQuote(`*${value}*`)}`;
}

export function rsqlStartsWith(field: string, value: string): string {
  return `${field}==${rsqlQuote(`${value}*`)}`;
}

export function rsqlEquals(field: string, value: string | number | boolean): string {
  return typeof value === 'string' ? `${field}==${rsqlQuote(value)}` : `${field}==${value}`;
}

export function rsqlIn(field: string, values: readonly number[]): string {
  return `${field}=in=(${values.join(',')})`;
}

export function rsqlAnd(conditions: string[]): string {
  return conditions.join(';');
}

export function rsqlOr(conditions: string[]): string {
  return `(${conditions.join(',')})`;
}

export function sortParam(field: string, order: 'asc' | 'desc'): string {
  return order === 'desc' ? `-${field}` : field;
}
