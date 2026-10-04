/**
 * The short buzz when your turn starts. Phones only: iPhones and iPads do not
 * offer `navigator.vibrate` in the browser, and a desktop browser may have it
 * and do nothing. Never buzzes for someone who asked their system for less
 * motion.
 */

/** How long the buzz lasts, in milliseconds. */
export const VIBRATE_MS = 80;

/** Whether this browser can vibrate at all — the switch is disabled when not. */
export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    // matchMedia missing in some embedded contexts.
    return false;
  }
}

/**
 * Whether the person has touched the page yet. Chrome refuses to vibrate
 * before that — and says so in the console — so the buzz waits for it.
 */
function hasBeenTouched(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return activation === undefined || activation.hasBeenActive;
}

/** One short buzz, or nothing when it is not allowed or not possible. */
export function vibrate(ms: number = VIBRATE_MS): void {
  try {
    if (!canVibrate() || prefersReducedMotion() || !hasBeenTouched()) return;
    navigator.vibrate(ms);
  } catch {
    // The browser refused: not worth a failure.
  }
}
