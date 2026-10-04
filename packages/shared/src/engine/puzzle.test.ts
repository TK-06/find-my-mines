import { describe, expect, it } from 'vitest';
import { createRng } from './rng.js';
import {
  DAILY_FIRST_KEY,
  DAILY_PRESET,
  PUZZLE_HINTS_PER_GAME,
  PUZZLE_LEVELS,
  PUZZLE_PRESETS,
  countsForBest,
  dailyKey,
  dailyNumber,
  dailyOpening,
  dailyPuzzle,
  dailySeed,
  describePuzzleHint,
  flagPuzzleCell,
  isDailyKey,
  isPuzzleLevel,
  msUntilNextDaily,
  newPuzzle,
  playPuzzleCell,
  puzzleCellLabel,
  puzzleCellState,
  puzzleClearedPercent,
  puzzleFromMines,
  puzzleHint,
  puzzleMinesLeft,
  puzzleView,
  shiftDailyKey,
  takePuzzleHint,
  type PuzzleGame,
} from './puzzle.js';

/** A game already under way, from an ASCII map: '*' is a mine, '.' is safe. */
function fromMap(map: string[]): PuzzleGame {
  const mines = map.flatMap((line) => [...line].map((ch) => ch === '*'));
  return puzzleFromMines(map.length, map[0]!.length, mines);
}

/** The open cells as a map: 'o' open, '.' covered, 'F' flagged. Easy to eyeball in a failure. */
function picture(game: PuzzleGame): string[] {
  return Array.from({ length: game.rows }, (_, row) =>
    Array.from({ length: game.cols }, (__, col) => {
      const index = row * game.cols + col;
      return game.open[index] ? 'o' : game.flagged[index] ? 'F' : '.';
    }).join(''),
  );
}

/** Opens cells directly, without flood fill, to set up a view for the hint. */
function withOpen(game: PuzzleGame, cells: [number, number][]): PuzzleGame {
  const open = [...game.open];
  for (const [row, col] of cells) open[row * game.cols + col] = true;
  return { ...game, open };
}

const count = (cells: readonly boolean[]) => cells.filter(Boolean).length;

describe('presets', () => {
  it('are the classic three: 9×9/10, 16×16/40, 30 wide by 16 tall/99', () => {
    expect(PUZZLE_LEVELS).toEqual(['easy', 'medium', 'hard']);
    expect(PUZZLE_PRESETS.easy).toEqual({ rows: 9, cols: 9, mines: 10 });
    expect(PUZZLE_PRESETS.medium).toEqual({ rows: 16, cols: 16, mines: 40 });
    expect(PUZZLE_PRESETS.hard).toEqual({ rows: 16, cols: 30, mines: 99 });
  });

  it('recognises only real levels', () => {
    expect(isPuzzleLevel('hard')).toBe(true);
    expect(isPuzzleLevel('fly')).toBe(false);
    expect(isPuzzleLevel(3)).toBe(false);
  });
});

describe('newPuzzle', () => {
  it('starts with no mines laid and nothing open', () => {
    const game = newPuzzle(PUZZLE_PRESETS.easy);
    expect(game.status).toBe('ready');
    expect(count(game.mines)).toBe(0);
    expect(count(game.open)).toBe(0);
    expect(puzzleMinesLeft(game)).toBe(10);
    expect(game.hintsUsed).toBe(0);
  });
});

