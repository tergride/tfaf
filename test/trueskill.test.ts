import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchQuality } from '../src/shared/trueskill.ts';

// The defaults of the TrueSkill paper, for which jskills' tests give known qualities.
const DEFAULT = { mean: 25, deviation: 25 / 3 };
const DEFAULT_BETA = 25 / 6;

function close(actual: number | null, expected: number): void {
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${String(actual)} is not ${expected}`);
}

describe('matchQuality', () => {
  it('gives the known qualities of the TrueSkill defaults', () => {
    close(matchQuality([[DEFAULT], [DEFAULT]], DEFAULT_BETA), Math.sqrt(0.2));
    close(matchQuality([[DEFAULT, DEFAULT], [DEFAULT, DEFAULT]], DEFAULT_BETA), Math.sqrt(0.2));
    close(matchQuality([[DEFAULT], [DEFAULT], [DEFAULT]], DEFAULT_BETA), 0.2);
  });

  it('falls with the gap between the teams', () => {
    const gap = 10;
    const variance = 2 * DEFAULT_BETA ** 2 + 2 * DEFAULT.deviation ** 2;
    close(
      matchQuality([[{ mean: 25 + gap / 2, deviation: DEFAULT.deviation }], [{ mean: 25 - gap / 2, deviation: DEFAULT.deviation }]], DEFAULT_BETA),
      Math.sqrt(0.2) * Math.exp(-(gap ** 2) / (2 * variance)),
    );
    const even = matchQuality([[{ mean: 1500, deviation: 80 }], [{ mean: 1500, deviation: 80 }]]) ?? 0;
    const uneven = matchQuality([[{ mean: 2000, deviation: 80 }], [{ mean: 1200, deviation: 80 }]]) ?? 1;
    assert.ok(uneven < 0.1 && even > 0.8);
  });

  it('needs at least two teams with players', () => {
    assert.equal(matchQuality([[DEFAULT]]), null);
    assert.equal(matchQuality([[DEFAULT], []]), null);
  });
});
