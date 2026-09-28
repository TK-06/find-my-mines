import { describe, expect, it } from 'vitest';
import { MINE_PALETTE, MINE_ROWS, MINE_SIZE, OUTLINE, pixelRuns, withOutline } from './mineSprite.js';

const BODY = new Set(['K', 'D']);

/** The four pixels that share an edge with (x, y), clipped to the grid. */
function edgeNeighbours(rows: readonly string[], x: number, y: number): string[] {
  return [
    rows[y - 1]?.[x],
    rows[y + 1]?.[x],
    rows[y]?.[x - 1],
    rows[y]?.[x + 1],
  ].filter((p): p is string => p !== undefined);
}

describe('MINE_ROWS', () => {
  it('is a 16×16 grid', () => {
    expect(MINE_SIZE).toBe(16);
    expect(MINE_ROWS).toHaveLength(MINE_SIZE);
    for (const row of MINE_ROWS) expect(row).toHaveLength(MINE_SIZE);
  });

  it('uses only palette colours and empty pixels', () => {
    for (const pixel of MINE_ROWS.join('')) {
      expect(pixel === '.' || pixel in MINE_PALETTE).toBe(true);
    }
  });

  it('has no outline of its own — the outline is derived, dark mode only', () => {
    expect(MINE_ROWS.join('')).not.toContain(OUTLINE);
    expect(MINE_PALETTE[OUTLINE]).toBeDefined();
  });
});

describe('withOutline', () => {
  const outlined = withOutline(MINE_ROWS);

  it('keeps the sprite 16×16 — nothing is drawn outside the grid', () => {
    expect(outlined).toHaveLength(MINE_SIZE);
    for (const row of outlined) expect(row).toHaveLength(MINE_SIZE);
  });

  it('leaves every drawn pixel untouched', () => {
    MINE_ROWS.forEach((row, y) => {
      [...row].forEach((pixel, x) => {
        if (pixel !== '.') expect(outlined[y][x]).toBe(pixel);
      });
    });
  });

  it('outlines exactly the empty pixels that share an edge with the body', () => {
    MINE_ROWS.forEach((row, y) => {
      [...row].forEach((pixel, x) => {
        if (pixel !== '.') return;
        const besideBody = edgeNeighbours(MINE_ROWS, x, y).some((p) => BODY.has(p));
        expect(outlined[y][x]).toBe(besideBody ? OUTLINE : '.');
      });
    });
  });

  it('rings a body pixel on its four sides, not its corners', () => {
    expect(withOutline(['...', '.K.', '...'])).toEqual(['.U.', 'UKU', '.U.']);
  });

  it('outlines the shade too, but not the fuse, shine or spark', () => {
    expect(withOutline(['.D'])).toEqual(['UD']);
    expect(withOutline(['B..', '.W.', 'O.Y'])).toEqual(['B..', '.W.', 'O.Y']);
  });

  it('clips at the edge of the grid instead of growing it', () => {
    expect(withOutline(['K'])).toEqual(['K']);
    expect(withOutline(['K.', '..'])).toEqual(['KU', 'U.']);
  });

  it('does not change the rows it is given', () => {
    const rows = ['.K.'];
    withOutline(rows);
    expect(rows).toEqual(['.K.']);
  });
});

describe('pixelRuns', () => {
  it('merges same-colour neighbours in a row into one run and skips empty pixels', () => {
    expect(pixelRuns(['KKD.K', '.....'])).toEqual([
      { x: 0, y: 0, width: 2, code: 'K' },
      { x: 2, y: 0, width: 1, code: 'D' },
      { x: 4, y: 0, width: 1, code: 'K' },
    ]);
  });

  it('never joins runs across rows', () => {
    expect(pixelRuns(['.K', 'K.'])).toEqual([
      { x: 1, y: 0, width: 1, code: 'K' },
      { x: 0, y: 1, width: 1, code: 'K' },
    ]);
  });

  it('covers every drawn pixel of the sprite exactly once, in its own colour', () => {
    const outlined = withOutline(MINE_ROWS);
    const painted = outlined.map((row) => [...row].map(() => '.'));
    for (const run of pixelRuns(outlined)) {
      for (let x = run.x; x < run.x + run.width; x++) {
        expect(painted[run.y][x]).toBe('.');
        painted[run.y][x] = run.code;
      }
    }
    expect(painted.map((row) => row.join(''))).toEqual(outlined);
  });
});
