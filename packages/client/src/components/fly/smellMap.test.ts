import { describe, expect, it } from 'vitest';
import { normalizeFlyScores } from './smellMap.js';

describe('normalizeFlyScores', () => {
  it('spreads scores over the full range, lowest to highest', () => {
    expect(normalizeFlyScores([0, 5, 10])).toEqual([0, 0.5, 1]);
    expect(normalizeFlyScores([-3, -1])).toEqual([0, 1]);
  });

  it('keeps the order of the scores it was given', () => {
    expect(normalizeFlyScores([10, 0, 5])).toEqual([1, 0, 0.5]);
  });

  it('gives equal scores the middle of the range instead of a divide by zero', () => {
    expect(normalizeFlyScores([7, 7, 7])).toEqual([0.5, 0.5, 0.5]);
    expect(normalizeFlyScores([])).toEqual([]);
  });
});
