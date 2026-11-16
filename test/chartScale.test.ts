import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nearestIndex, niceTicks, timeTicks } from '../src/renderer/src/lib/chartScale.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('chart scales', () => {
  it('rounds rating ticks to 1, 2 or 5 steps', () => {
    assert.deepEqual(niceTicks(1043, 1488, 5), { ticks: [1000, 1100, 1200, 1300, 1400, 1500], min: 1000, max: 1500 });
    assert.deepEqual(niceTicks(-120, 380, 5).ticks, [-200, -100, 0, 100, 200, 300, 400]);
    assert.deepEqual(niceTicks(0.1, 0.7, 3).ticks, [0, 0.2, 0.4, 0.6, 0.8]);
  });

  it('gives a flat line room above and below', () => {
    const scale = niceTicks(1500, 1500);
    assert.ok(scale.min < 1500 && scale.max > 1500);
  });

  it('picks calendar steps by the span', () => {
    const start = new Date(2026, 0, 10).getTime();
    const month = timeTicks(start, start + 30 * DAY_MS);
    assert.equal(month.unit, 'day');
    assert.ok(month.ticks.length >= 4 && month.ticks.length <= 8);

    const years = timeTicks(new Date(2018, 5, 1).getTime(), new Date(2026, 5, 1).getTime());
    assert.equal(years.unit, 'year');
    assert.deepEqual(
      years.ticks.map((tick) => new Date(tick).getFullYear()),
      [2020, 2022, 2024, 2026],
    );

    const months = timeTicks(new Date(2025, 9, 15).getTime(), new Date(2026, 9, 15).getTime());
    assert.equal(months.unit, 'month');
    for (const tick of months.ticks) {
      assert.equal(new Date(tick).getDate(), 1);
    }
  });

  it('finds the nearest point', () => {
    assert.equal(nearestIndex([], 5), -1);
    assert.equal(nearestIndex([10, 20, 30], 0), 0);
    assert.equal(nearestIndex([10, 20, 30], 24), 1);
    assert.equal(nearestIndex([10, 20, 30], 26), 2);
    assert.equal(nearestIndex([10, 20, 30], 99), 2);
  });
});
