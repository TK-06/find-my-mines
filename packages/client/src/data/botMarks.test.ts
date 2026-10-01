import { describe, expect, it } from 'vitest';
import { FLY_HEIGHT, FLY_ROWS, FLY_WIDTH, flyRuns } from './botMarks.js';

describe('the fly mark', () => {
  it('is a 13×9 grid of known pixel codes', () => {
    expect(FLY_ROWS).toHaveLength(FLY_HEIGHT);
    for (const row of FLY_ROWS) {
      expect(row).toHaveLength(FLY_WIDTH);
      expect(row).toMatch(/^[.#wR]+$/);
    }
  });

  it('has a body, wings and exactly one eye', () => {
    const codes = new Set(flyRuns().map((run) => run.code));
    expect(codes).toEqual(new Set(['#', 'w', 'R']));
    // The eye is on the left edge, facing left.
    expect(flyRuns().filter((run) => run.code === 'R').every((run) => run.x <= 2)).toBe(true);
  });

  it('merges pixels into runs that stay inside the grid and cover every drawn pixel', () => {
    const runs = flyRuns();
    for (const run of runs) {
      expect(run.x + run.width).toBeLessThanOrEqual(FLY_WIDTH);
      expect(run.y).toBeLessThan(FLY_HEIGHT);
    }
    const drawn = FLY_ROWS.join('').replace(/\./g, '').length;
    expect(runs.reduce((sum, run) => sum + run.width, 0)).toBe(drawn);
  });
});
