import { describe, expect, it } from 'vitest';
import { createRng } from './rng.js';
import {
  PUZZLE_HINTS_PER_GAME,
  PUZZLE_LEVELS,
  PUZZLE_PRESETS,
  countsForBest,
  describePuzzleHint,
  flagPuzzleCell,
  isPuzzleLevel,
  newPuzzle,
  playPuzzleCell,
  puzzleCellLabel,
  puzzleCellState,
  puzzleFromMines,
  puzzleHint,
  puzzleMinesLeft,
  puzzleView,
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
