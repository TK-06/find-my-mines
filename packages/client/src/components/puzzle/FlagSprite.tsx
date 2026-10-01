import { pixelRuns } from '../../data/mineSprite.js';

/**
 * The flag, as 8-bit pixel art to sit beside the pixel mine: a pennant on a
 * pole with a stepped base. C is the cloth, P the pole and base. The colours
 * come from the stylesheet (--bad and --ink), so it follows the theme.
 */
const FLAG_ROWS: readonly string[] = [
  '................',
  '........CPP.....',
  '......CCCPP.....',
  '....CCCCCPP.....',
  '..CCCCCCCPP.....',
  '....CCCCCPP.....',
  '......CCCPP.....',
  '........CPP.....',
  '.........PP.....',
  '.........PP.....',
  '.........PP.....',
  '.......PPPPPP...',
  '.....PPPPPPPPPP.',
  '.....PPPPPPPPPP.',
  '................',
  '................',
];

/** Drawn over a flag that turned out wrong, once the game is lost. */
const CROSS_ROWS: readonly string[] = [
  '................',
  '.XX..........XX.',
  '.XXX........XXX.',
  '..XXX......XXX..',
  '...XXX....XXX...',
  '....XXX..XXX....',
  '.....XXXXXX.....',
  '......XXXX......',
  '......XXXX......',
  '.....XXXXXX.....',
  '....XXX..XXX....',
  '...XXX....XXX...',
  '..XXX......XXX..',
  '.XXX........XXX.',
  '.XX..........XX.',
  '................',
];

function pathOf(rows: readonly string[], code: string): string {
  return pixelRuns(rows)
    .filter((run) => run.code === code)
    .map((run) => `M${run.x} ${run.y}h${run.width}v1h-${run.width}z`)
    .join('');
}

// Worked out once: the sprite never changes.
const CLOTH = pathOf(FLAG_ROWS, 'C');
const POLE = pathOf(FLAG_ROWS, 'P');
const CROSS = pathOf(CROSS_ROWS, 'X');

/** Decorative only: the cell carries the label ("C4, flagged"). */
export function FlagSprite({ crossed = false }: { crossed?: boolean }) {
  return (
    <svg
      className={crossed ? 'pixel-flag crossed' : 'pixel-flag'}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <path className="flag-cloth" d={CLOTH} />
      <path className="flag-pole" d={POLE} />
      {crossed && <path className="flag-cross" d={CROSS} />}
    </svg>
  );
}
