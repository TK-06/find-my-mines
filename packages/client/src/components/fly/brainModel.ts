import { cellLabel, type FlyThoughtNotice } from '@fmm/shared';

/**
 * The Fruit Fly brain panel's pure pieces: decoding the quantised trace, the
 * tiny 3-D projection, which frame to draw when, and the sentence that goes
 * beside the canvas. No DOM, no drawing — this is the part unit tests can hold.
 * (The board's score tinting lives in `smellMap.ts`, apart from this panel code.)
 */

/**
 * The server shows at most this many candidate cells (the pick plus its best
 * alternatives), so a count this big means "this many or more".
 */
export const FLY_DISPLAY_CANDIDATES = 40;

/**
 * One byte per rate. Base64 decoding in the browser. Null when the payload is
 * empty or does not carry exactly `steps * neurons` bytes, so a bad thought is
 * dropped instead of drawn from garbage.
 */
export function decodeFlyRates(encoded: string, steps: number, neurons: number): Uint8Array | null {
  if (steps < 1 || neurons < 1) return null;
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    return null;
  }
  const expected = steps * neurons;
  if (binary.length !== expected) return null;
  const bytes = new Uint8Array(expected);
  for (let i = 0; i < expected; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * One point of the brain map, turned around the vertical axis: a simple
 * orthographic camera, so a full turn is just the angle sweeping 0 → 2π.
 * `depth` runs −1 (front, near the viewer) to 1 (back), for the slight
 * brightness falloff that makes the cloud readable in 2-D.
 */
export function projectPoint(
  x: number,
  y: number,
  z: number,
  angle: number,
): { x: number; y: number; depth: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: x * cos + z * sin, y, depth: -x * sin + z * cos };
}

/** How far round the cloud has turned after `elapsedMs`, one full turn per `turnMs`. */
export function rotationAngle(elapsedMs: number, turnMs: number): number {
  return (elapsedMs / turnMs) * Math.PI * 2;
}

/**
 * Which of the recorded steps to draw `elapsedMs` after the thought arrived:
 * the steps play evenly over `playMs`, then the last one holds. Before the
 * thought (a negative time) it is the first step.
 */
export function thoughtStep(elapsedMs: number, steps: number, playMs: number): number {
  if (steps < 1) return 0;
  const step = Math.floor((elapsedMs / playMs) * steps);
  return Math.max(0, Math.min(steps - 1, step));
}

/** The one-line live text beside the canvas. Hand-built so a test can pin the wording. */
export function describeFlyThought(
  thought: Pick<FlyThoughtNotice, 'move' | 'pick' | 'candidates'>,
  outputNeurons: number,
): string {
  const pick = cellLabel(thought.pick);
  const count = thought.candidates.length;
  const best = Math.max(...thought.candidates.map((cell) => cell.score));
  const pickScore = thought.candidates.find(
    (cell) => cell.row === thought.pick.row && cell.col === thought.pick.col,
  )?.score;
  // Easier levels sometimes pass over the top score on purpose, so only the
  // top score may be called the top pick.
  if (pickScore !== undefined && pickScore < best) {
    return `Move ${thought.move + 1}: the fly's ${outputNeurons} output neurons rated ${count} cells; it went for ${pick}.`;
  }
  const cells = count >= FLY_DISPLAY_CANDIDATES ? `${count} or more cells` : `${count} cells`;
  return `Move ${thought.move + 1}: the fly's ${outputNeurons} output neurons favoured ${pick} (its top pick of ${cells}).`;
}
