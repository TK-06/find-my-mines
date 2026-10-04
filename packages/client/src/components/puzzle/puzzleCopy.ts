import {
  PUZZLE_PRESETS,
  dailyNumber,
  puzzleCellLabel,
  puzzleClearedPercent,
  type PuzzleCellState,
  type PuzzleLevel,
} from '@fmm/shared';
import type { DailyResult } from '../../data/dailyStore.js';
import { elapsedMs, formatMinutes, formatSeconds, type PuzzleSession } from '../../data/puzzleStore.js';

/** The words puzzle mode shows and says — kept pure so they can be tested without a browser. */

export const PUZZLE_LEVEL_NAMES: Record<PuzzleLevel, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

/** Where the Daily's shared result line points. Fixed, not this page's origin: it is meant to be read elsewhere. */
export const DAILY_SHARE_URL = 'findmymines.app/puzzle';

/** "Daily #5" — or plain "Daily" for a day that has no number (see `dailyNumber`). */
export function dailyLabel(key: string): string {
  const number = dailyNumber(key);
  return number > 0 ? `Daily #${number}` : 'Daily';
}

/** The Daily button's small line: what it is, or — once played — how today's first try went. */
export function dailyButtonNote(result: DailyResult | undefined): string {
  if (result === undefined) return '16×16 · same for everyone';
  return result.won ? `✓ ${formatMinutes(result.ms)}` : '✗';
}

/** What the screen calls the game in play: "Medium", or "Daily #5". */
export function modeName(session: PuzzleSession): string {
  return session.mode === 'daily' ? dailyLabel(session.day ?? '') : PUZZLE_LEVEL_NAMES[session.mode];
}

/** What a screen reader hears on the Daily button, since its symbols read poorly. */
export function dailyButtonLabel(key: string, result: DailyResult | undefined): string {
  const name = dailyLabel(key);
  if (result === undefined) return `${name}, the same board for everyone today`;
  return result.won
    ? `${name}, today’s result: cleared in ${formatMinutes(result.ms)}`
    : `${name}, today’s result: hit a mine`;
}

const hintsText = (hints: number) => `${hints} ${hints === 1 ? 'hint' : 'hints'}`;

/** A day's first try in words: "2:31 · 0 hints", or "63% cleared". */
export function dailyResultSummary(result: DailyResult): string {
  return result.won ? `${formatMinutes(result.ms)} · ${hintsText(result.hints)}` : `${result.cleared}% cleared`;
}

/** Today's row in the Best times card: "✓ 2:31 · 0 hints", "✗ 63% cleared", or that it is still to play. */
export function dailyTodayText(result: DailyResult | undefined): string {
  if (result === undefined) return 'Not played yet';
  return `${result.won ? '✓' : '✗'} ${dailyResultSummary(result)}`;
}

/**
 * The line a player pastes into a chat. It says how it went and nothing about
 * the board — no cells, no mines — so it spoils nothing for anyone who has not
 * played yet.
 */
export function dailyShareText(key: string, result: DailyResult): string {
  const head = `Find My Mines ${dailyLabel(key)} — `;
  const how = result.won ? dailyResultSummary(result) : `💥 ${dailyResultSummary(result)}`;
  return `${head}${how} · ${DAILY_SHARE_URL}`;
}

/** "3 days" */
export function daysText(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** "5 h 12 m", or "42 m" under an hour. Rounded up, so it never says "0 m" with a moment still to go. */
export function countdownText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} m` : `${minutes} m`;
}

/** "30 × 16 · 99 mines": width first, as the classic difficulty menu showed it. */
export function presetSummary(level: PuzzleLevel): string {
  const { rows, cols, mines } = PUZZLE_PRESETS[level];
  return `${cols} × ${rows} · ${mines} mines`;
}

/** What a screen reader hears on a cell: "C4, covered", "C4, flagged", "C4, 3 mines around". */
export function cellAriaLabel(state: PuzzleCellState, where: string, adjacent: number, hinted: boolean): string {
  switch (state) {
    case 'covered':
      return `${where}, covered${hinted ? ', hinted' : ''}`;
    case 'flagged':
      return `${where}, flagged${hinted ? ', hinted' : ''}`;
    case 'open':
      if (adjacent === 0) return `${where}, no mines around`;
      return `${where}, ${adjacent} ${adjacent === 1 ? 'mine' : 'mines'} around`;
    case 'mine':
      return `${where}, mine`;
    case 'exploded':
      return `${where}, mine, exploded`;
    case 'wrong-flag':
      return `${where}, flagged, not a mine`;
  }
}

/** The counter, in words: the digits alone read badly ("zero one zero"). */
export function minesLeftLabel(left: number): string {
  if (left < 0) return `${-left} more ${left === -1 ? 'flag' : 'flags'} than mines`;
  return `${left} ${left === 1 ? 'mine' : 'mines'} left`;
}

/** The mine that ended a lost game: "C4". */
function explodedCell(session: PuzzleSession): string {
  const { game } = session;
  const index = game.exploded[0] ?? 0;
  return puzzleCellLabel({ row: Math.floor(index / game.cols), col: index % game.cols });
}

/**
 * The Daily's version of the line under the board. The first try of the day is
 * the result; any game after it is practice and says so, every time, so nobody
 * mistakes one for the other.
 */
function dailyResultText(session: PuzzleSession): string | null {
  const { game } = session;
  const label = session.day === null ? 'Daily' : dailyLabel(session.day);
  const time = formatMinutes(elapsedMs(session, session.endedAt ?? 0));
  const hints = game.hintsUsed > 0 ? ` with ${hintsText(game.hintsUsed)}` : '';

  if (session.practice) {
    if (game.status === 'lost') return `Practice: boom — ${explodedCell(session)} was a mine. Not recorded.`;
    if (game.status === 'won') return `Practice: cleared in ${time}${hints}. Not recorded.`;
    return 'Practice — the same board as the Daily. It won’t change your result, streak or best time.';
  }
  if (game.status === 'lost') {
    return `Boom — ${explodedCell(session)} was a mine. That is your ${label} result: ${puzzleClearedPercent(game)}% cleared.`;
  }
  if (game.status === 'won') {
    return game.hintsUsed > 0
      ? `${label} cleared in ${time}${hints}. A win with hints keeps your streak but doesn’t set a best time.`
      : `${label} cleared in ${time} with no hints.`;
  }
  // Under way: only before the first click is there anything to say.
  return session.startedAt === null ? `${label}: everyone gets this same opening. The clock starts at your first click.` : null;
}

/** The line under the board: how to start, or how the game ended. Null while it runs. */
export function resultText(session: PuzzleSession): string | null {
  if (session.mode === 'daily') return dailyResultText(session);
  const { game } = session;
  if (game.status === 'ready') return 'Open any cell to start — the first one is always safe.';
  if (game.status === 'playing') return null;

  if (game.status === 'lost') return `Boom — ${explodedCell(session)} was a mine. Start a new game to try again.`;

  const time = formatSeconds(elapsedMs(session, session.endedAt ?? 0));
  if (game.hintsUsed > 0) return `Cleared in ${time} with ${hintsText(game.hintsUsed)}. Games with hints don’t set best times.`;
  const level = PUZZLE_LEVEL_NAMES[session.mode];
  if (session.newBest) return `Cleared in ${time} — a new best on ${level}!`;
  const best = session.best[session.mode];
  return best === undefined
    ? `Cleared in ${time}.`
    : `Cleared in ${time}. Your best on ${level} is ${formatSeconds(best)}.`;
}
