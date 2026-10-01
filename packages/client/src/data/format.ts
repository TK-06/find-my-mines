import type { LogLine, OnlinePlayer, RemovalNotice } from '@fmm/shared';

/**
 * Pure presentation helpers for the lobby, profile and game-log pages.
 *
 * Kept separate from the components so they can be unit-tested without a
 * browser, a database, or a clock.
 */

/** Where someone is, as the lobby's online list says it — in the friends list's words. */
export function presenceLabel(player: Pick<OnlinePlayer, 'status' | 'roomId'>): string {
  switch (player.status) {
    case 'queue':
      return 'Looking for a match';
    case 'room':
      return `In room ${player.roomId}`;
    case 'playing':
      return `Playing in ${player.roomId}`;
    case 'watching':
      return `Watching ${player.roomId}`;
    default:
      return 'In the menu';
  }
}

/**
 * Whether this browser should sign out after being removed.
 *
 * Only a banned *account*: "log in again" should mean it. A guest has no
 * session, and calling signOut anyway still broadcasts SIGNED_OUT to every tab
 * of this site — which reloads the other players' tabs on a shared machine.
 */
export function signOutAfterRemoval(notice: RemovalNotice | null, isGuest: boolean): boolean {
  return notice?.kind === 'banned' && !isGuest;
}

/**
 * Adds terminal lines to what the console already shows. The server backfills
 * on every (re)connect, so lines already present are skipped by id.
 */
export function mergeLogLines(current: LogLine[], incoming: LogLine[], limit = 400): LogLine[] {
  const seen = new Set(current.map((line) => line.id));
  const merged = [...current, ...incoming.filter((line) => !seen.has(line.id))].sort(
    (a, b) => a.id - b.id,
  );
  return merged.slice(-limit);
}

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

/**
 * A rating change as the result screen words it: "+14", "−9" (a true minus
 * sign, so it lines up with the plus), or "±0" — a draw between equals moves
 * nobody, and "0" alone reads like missing data.
 */
export function eloChangeText(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return '±0';
}

/** Which colour class a result-screen rating change should render with. */
export function eloChangeTone(delta: number): 'up' | 'down' | 'flat' {
  return deltaTone(delta);
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
