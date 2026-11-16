// Axis scales of the profile's rating chart: round steps for ratings, calendar steps for dates.

const DAY_MS = 24 * 60 * 60 * 1000;

export type TimeUnit = 'day' | 'month' | 'year';

// Steps from a day to ten years; the first long enough for the wanted number of ticks wins.
const TIME_STEPS: { unit: TimeUnit; size: number; approxMs: number }[] = [
  ...[1, 2, 7, 14].map((size) => ({ unit: 'day' as const, size, approxMs: size * DAY_MS })),
  ...[1, 2, 3, 6].map((size) => ({ unit: 'month' as const, size, approxMs: size * 30.44 * DAY_MS })),
  ...[1, 2, 5, 10].map((size) => ({ unit: 'year' as const, size, approxMs: size * 365.25 * DAY_MS })),
];

function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}

/**
 * Round values at a step of 1, 2 or 5 × 10ⁿ covering min to max, about `count` of them; the domain widens to the
 * outer ticks. A flat line gets room above and below.
 */
export function niceTicks(min: number, max: number, count = 5): { ticks: number[]; min: number; max: number } {
  const [low, high] = min === max ? [min - 10, max + 10] : [Math.min(min, max), Math.max(min, max)];
  const step = niceStep(high - low, count);
  const first = Math.floor(low / step) * step;
  const last = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= last + step / 2; value += step) {
    // Repeated addition drifts (0.1 + 0.2); rounding to the step's precision keeps the labels clean.
    ticks.push(Number(value.toPrecision(12)));
  }
  return { ticks, min: first, max: last };
}

function startOf(time: number, unit: TimeUnit, size: number): Date {
  const date = new Date(time);
  if (unit === 'day') {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
  if (unit === 'month') {
    return new Date(date.getFullYear(), date.getMonth() - (date.getMonth() % size), 1);
  }
  return new Date(date.getFullYear() - (date.getFullYear() % size), 0, 1);
}

function advance(date: Date, unit: TimeUnit, size: number): Date {
  if (unit === 'day') {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + size);
  }
  if (unit === 'month') {
    return new Date(date.getFullYear(), date.getMonth() + size, 1);
  }
  return new Date(date.getFullYear() + size, 0, 1);
}

/** Calendar dates in the local time zone between start and end, about `count` of them, and the unit to label them by. */
export function timeTicks(start: number, end: number, count = 6): { ticks: number[]; unit: TimeUnit } {
  const span = Math.max(0, end - start);
  const step = TIME_STEPS.find((candidate) => candidate.approxMs * count >= span) ?? TIME_STEPS[TIME_STEPS.length - 1]!;
  const ticks: number[] = [];
  for (let date = startOf(start, step.unit, step.size); date.getTime() <= end; date = advance(date, step.unit, step.size)) {
    if (date.getTime() >= start) {
      ticks.push(date.getTime());
    }
  }
  return { ticks, unit: step.unit };
}

/** The index of the value nearest to x in ascending values; -1 when there are none. */
export function nearestIndex(values: readonly number[], x: number): number {
  if (values.length === 0) {
    return -1;
  }
  let low = 0;
  let high = values.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle]! < x) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low > 0 && x - values[low - 1]! <= values[low]! - x ? low - 1 : low;
}
