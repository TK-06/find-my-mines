import { puzzleFromMines, type PuzzleGame } from '@fmm/shared';
import { describe, expect, it } from 'vitest';
import { startSession, type PuzzleSession } from '../../data/puzzleStore.js';
import { cellAriaLabel, minesLeftLabel, presetSummary, resultText } from './puzzleCopy.js';

function session(game: Partial<PuzzleGame>, extra: Partial<PuzzleSession> = {}): PuzzleSession {
  const base = puzzleFromMines(3, 3, [true, false, false, false, false, false, false, false, false]);
  return { ...startSession('easy', {}), game: { ...base, ...game }, startedAt: 1000, endedAt: 42_300, ...extra };
}

describe('cellAriaLabel', () => {
  it('says where the cell is and what it shows', () => {
    expect(cellAriaLabel('covered', 'C4', 0, false)).toBe('C4, covered');
    expect(cellAriaLabel('covered', 'C4', 0, true)).toBe('C4, covered, hinted');
    expect(cellAriaLabel('flagged', 'C4', 0, false)).toBe('C4, flagged');
    expect(cellAriaLabel('open', 'C4', 3, false)).toBe('C4, 3 mines around');
    expect(cellAriaLabel('open', 'C4', 1, false)).toBe('C4, 1 mine around');
    expect(cellAriaLabel('open', 'C4', 0, false)).toBe('C4, no mines around');
  });

  it('names the mines, the one that went off and any wrong flag after a loss', () => {
    expect(cellAriaLabel('mine', 'B2', 0, false)).toBe('B2, mine');
    expect(cellAriaLabel('exploded', 'B2', 0, false)).toBe('B2, mine, exploded');
    expect(cellAriaLabel('wrong-flag', 'B2', 0, false)).toBe('B2, flagged, not a mine');
  });
});

describe('presetSummary', () => {
  it('gives the size as width × height, as the classic menus did', () => {
    expect(presetSummary('easy')).toBe('9 × 9 · 10 mines');
    expect(presetSummary('hard')).toBe('30 × 16 · 99 mines');
  });
});

describe('minesLeftLabel', () => {
  it('reads naturally, including too many flags', () => {
    expect(minesLeftLabel(10)).toBe('10 mines left');
    expect(minesLeftLabel(1)).toBe('1 mine left');
    expect(minesLeftLabel(0)).toBe('0 mines left');
    expect(minesLeftLabel(-2)).toBe('2 more flags than mines');
    expect(minesLeftLabel(-1)).toBe('1 more flag than mines');
  });
});

describe('resultText', () => {
  it('invites the first click', () => {
    expect(resultText(startSession('easy', {}))).toBe('Open any cell to start — the first one is always safe.');
  });

  it('says nothing while the game runs', () => {
    expect(resultText(session({ status: 'playing' }, { endedAt: null }))).toBeNull();
  });

  it('names the mine that ended the game', () => {
    expect(resultText(session({ status: 'lost', exploded: [4] }))).toBe(
      'Boom — B2 was a mine. Start a new game to try again.',
    );
  });

  it('celebrates a new best', () => {
    expect(resultText(session({ status: 'won' }, { newBest: true, best: { easy: 41_300 } }))).toBe(
      'Cleared in 41.3 s — a new best on Easy!',
    );
  });

  it('compares with the best otherwise', () => {
    expect(resultText(session({ status: 'won' }, { best: { easy: 38_000 } }))).toBe(
      'Cleared in 41.3 s. Your best on Easy is 38.0 s.',
    );
  });

  it('marks a win that used hints', () => {
    expect(resultText(session({ status: 'won', hintsUsed: 2 }, { best: { easy: 38_000 } }))).toBe(
      'Cleared in 41.3 s with 2 hints. Games with hints don’t set best times.',
    );
    expect(resultText(session({ status: 'won', hintsUsed: 1 }))).toBe(
      'Cleared in 41.3 s with 1 hint. Games with hints don’t set best times.',
    );
  });
});