describe('first click', () => {
  const spots = (rows: number, cols: number): [number, number][] => [
    [0, 0],
    [0, cols - 1],
    [rows - 1, 0],
    [rows - 1, cols - 1],
    [0, Math.floor(cols / 2)],
    [Math.floor(rows / 2), Math.floor(cols / 2)],
  ];

  it('lays exactly the mine count, never on the clicked cell or its neighbours', () => {
    for (const level of PUZZLE_LEVELS) {
      const preset = PUZZLE_PRESETS[level];
      for (const [row, col] of spots(preset.rows, preset.cols)) {
        for (let seed = 1; seed <= 25; seed++) {
          const game = playPuzzleCell(newPuzzle(preset), row, col, createRng(seed));
          expect(count(game.mines)).toBe(preset.mines);
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const r = row + dr;
              const c = col + dc;
              if (r < 0 || r >= preset.rows || c < 0 || c >= preset.cols) continue;
              expect(game.mines[r * preset.cols + c]).toBe(false);
            }
          }
        }
      }
    }
  });

  it('always lands on a 0, so the first click opens a region', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const game = playPuzzleCell(newPuzzle(PUZZLE_PRESETS.hard), 8, 15, createRng(seed));
      expect(game.adjacent[8 * 30 + 15]).toBe(0);
      expect(count(game.open)).toBeGreaterThanOrEqual(9);
      expect(['playing', 'won']).toContain(game.status);
    }
  });

  it('lays a different board for a different seed', () => {
    const a = playPuzzleCell(newPuzzle(PUZZLE_PRESETS.medium), 0, 0, createRng(1));
    const b = playPuzzleCell(newPuzzle(PUZZLE_PRESETS.medium), 0, 0, createRng(2));
    expect(a.mines).not.toEqual(b.mines);
  });

  it('keeps just the clicked cell safe when the board is too crowded to spare its neighbours', () => {
    const game = playPuzzleCell(newPuzzle({ rows: 3, cols: 3, mines: 5 }), 1, 1, createRng(7));
    expect(count(game.mines)).toBe(5);
    expect(game.mines[4]).toBe(false);
    expect(game.open[4]).toBe(true);
  });

  it('never lays more mines than a board can hold beside the first click', () => {
    const game = newPuzzle({ rows: 2, cols: 2, mines: 9 });
    expect(game.mineCount).toBe(3);
  });
});

describe('revealing', () => {
  it('opens the whole region around a 0, stopping at the numbers', () => {
    const game = playPuzzleCell(fromMap(['..*..', '..*..', '..*..']), 1, 0, createRng(1));
    expect(picture(game)).toEqual(['oo...', 'oo...', 'oo...']);
    expect(game.status).toBe('playing');
  });

  it('opens just the one cell when it is a number', () => {
    const game = playPuzzleCell(fromMap(['..*..', '..*..', '..*..']), 0, 1, createRng(1));
    expect(picture(game)).toEqual(['.o...', '.....', '.....']);
  });

  it('floods a huge board without running out of stack', () => {
    const size = 200;
    const mines = new Array(size * size).fill(false);
    mines[0] = true;
    const game = playPuzzleCell(puzzleFromMines(size, size, mines), size - 1, size - 1, createRng(1));
    expect(count(game.open)).toBe(size * size - 1);
    expect(game.status).toBe('won');
  });

  it('does not open a flagged cell, and the flood goes around it', () => {
    let game = fromMap(['..*..', '..*..', '..*..']);
    game = flagPuzzleCell(game, 0, 0);
    game = playPuzzleCell(game, 2, 0, createRng(1));
    expect(picture(game)).toEqual(['Fo...', 'oo...', 'oo...']);
    expect(playPuzzleCell(game, 0, 0, createRng(1))).toBe(game);
  });

  it('ignores a cell off the board or already open', () => {
    const game = playPuzzleCell(fromMap(['..*..', '..*..', '..*..']), 1, 0, createRng(1));
    expect(playPuzzleCell(game, 1, 0, createRng(1))).toBe(game);
    expect(playPuzzleCell(game, 5, 5, createRng(1))).toBe(game);
    expect(playPuzzleCell(game, -1, 0, createRng(1))).toBe(game);
  });
});

describe('flags', () => {
  it('toggle on a covered cell and count against the mines left', () => {
    let game = fromMap(['*..', '...', '...']);
    game = flagPuzzleCell(game, 2, 2);
    expect(game.flagged[8]).toBe(true);
    expect(puzzleMinesLeft(game)).toBe(0);
    game = flagPuzzleCell(game, 0, 1);
    expect(puzzleMinesLeft(game)).toBe(-1);
    game = flagPuzzleCell(game, 2, 2);
    expect(game.flagged[8]).toBe(false);
    expect(puzzleMinesLeft(game)).toBe(0);
  });

  it('cannot go on an open cell', () => {
    const game = playPuzzleCell(fromMap(['*..', '...', '...']), 1, 1, createRng(1));
    expect(flagPuzzleCell(game, 1, 1)).toBe(game);
  });

  it('can go down before the first click, and do not start the game', () => {
    const game = flagPuzzleCell(newPuzzle(PUZZLE_PRESETS.easy), 0, 0);
    expect(game.flagged[0]).toBe(true);
    expect(game.status).toBe('ready');
  });
});

