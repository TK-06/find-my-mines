/**
 * Pure presentation helpers for the profile and game-log pages.
 *
 * Kept separate from the components so they can be unit-tested without a
 * browser, a database, or a clock.
 */

/** Win rate as a whole percentage. Zero games is 0%, never NaN. */
export function winRate(wins: number, gamesPlayed: number): number {
  if (gamesPlayed <= 0) return 0;
  return Math.round((wins / gamesPlayed) * 100);
}

/** Signed rating change: "+12", "-8", or "0" for no movement. */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

/** Which colour class a delta should render with. */
export function deltaTone(delta: number): 'up' | 'down' | 'flat' {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

/** Compact board description, e.g. "6×6 · 11 mines". */
export function describeBoard(config: {
  rows?: number;
  cols?: number;
  mineCount?: number;
} | null | undefined): string {
  if (!config?.rows || !config?.cols) return 'unknown board';
  return `${config.rows}×${config.cols} · ${config.mineCount ?? '?'} mines`;
}

/**
 * Short relative time. `now` is injected so the tests are not time-dependent.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'unknown';

  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  return `${Math.floor(months / 12)}y ago`;
}

/** Orders seats for display: best placement first, then by score. */
export function orderSeats<T extends { placement: number; score: number }>(seats: T[]): T[] {
  return [...seats].sort((a, b) => a.placement - b.placement || b.score - a.score);
}
