/**
 * The mine, as 8-bit pixel art: a round black bomb with a lit fuse.
 *
 * Kept as plain data plus pure functions so the drawing can be unit-tested
 * without a browser. `MineSprite` turns it into an inline SVG.
 */

/** The sprite is square: this many pixels a side. */
export const MINE_SIZE = 16;

/** One string per row, top to bottom. '.' is an empty pixel. */
export const MINE_ROWS: readonly string[] = [
  '..........Y..Y..',
  '...........OO...',
  '..........YOOY..',
  '...........OO...',
  '..........B.....',
  '.........B......',
  '.....KKKDB......',
  '...KKKKKKKK.....',
  '..KKWWKKKKKK....',
  '..KWWKKKKKKK....',
  '.KKWKKKKKKKKK...',
  '.KKKKKKKKKKKK...',
  '.KKKKKKKKKKDK...',
  '..KKKKKKKKDK....',
  '...KKKKKKKK.....',
  '.....KKKK.......',
];

/** The pixel code `withOutline` adds; never part of the rows themselves. */
export const OUTLINE = 'U';

/**
 * Pixel colours. They are the same in both themes on purpose — a bomb is
 * black — which is why dark mode needs the light outline to keep the body
 * from vanishing into a dark tile.
 */
export const MINE_PALETTE = {
  U: '#c9ced6', // outline, drawn in dark mode only
  K: '#16181b', // body
  D: '#3a3f46', // shade
  W: '#ffffff', // shine
  B: '#8a5a2b', // fuse
  O: '#ff5a1f', // spark
  Y: '#ffc93c', // spark tips
} as const;

export type PixelCode = keyof typeof MINE_PALETTE;

/** The pixels the outline hugs. The fuse and spark are bright enough alone. */
const BODY = new Set(['K', 'D']);

/**
 * The rows with an outline pixel on every empty pixel that shares an edge
 * with the body. Corners are left alone, so the ring stays one pixel thin,
 * and it is clipped at the edge rather than growing the sprite past 16×16.
 */
export function withOutline(rows: readonly string[]): string[] {
  const isBody = (x: number, y: number) => BODY.has(rows[y]?.[x] ?? '.');

  return rows.map((row, y) =>
    [...row]
      .map((pixel, x) => {
        if (pixel !== '.') return pixel;
        const besideBody = isBody(x, y - 1) || isBody(x, y + 1) || isBody(x - 1, y) || isBody(x + 1, y);
        return besideBody ? OUTLINE : '.';
      })
      .join(''),
  );
}

/** A horizontal stretch of same-coloured pixels, one pixel tall. */
export interface PixelRun {
  x: number;
  y: number;
  width: number;
  code: string;
}

/**
 * Every drawn pixel, merged into horizontal runs of one colour. Drawing runs
 * instead of single pixels keeps each sprite to a handful of SVG shapes, which
 * matters on a 16×16 board full of found mines.
 */
export function pixelRuns(rows: readonly string[]): PixelRun[] {
  const runs: PixelRun[] = [];

  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const code = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === code) end++;
      if (code !== '.') runs.push({ x, y, width: end - x, code });
      x = end;
    }
  });

  return runs;
}
