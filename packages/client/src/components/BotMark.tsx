import type { AiModel } from '@fmm/shared';
import { FLY_HEIGHT, FLY_WING_OPACITY, FLY_WIDTH, flyRuns } from '../data/botMarks.js';
import typesafeLogo from '../assets/typesafe-ai.webp';

/**
 * The AI's mark: a small pixel robot, in the same 8-bit spirit as the mine,
 * so it never passes for a person's initial.
 */
const ROBOT = (
  <svg viewBox="0 0 9 8" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M4 0h1v2h-1zM1 2h7v2h-7zM0 4h3v1h-3zM4 4h1v1h-1zM6 4h3v1h-3zM1 5h7v1h-7zM1 6h2v1h-2zM6 6h2v1h-2zM1 7h7v1h-7z"
    />
  </svg>
);

// The fly never changes, so it is worked out once: one path per colour.
const flyPath = (code: string) =>
  flyRuns()
    .filter((run) => run.code === code)
    .map((run) => `M${run.x} ${run.y}h${run.width}v1h-${run.width}z`)
    .join('');

const FLY = (
  <svg
    viewBox={`0 0 ${FLY_WIDTH} ${FLY_HEIGHT}`}
    shapeRendering="crispEdges"
    aria-hidden="true"
    focusable="false"
  >
    <path fill="currentColor" d={flyPath('#')} />
    <path fill="currentColor" fillOpacity={FLY_WING_OPACITY} d={flyPath('w')} />
    <path fill="var(--fly-eye)" d={flyPath('R')} />
  </svg>
);

/**
 * TypeSafe AI's logo, for JEV. It is a picture (black line art on white, no
 * transparency), so the stylesheet inverts it in the light theme to match the
 * bot avatar's ink circle and paper glyph.
 */
const JEV = <img className="jev-logo" src={typesafeLogo} alt="" draggable={false} />;

/**
 * The opponent's mark: the pixel robot for the AI, the pixel fly for the
 * Fruit Fly, TypeSafe AI's logo for JEV. Decorative only — whatever holds it
 * carries the name. Sized and coloured by its container (`currentColor`).
 */
export function BotMark({ model }: { model: AiModel }) {
  return model === 'fly' ? FLY : model === 'jev' ? JEV : ROBOT;
}