describe('chording', () => {
  it('opens the other neighbours of a number whose flags match it', () => {
    let game = playPuzzleCell(fromMap(['*...', '....', '....']), 1, 1, createRng(1));
    expect(picture(game)).toEqual(['....', '.o..', '....']);
    game = flagPuzzleCell(game, 0, 0);
    game = playPuzzleCell(game, 1, 1, createRng(1));
    expect(game.status).toBe('won');
  });

  it('does nothing while the flags do not add up to the number', () => {
    const game = playPuzzleCell(fromMap(['*...', '....', '....']), 1, 1, createRng(1));
    expect(playPuzzleCell(game, 1, 1, createRng(1))).toBe(game);
    const twoFlags = flagPuzzleCell(flagPuzzleCell(game, 0, 0), 0, 1);
    expect(playPuzzleCell(twoFlags, 1, 1, createRng(1))).toBe(twoFlags);
  });

  it('sets off the mine when a flag is in the wrong place', () => {
    let game = playPuzzleCell(fromMap(['*...', '....', '....']), 1, 1, createRng(1));
    game = flagPuzzleCell(game, 0, 1);
    game = playPuzzleCell(game, 1, 1, createRng(1));
    expect(game.status).toBe('lost');
    expect(game.exploded).toEqual([0]);
  });
});

describe('the end of a game', () => {
  it('is a win once every safe cell is open, with the mines flagged for you', () => {
    const game = playPuzzleCell(fromMap(['*..', '...', '...']), 2, 2, createRng(1));
    expect(game.status).toBe('won');
    expect(game.flagged).toEqual(game.mines);
    expect(puzzleMinesLeft(game)).toBe(0);
  });

  it('is a loss when a mine is opened', () => {
    const game = playPuzzleCell(fromMap(['*..', '...', '...']), 0, 0, createRng(1));
    expect(game.status).toBe('lost');
    expect(game.exploded).toEqual([0]);
  });

  it('freezes the board: no more opening or flagging', () => {
    const lost = playPuzzleCell(fromMap(['*..', '...', '...']), 0, 0, createRng(1));
    expect(playPuzzleCell(lost, 2, 2, createRng(1))).toBe(lost);
    expect(flagPuzzleCell(lost, 2, 2)).toBe(lost);
    const won = playPuzzleCell(fromMap(['*..', '...', '...']), 2, 2, createRng(1));
    expect(flagPuzzleCell(won, 0, 0)).toBe(won);
  });

  it('shows every mine after a loss, the one that went off, and any wrong flag', () => {
    let game = fromMap(['*.*', '...', '...']);
    game = flagPuzzleCell(game, 0, 2); // right
    game = flagPuzzleCell(game, 2, 2); // wrong
    game = playPuzzleCell(game, 0, 0, createRng(1));
    expect(puzzleCellState(game, 0)).toBe('exploded');
    expect(puzzleCellState(game, 2)).toBe('flagged');
    expect(puzzleCellState(game, 8)).toBe('wrong-flag');
    expect(puzzleCellState(game, 4)).toBe('covered');
  });

  it('keeps the mines hidden while the game is on', () => {
    let game = fromMap(['*.*', '...', '...']);
    game = flagPuzzleCell(game, 2, 2);
    expect(puzzleCellState(game, 0)).toBe('covered');
    expect(puzzleCellState(game, 8)).toBe('flagged');
    game = playPuzzleCell(game, 2, 0, createRng(1));
    expect(puzzleCellState(game, 6)).toBe('open');
    const lost = playPuzzleCell(fromMap(['*.*', '...', '...']), 0, 0, createRng(1));
    expect(puzzleCellState(lost, 2)).toBe('mine');
  });
});

describe('puzzleView', () => {
  it('holds only what is on screen: open cells and their numbers, never flags or mines', () => {
    let game = playPuzzleCell(fromMap(['..*..', '..*..', '..*..']), 0, 1, createRng(1));
    game = flagPuzzleCell(game, 0, 2);
    expect(puzzleView(game)).toEqual({
      rows: 3,
      cols: 5,
      mineCount: 3,
      revealed: [{ row: 0, col: 1, kind: 'empty', adjacent: 2 }],
    });
  });
});

