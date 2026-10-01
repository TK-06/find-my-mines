import { pixelRuns, type PixelRun } from './mineSprite.js';

/**
 * The Fruit Fly's mark, as 8-bit pixel art in the robot's and the mine's
 * spirit: a fly seen from the side, facing left, wings up.
 *
 * Plain data plus pure functions, like the mine, so the drawing can be
 * unit-tested without a browser. `BotMark` turns it into an inline SVG.
 */

export const FLY_WIDTH = 13;
export const FLY_HEIGHT = 9;

/**
 * One string per row, top to bottom. '#' is the body (the avatar's glyph
 * colour), 'w' the wing (the same colour, faded), 'R' the eye, '.' empty.
 */
export const FLY_ROWS: readonly string[] = [
  '.......www...',
  '......wwwwww.',
  '.....wwwwwwww',
  '.RR..#wwwwww.',
  'RRR#######...',
  'RR#########..',
  '.#.#######...',
  '.#..#.#.#....',
  '#..#..#..#...',
];

/** How much of the glyph colour the wing keeps: see-through, like a real one. */
export const FLY_WING_OPACITY = 0.42;

/** The fly's pixels merged into horizontal runs, as the mine's are. */
export function flyRuns(rows: readonly string[] = FLY_ROWS): PixelRun[] {
  return pixelRuns(rows);
}
