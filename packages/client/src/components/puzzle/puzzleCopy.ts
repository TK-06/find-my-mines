import { PUZZLE_PRESETS, puzzleCellLabel, type PuzzleCellState, type PuzzleLevel } from '@fmm/shared';
import { elapsedMs, formatSeconds, type PuzzleSession } from '../../data/puzzleStore.js';

/** The words puzzle mode shows and says — kept pure so they can be tested without a browser. */

export const PUZZLE_LEVEL_NAMES: Record<PuzzleLevel, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

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

/** The line under the board: how to start, or how the game ended. Null while it runs. */
export function resultText(session: PuzzleSession): string | null {
  const { game } = session;
  if (game.status === 'ready') return 'Open any cell to start — the first one is always safe.';
  if (game.status === 'playing') return null;

  if (game.status === 'lost') {
    const index = game.exploded[0] ?? 0;
    const cell = puzzleCellLabel({ row: Math.floor(index / game.cols), col: index % game.cols });
    return `Boom — ${cell} was a mine. Start a new game to try again.`;
  }

  const time = formatSeconds(elapsedMs(session, session.endedAt ?? 0));
  if (game.hintsUsed > 0) {
    const hints = `${game.hintsUsed} ${game.hintsUsed === 1 ? 'hint' : 'hints'}`;
    return `Cleared in ${time} with ${hints}. Games with hints don’t set best times.`;
  }
  const level = PUZZLE_LEVEL_NAMES[session.level];
  if (session.newBest) return `Cleared in ${time} — a new best on ${level}!`;
  const best = session.best[session.level];
  return best === undefined
    ? `Cleared in ${time}.`
    : `Cleared in ${time}. Your best on ${level} is ${formatSeconds(best)}.`;
}
