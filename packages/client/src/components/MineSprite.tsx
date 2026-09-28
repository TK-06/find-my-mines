import { MINE_PALETTE, MINE_ROWS, MINE_SIZE, pixelRuns, withOutline, type PixelCode } from '../data/mineSprite.js';

/**
 * Classes that let the stylesheet reach single colours: the outline is shown
 * in dark mode only, and the spark flickers on a found mine.
 */
const LAYER_CLASS: Partial<Record<PixelCode, string>> = {
  U: 'mine-outline',
  O: 'mine-spark',
  Y: 'mine-spark tip',
};

// The sprite never changes, so it is worked out once: one path per colour,
// each a list of one-pixel-tall runs.
const runs = pixelRuns(withOutline(MINE_ROWS));
const layers = (Object.keys(MINE_PALETTE) as PixelCode[])
  .map((code) => ({
    code,
    d: runs
      .filter((run) => run.code === code)
      .map((run) => `M${run.x} ${run.y}h${run.width}v1h-${run.width}z`)
      .join(''),
  }))
  .filter((layer) => layer.d !== '');

const sprite = (
  <svg
    className="pixel-mine"
    viewBox={`0 0 ${MINE_SIZE} ${MINE_SIZE}`}
    shapeRendering="crispEdges"
    aria-hidden="true"
  >
    {layers.map(({ code, d }) => (
      <path key={code} className={LAYER_CLASS[code]} fill={MINE_PALETTE[code]} d={d} />
    ))}
  </svg>
);

/**
 * The 8-bit mine. Decorative only: whatever holds it carries the label, so a
 * screen reader hears "B4, mine" rather than a picture description.
 */
export function MineSprite() {
  return sprite;
}