describe('hints', () => {
  it('picks a cell the numbers prove safe', () => {
    // B1 is open and shows 0, so A1 and C1 are safe for sure; the one mine is D1.
    const game = withOpen(puzzleFromMines(1, 4, [false, false, false, true]), [[0, 1]]);
    expect(puzzleHint(game)).toEqual({ row: 0, col: 0, probability: 0, flagged: false });
  });

  it('prefers an untouched cell over a risky one beside a number', () => {
    // B1 shows 1: the mine is A1 or C1, so D1–F1 are safe for sure.
    const game = withOpen(puzzleFromMines(1, 6, [true, false, false, false, false, false]), [[0, 1]]);
    expect(puzzleHint(game)).toMatchObject({ row: 0, col: 3, probability: 0 });
  });

  it('picks the lowest chance when nothing is certain', () => {
    // B1 shows 1 (A1 or C1, 50% each); the other mine is somewhere in D1–H1 (20% each).
    const mines = [true, false, false, false, false, false, false, true];
    const hint = puzzleHint(withOpen(puzzleFromMines(1, 8, mines), [[0, 1]]));
    expect(hint).toMatchObject({ row: 0, col: 3, flagged: false });
    expect(hint!.probability).toBeCloseTo(0.2, 9);
  });

  it('does not treat flags as facts, and skips flagged cells', () => {
    let game = withOpen(puzzleFromMines(1, 4, [false, false, false, true]), [[0, 1]]);
    game = flagPuzzleCell(game, 0, 0);
    expect(puzzleHint(game)).toMatchObject({ row: 0, col: 2, probability: 0, flagged: false });
  });

  it('points at a wrong flag when every unflagged cell is a certain mine', () => {
    let game = withOpen(puzzleFromMines(1, 4, [false, false, false, true]), [[0, 1]]);
    game = flagPuzzleCell(flagPuzzleCell(game, 0, 0), 0, 2);
    expect(puzzleHint(game)).toEqual({ row: 0, col: 0, probability: 0, flagged: true });
  });

  it('prefers a flagged cell the numbers prove safe over a guess', () => {
    // A1 shows 0, so B1 is safe for sure — but it is flagged. The one mine is
    // somewhere in C1–F1 (25% each), so the honest hint is the flag.
    let game = withOpen(puzzleFromMines(1, 6, [false, false, false, false, true, false]), [[0, 0]]);
    game = flagPuzzleCell(game, 0, 1);
    expect(puzzleHint(game)).toEqual({ row: 0, col: 1, probability: 0, flagged: true });
  });

  it('never points at an open cell, and has nothing to say before the first click', () => {
    const game = playPuzzleCell(newPuzzle(PUZZLE_PRESETS.hard), 5, 5, createRng(3));
    const hint = puzzleHint(game)!;
    expect(game.open[hint.row * game.cols + hint.col]).toBe(false);
    expect(puzzleHint(newPuzzle(PUZZLE_PRESETS.easy))).toBeNull();
  });

  it('are limited per game and counted', () => {
    let game = playPuzzleCell(newPuzzle(PUZZLE_PRESETS.hard), 5, 5, createRng(3));
    for (let i = 1; i <= PUZZLE_HINTS_PER_GAME; i++) {
      const taken = takePuzzleHint(game)!;
      expect(taken).not.toBeNull();
      game = taken.game;
      expect(game.hintsUsed).toBe(i);
    }
    expect(takePuzzleHint(game)).toBeNull();
  });

  it('are not given once the game is over', () => {
    const lost = playPuzzleCell(fromMap(['*..', '...', '...']), 0, 0, createRng(1));
    expect(takePuzzleHint(lost)).toBeNull();
  });

  it('read as a plain sentence', () => {
    expect(describePuzzleHint({ row: 3, col: 2, probability: 0, flagged: false })).toBe('C4 is safe for sure.');
    expect(describePuzzleHint({ row: 3, col: 2, probability: 0.1234, flagged: false })).toBe(
      'No cell is certain — C4 is the safest bet, about 12% risk.',
    );
    expect(describePuzzleHint({ row: 0, col: 0, probability: 0.001, flagged: false })).toBe(
      'No cell is certain — A1 is the safest bet, about 1% risk.',
    );
    expect(describePuzzleHint({ row: 0, col: 0, probability: 0, flagged: true })).toBe(
      'A1 is safe for sure — take your flag off it.',
    );
    expect(describePuzzleHint({ row: 0, col: 0, probability: 0.3, flagged: true })).toBe(
      'No cell is certain — A1 (flagged) is the safest bet, about 30% risk.',
    );
    expect(describePuzzleHint({ row: 0, col: 0, probability: 0.999, flagged: false })).toBe(
      'No cell is certain — A1 is the safest bet, about 99% risk.',
    );
  });
});

describe('best times', () => {
  it('count only games won without a hint', () => {
    const won = playPuzzleCell(fromMap(['*..', '...', '...']), 2, 2, createRng(1));
    expect(countsForBest(won)).toBe(true);
    expect(countsForBest({ ...won, hintsUsed: 1 })).toBe(false);
    const lost = playPuzzleCell(fromMap(['*..', '...', '...']), 0, 0, createRng(1));
    expect(countsForBest(lost)).toBe(false);
  });
});

describe('puzzleCellLabel', () => {
  it('letters columns like a spreadsheet, so the 30-wide board reads past Z', () => {
    expect(puzzleCellLabel({ row: 0, col: 0 })).toBe('A1');
    expect(puzzleCellLabel({ row: 3, col: 2 })).toBe('C4');
    expect(puzzleCellLabel({ row: 15, col: 25 })).toBe('Z16');
    expect(puzzleCellLabel({ row: 0, col: 26 })).toBe('AA1');
    expect(puzzleCellLabel({ row: 15, col: 29 })).toBe('AD16');
  });
});

describe('puzzleClearedPercent', () => {
  it('is the share of safe cells opened, as a whole percent', () => {
    expect(puzzleClearedPercent(fromMap(['..*..', '..*..', '..*..']))).toBe(0);
    // 15 cells, 3 mines: 12 safe, and opening the left side opens 6 of them.
    const half = playPuzzleCell(fromMap(['..*..', '..*..', '..*..']), 1, 0, createRng(1));
    expect(puzzleClearedPercent(half)).toBe(50);
  });

  it('is 100 for a win, and never more than 99 for a loss', () => {
    const won = playPuzzleCell(fromMap(['*..', '...', '...']), 2, 2, createRng(1));
    expect(puzzleClearedPercent(won)).toBe(100);
    // Every safe cell open and a mine set off in the same chord: still a loss.
    const base = fromMap(['*..', '...', '...']);
    const lost: PuzzleGame = { ...base, status: 'lost', exploded: [0], open: base.mines.map((mine) => !mine) };
    expect(puzzleClearedPercent(lost)).toBe(99);
  });
});

describe('dailyKey', () => {
  it('is the Bangkok date: UTC plus seven hours', () => {
    expect(dailyKey(Date.UTC(2026, 9, 4, 12, 0, 0))).toBe('2026-10-04');
    // 02:00 in Bangkok on the 5th is still the 4th in UTC.
    expect(dailyKey(Date.UTC(2026, 9, 4, 19, 0, 0))).toBe('2026-10-05');
  });

  it('turns over at 17:00:00 UTC, not a moment before', () => {
    expect(dailyKey(Date.UTC(2026, 9, 4, 16, 59, 59, 999))).toBe('2026-10-04');
    expect(dailyKey(Date.UTC(2026, 9, 4, 17, 0, 0, 0))).toBe('2026-10-05');
  });

  it('rolls over month and year ends', () => {
    expect(dailyKey(Date.UTC(2026, 11, 31, 17, 0, 0))).toBe('2027-01-01');
    expect(dailyKey(Date.UTC(2028, 1, 28, 17, 0, 0))).toBe('2028-02-29');
    expect(dailyKey(Date.UTC(2026, 9, 30, 17, 0, 0))).toBe('2026-10-31');
  });

  it('reads a time that is not a number as the epoch, rather than throwing', () => {
    expect(dailyKey(0)).toBe('1970-01-01');
    expect(dailyKey(-1)).toBe('1970-01-01');
    expect(dailyKey(Number.NaN)).toBe('1970-01-01');
    expect(dailyKey(Number.POSITIVE_INFINITY)).toBe('1970-01-01');
  });
});

describe('isDailyKey', () => {
  it('accepts real dates written YYYY-MM-DD and nothing else', () => {
    expect(isDailyKey('2026-10-04')).toBe(true);
    expect(isDailyKey('2028-02-29')).toBe(true);
    expect(isDailyKey('2027-02-29')).toBe(false);
    expect(isDailyKey('2026-02-30')).toBe(false);
    expect(isDailyKey('2026-13-01')).toBe(false);
    expect(isDailyKey('2026-10-4')).toBe(false);
    expect(isDailyKey('0050-10-04')).toBe(false);
    expect(isDailyKey('')).toBe(false);
    expect(isDailyKey(20261004)).toBe(false);
    expect(isDailyKey(null)).toBe(false);
  });
});

describe('shiftDailyKey', () => {
  it('moves a date by whole days, across month, year and leap days', () => {
    expect(shiftDailyKey('2026-10-04', 1)).toBe('2026-10-05');
    expect(shiftDailyKey('2026-10-04', -1)).toBe('2026-10-03');
    expect(shiftDailyKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDailyKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDailyKey('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDailyKey('2027-02-28', 1)).toBe('2027-03-01');
    expect(shiftDailyKey('2026-10-04', 0)).toBe('2026-10-04');
    // 365 days back is 2025-10-04, and 35 more reaches the end of August.
    expect(shiftDailyKey('2026-10-04', -400)).toBe('2025-08-30');
  });

  it('gives null for a key that is not a date or a step that is not a whole number', () => {
    expect(shiftDailyKey('nope', 1)).toBeNull();
    expect(shiftDailyKey('2026-10-04', 0.5)).toBeNull();
    expect(shiftDailyKey('2026-10-04', Number.NaN)).toBeNull();
    expect(shiftDailyKey('2026-10-04', 1e12)).toBeNull();
  });
});

describe('dailyNumber', () => {
  it('is 1 on the first day and one more each day after', () => {
    expect(DAILY_FIRST_KEY).toBe('2026-10-04');
    expect(dailyNumber('2026-10-04')).toBe(1);
    expect(dailyNumber('2026-10-05')).toBe(2);
    expect(dailyNumber('2026-11-01')).toBe(29);
    expect(dailyNumber('2027-10-04')).toBe(366);
  });

  it('is 0 — no number — for an invalid key or a day before the first Daily', () => {
    expect(dailyNumber('')).toBe(0);
    expect(dailyNumber('not a date')).toBe(0);
    expect(dailyNumber('2026-02-30')).toBe(0);
    expect(dailyNumber('2026-10-03')).toBe(0);
    expect(dailyNumber('2020-01-01')).toBe(0);
  });

  it('counts the same days as dailyKey, whatever the time of day', () => {
    const noon = Date.UTC(2026, 9, 4, 5, 0, 0);
    for (let day = 0; day < 40; day++) {
      expect(dailyNumber(dailyKey(noon + day * 86_400_000))).toBe(day + 1);
    }
  });
});

describe('msUntilNextDaily', () => {
  it('counts down to the next Bangkok midnight, 17:00 UTC', () => {
    expect(msUntilNextDaily(Date.UTC(2026, 9, 4, 16, 59, 59, 999))).toBe(1);
    expect(msUntilNextDaily(Date.UTC(2026, 9, 4, 12, 0, 0))).toBe(5 * 3_600_000);
  });

  it('is a whole day at the moment the day turns over, never zero', () => {
    expect(msUntilNextDaily(Date.UTC(2026, 9, 4, 17, 0, 0, 0))).toBe(86_400_000);
    expect(msUntilNextDaily(Number.NaN)).toBeGreaterThan(0);
  });
});

describe('dailyPuzzle', () => {
  /** The day keys of the next `days` days from the first Daily. */
  const keys = (days: number) => Array.from({ length: days }, (_, i) => shiftDailyKey('2026-10-04', i)!);
  const minesOf = (game: PuzzleGame) => game.mines.flatMap((mine, index) => (mine ? [index] : []));
  const neighboursOf = (index: number) => {
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = Math.floor(index / 16) + dr;
        const c = (index % 16) + dc;
        if ((dr !== 0 || dc !== 0) && r >= 0 && r < 16 && c >= 0 && c < 16) out.push(r * 16 + c);
      }
    }
    return out;
  };

  it('is a 16 × 16 board with 40 mines, already under way', () => {
    expect(DAILY_PRESET).toEqual({ rows: 16, cols: 16, mines: 40 });
    const game = dailyPuzzle('2026-10-04');
    expect(game.rows).toBe(16);
    expect(game.cols).toBe(16);
    expect(game.mineCount).toBe(40);
    expect(game.status).toBe('playing');
    expect(game.hintsUsed).toBe(0);
    expect(game.exploded).toEqual([]);
    expect(count(game.flagged)).toBe(0);
  });

  it('is the same board every time for the same day', () => {
    expect(dailyPuzzle('2026-10-04')).toEqual(dailyPuzzle('2026-10-04'));
    expect(dailyPuzzle('2027-03-15')).toEqual(dailyPuzzle('2027-03-15'));
  });

  it('is a different board on a different day', () => {
    const boards = keys(120).map((key) => minesOf(dailyPuzzle(key)).join(','));
    expect(new Set(boards).size).toBe(boards.length);
    // And the opening is not stuck in one place either.
    expect(new Set(keys(120).map(dailyOpening)).size).toBeGreaterThan(40);
  });

  it('has exactly 40 mines, none beside the opening, and a number on every cell that fits', () => {
    for (const key of keys(120)) {
      const game = dailyPuzzle(key);
      expect(count(game.mines)).toBe(40);
      const opening = dailyOpening(key);
      for (const index of [opening, ...neighboursOf(opening)]) expect(game.mines[index]).toBe(false);
      game.mines.forEach((_, index) => {
        expect(game.adjacent[index]).toBe(neighboursOf(index).filter((n) => game.mines[n]).length);
      });
    }
  });

  it('opens on a 0 inside the board’s inner ring, with its whole region open', () => {
    for (const key of keys(120)) {
      const game = dailyPuzzle(key);
      const opening = dailyOpening(key);
      const row = Math.floor(opening / 16);
      const col = opening % 16;
      expect(row).toBeGreaterThanOrEqual(1);
      expect(row).toBeLessThanOrEqual(14);
      expect(col).toBeGreaterThanOrEqual(1);
      expect(col).toBeLessThanOrEqual(14);
      expect(game.adjacent[opening]).toBe(0);
      expect(game.open[opening]).toBe(true);
      // Flood fill is finished: every open 0 has all its neighbours open, and no mine is open.
      game.open.forEach((isOpen, index) => {
        if (!isOpen) return;
        expect(game.mines[index]).toBe(false);
        if (game.adjacent[index] === 0) for (const n of neighboursOf(index)) expect(game.open[n]).toBe(true);
      });
      // At least the 3 × 3 around the opening.
      expect(count(game.open)).toBeGreaterThanOrEqual(9);
    }
  });

  it('is never already won or lost', () => {
    for (const key of keys(120)) {
      const game = dailyPuzzle(key);
      expect(game.status).toBe('playing');
      expect(count(game.open)).toBeLessThan(256 - 40);
    }
  });

  it('plays on like any game: the next click opens more, a mine ends it', () => {
    const game = dailyPuzzle('2026-10-04');
    const covered = game.open.findIndex((isOpen, index) => !isOpen && !game.mines[index]);
    const next = playPuzzleCell(game, Math.floor(covered / 16), covered % 16, createRng(1));
    expect(count(next.open)).toBeGreaterThan(count(game.open));
    const mine = game.mines.indexOf(true);
    expect(playPuzzleCell(game, Math.floor(mine / 16), mine % 16, createRng(1)).status).toBe('lost');
  });

  // The seed and the order of random draws are the board. If this fails, the
  // algorithm changed — and every day's board with it. Do not "fix" the numbers;
  // undo the change (see the comment on dailyPuzzle).
  it('lays one known day exactly as it did when it shipped', () => {
    expect(dailySeed('2026-10-04')).toBe(3963088592);
    expect(dailyOpening('2026-10-04')).toBe(215);
    const game = dailyPuzzle('2026-10-04');
    expect(minesOf(game)).toEqual([
      7, 14, 15, 26, 33, 37, 38, 44, 49, 53, 59, 60, 62, 71, 73, 83, 85, 88, 96, 129, 141, 152, 154, 155, 166, 169,
      175, 176, 180, 185, 204, 209, 211, 217, 223, 225, 239, 246, 248, 250,
    ]);
    expect(count(game.open)).toBe(19);
    expect(minesOf(dailyPuzzle('2026-10-05')).slice(0, 8)).toEqual([7, 15, 40, 42, 43, 48, 57, 58]);
  });
});
