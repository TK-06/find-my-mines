import { describe, expect, it } from 'vitest';
import { describeHint, hintFor } from './ai.js';
import { createRng, randomInt } from './engine/rng.js';
import {
  describePuzzleHint,
  flagPuzzleCell,
  newPuzzle,
  playPuzzleCell,
  puzzleCellLabel,
  puzzleFromMines,
  puzzleHint,
  puzzleView,
  type PuzzleGame,
} from './engine/puzzle.js';
import { mineProbabilities, type SolverCell, type SolverView } from './engine/solver.js';
import { describeHintReason, explainHint, type HintReason } from './hintWhy.js';

/**
 * A board drawn in text, so each case reads like the board it is about. Cells
 * are separated by spaces:
 *   o  an open number (its digit is worked out from the mines around it)
 *   .  a covered cell with no mine
 *   M  a covered cell with a mine
 *   *  a mine somebody already found (revealed — a multiplayer match shows them)
 * The view carries only what a player sees; the layout is kept for the tests
 * that check a claim against where the mines really are.
 */
function scene(art: string[]) {
  const layout = art.map((line) => line.trim().split(/\s+/));
  const rows = layout.length;
  const cols = layout[0]!.length;
  const isMine = (r: number, c: number) => layout[r]?.[c] === 'M' || layout[r]?.[c] === '*';
  const revealed: SolverCell[] = [];
  let mineCount = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isMine(r, c)) mineCount++;
      if (layout[r]![c] === '*') revealed.push({ row: r, col: c, kind: 'bomb', adjacent: 0 });
      if (layout[r]![c] === 'o') {
        let adjacent = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) if ((dr !== 0 || dc !== 0) && isMine(r + dr, c + dc)) adjacent++;
        }
        revealed.push({ row: r, col: c, kind: 'empty', adjacent });
      }
    }
  }
  const view: SolverView = { rows, cols, mineCount, revealed };
  return { view, grid: mineProbabilities(view), layout };
}

/** Explains the cell at (row, col) of a drawn board. */
function explain(
  art: string[],
  row: number,
  col: number,
  goal: 'mine' | 'safe',
  options?: { flagged?: boolean },
) {
  const { view, grid } = scene(art);
  return explainHint(view, grid, { row, col }, goal, options);
}

// Covered row between two open rows: every covered cell is a mine, and the
// corner numbers see only two of them.
const LINE = ['o o o o', 'M M M M', 'o o o o'];
// A strip along the top: the 1s below pin the mines down one by one, but only
// through each other — which is what makes the neighbours' certainty usable.
const STRIP = ['. M . M .', 'o o o o o'];

describe('explainHint — forced by one number (a mine)', () => {
  it('names the number, what it still needs and the cells that can hold it', () => {
    const { reason, text } = explain(LINE, 1, 0, 'mine');
    expect(text).toBe('The 2 at A1 still needs 2 mines and touches only A2 and B2, so both are mines.');
    expect(reason).toEqual({
      goal: 'mine',
      cell: 'A2',
      flagged: false,
      kind: 'forced',
      number: { at: 'A1', value: 2, found: 0, need: 2, covered: 2 },
      cells: ['A2', 'B2'],
      sureMines: [],
      knownSafe: [],
    });
  });

  it('picks the simplest number: the one with the fewest covered neighbours', () => {
    // B2 is touched by the 2 at A1 (two covered neighbours) and the 3 at B1 (three).
    const { reason } = explain(LINE, 1, 1, 'mine');
    expect(reason).toMatchObject({ kind: 'forced', number: { at: 'A1', covered: 2 } });
  });

  it('says "is a mine" when the number has a single slot', () => {
    const { text } = explain(['o o o', 'o M o', 'o o o'], 1, 1, 'mine');
    expect(text).toBe('The 1 at A1 still needs 1 mine and touches only B2, so B2 is a mine.');
  });

  it('counts a mine that is already found toward the number (multiplayer view)', () => {
    // The 2 at A1 touches a found mine at A2, so it needs just one more: B2.
    const { reason, text } = explain(['o o o o', '* M M o', 'o o o o'], 1, 1, 'mine');
    expect(reason).toMatchObject({ kind: 'forced', number: { at: 'A1', value: 2, found: 1, need: 1 }, cells: ['B2'] });
    expect(text).toBe('The 2 at A1 already touches 1 found mine and still needs 1 more, but only B2 is still covered around it, so B2 is a mine.');
  });

  it('says "all N are mines" for three or more', () => {
    const text = describeHintReason({
      goal: 'mine',
      cell: 'C3',
      flagged: false,
      kind: 'forced',
      number: { at: 'B3', value: 3, found: 0, need: 3, covered: 3 },
      cells: ['C2', 'C3', 'C4'],
      sureMines: [],
      knownSafe: [],
    });
    expect(text).toBe('The 3 at B3 still needs 3 mines and touches only C2, C3 and C4, so all 3 are mines.');
  });

  it('leaves out a covered neighbour the numbers have already shown to be safe', () => {
    // A1 is safe (the 1 at A2 is satisfied by B1), so the 1 at A2 can only be holding B1.
    const { reason, text } = explain(STRIP, 0, 1, 'mine');
    expect(reason).toMatchObject({ kind: 'forced', number: { at: 'A2', value: 1, covered: 2 }, cells: ['B1'], knownSafe: ['A1'] });
    expect(text).toBe('The 1 at A2 still needs 1 mine, and with A1 already known to be safe, only B1 can hold it, so B1 is a mine.');
  });
});

describe('explainHint — forced by one number (a safe cell)', () => {
  it('says the number already touches a sure mine, so its other covered neighbours are safe', () => {
    const { reason, text } = explain(STRIP, 0, 2, 'safe');
    expect(reason).toMatchObject({ kind: 'forced', number: { at: 'B2', value: 1 }, cells: ['A1', 'C1'], sureMines: ['B1'] });
    expect(text).toBe('The 1 at B2 already touches a sure mine at B1, so C1 and its other covered neighbour are safe.');
  });

  it('keeps it short when the hinted cell is the number’s only other covered neighbour', () => {
    const { text } = explain(STRIP, 0, 0, 'safe');
    expect(text).toBe('The 1 at A2 already touches a sure mine at B1, so A1 is safe.');
  });

  it('counts found mines (a multiplayer view) toward the number, and names no sure mine when there is none', () => {
    const { reason, text } = explain(['o o o o', '* . . o', 'o o o o'], 1, 1, 'safe');
    expect(reason).toMatchObject({ kind: 'forced', number: { at: 'A1', value: 1, found: 1 }, sureMines: [], cells: ['B2'] });
    expect(text).toBe('The 1 at A1 already touches 1 found mine, so B2 is safe.');
  });

  it('combines found mines and sure mines when both are used up', () => {
    const text = describeHintReason({
      goal: 'safe',
      cell: 'C3',
      flagged: false,
      kind: 'forced',
      number: { at: 'D4', value: 3, found: 1, need: 2, covered: 4 },
      cells: ['C3', 'C4'],
      sureMines: ['D5', 'E5'],
      knownSafe: [],
    });
    expect(text).toBe('The 3 at D4 already touches 1 found mine and sure mines at D5 and E5, so C3 and its other covered neighbour are safe.');
  });
});

describe('explainHint — certain, but only by combining numbers', () => {
  it('names the numbers that touch a safe cell and says every arrangement leaves it empty', () => {
    // Neither 1 can say which of its cells holds the mine, but B2 is the one cell they share.
    const { reason, text } = explain(['M o o .', '. . . M'], 1, 1, 'safe');
    expect(reason.kind).toBe('combined');
    expect(reason).toMatchObject({ numbers: [{ at: 'B1', value: 1 }, { at: 'C1', value: 1 }], more: 0 });
    expect(text).toBe(
      'No single number proves it, but together they do: the 1 at B1 and the 1 at C1 touch B2, and every arrangement of the hidden mines that fits the numbers leaves B2 empty, so it is safe.',
    );
  });

  it('does the same for a mine', () => {
    const { reason, text } = explain(['M o M o', 'M o . .'], 0, 0, 'mine');
    expect(reason.kind).toBe('combined');
    expect(text).toBe(
      'No single number proves it, but together they do: the 3 at B1 and the 3 at B2 touch A1, and every arrangement of the hidden mines that fits the numbers puts a mine at A1.',
    );
  });

  it('is only used when no single number would do', () => {
    // Same board, but the cell the strip’s 1s settle one at a time is "forced", not "combined".
    expect(explain(STRIP, 0, 2, 'safe').reason.kind).toBe('forced');
  });

  it('sums up numbers beyond the first four as "N more"', () => {
    const text = describeHintReason({
      goal: 'mine',
      cell: 'C3',
      flagged: false,
      kind: 'combined',
      numbers: [
        { at: 'B2', value: 2, found: 0, need: 2, covered: 3 },
        { at: 'C2', value: 3, found: 0, need: 3, covered: 4 },
        { at: 'D2', value: 2, found: 0, need: 2, covered: 4 },
        { at: 'B3', value: 1, found: 0, need: 1, covered: 5 },
      ],
      more: 2,
    });
    expect(text).toContain('the 2 at B2, the 3 at C2, the 2 at D2, the 1 at B3 and 2 more touch C3');
  });

  it('words a lone number as one that cannot prove it alone', () => {
    const text = describeHintReason({
      goal: 'mine',
      cell: 'C3',
      flagged: false,
      kind: 'combined',
      numbers: [{ at: 'B2', value: 2, found: 0, need: 2, covered: 3 }],
      more: 0,
    });
    expect(text).toBe('The 2 at B2 cannot prove it alone, but every arrangement of the hidden mines that fits the numbers puts a mine at C3.');
  });
});

describe('explainHint — certain by counting', () => {
  it('says every covered cell is a mine when the hidden mines fill the covered cells', () => {
    const { reason, text } = explain(['M M', 'M M'], 0, 0, 'mine');
    expect(reason).toMatchObject({ kind: 'counted', minesHidden: 4, covered: 4 });
    expect(text).toBe('A1 is a mine: 4 mines still hidden and exactly 4 covered cells, so every covered cell has one.');
  });

  it('says no covered cell hides a mine once every mine is found', () => {
    const { reason, text } = explain(['. . .', '. . .'], 1, 2, 'safe');
    expect(reason).toMatchObject({ kind: 'counted', minesHidden: 0 });
    expect(text).toBe('Every mine is already found, so no covered cell hides one: C2 is safe.');
  });

  it('settles a cell no number touches by counting the hidden mines against the numbers elsewhere', () => {
    // The 1 at A1 claims the only hidden mine, so every cell it cannot reach is empty.
    const safe = explain(['o M . . .', '. . . . .', '. . . . .'], 2, 4, 'safe');
    expect(safe.reason).toMatchObject({ kind: 'counted', minesHidden: 1 });
    expect(safe.text).toBe(
      'No open number touches E3, but counting the 1 mine still hidden against the numbers elsewhere leaves it empty in every arrangement.',
    );
    // And here the hidden mines are exactly enough for the unreached corner, so it must hold two.
    const mine = explain(['o M M', '. . M'], 0, 2, 'mine');
    expect(mine.reason).toMatchObject({ kind: 'counted', minesHidden: 3 });
    expect(mine.text).toBe(
      'No open number touches C1, but counting the 3 mines still hidden against the numbers elsewhere puts one there in every arrangement.',
    );
  });
});

describe('explainHint — likely, not certain', () => {
  it('gives the percent and the number that says the most about the cell', () => {
    const { reason, text } = explain(['M . .', '. o .', '. . .'], 0, 1, 'mine');
    expect(reason).toMatchObject({ kind: 'likely', percent: 13, number: { at: 'B2', value: 1, need: 1, covered: 8 } });
    expect(text).toBe(
      'Not certain. B1 touches the 1 at B2, which still needs 1 mine among its 8 covered slots; counting every way the hidden mines can fit the numbers, B1 is a mine about 13% of the time — the likeliest cell on the board.',
    );
  });

  it('words the safest cell as a risk, and says "the lowest on the board" only when it is', () => {
    const art = ['o M . . .', '. . . . .', '. . . . .', '. . . . M'];
    // A far corner is the lowest risk on the board…
    const lowest = explain(art, 3, 0, 'safe');
    expect(lowest.reason.kind).toBe('untouched');
    expect(lowest.text).toContain('carries about 6% risk, the lowest on the board.');
    // …but a cell the 1 at A1 makes risky is not, and no such claim is made for it.
    const risky = explain(art, 1, 1, 'safe');
    expect(risky.text).toBe(
      'Not certain. B2 touches the 1 at A1, which still needs 1 mine among its 3 covered slots; counting every way the hidden mines can fit the numbers, B2 carries about 33% risk.',
    );
    expect(explain(art, 1, 1, 'mine').text).toContain('about 33% of the time — the likeliest cell on the board.');
    expect(explain(art, 3, 0, 'mine').text).not.toContain('likeliest');
  });

  it('counts found mines toward the number, so the digit is not misread (multiplayer view)', () => {
    // The 2 at B2 touches a found mine at A1: it needs one more, not two.
    const { reason, text } = explain(['* . M', '. o .', '. . .'], 0, 1, 'mine');
    expect(reason).toMatchObject({ kind: 'likely', number: { at: 'B2', value: 2, found: 1, need: 1, covered: 7 } });
    expect(text).toContain('the 2 at B2, which already touches 1 found mine and still needs 1 more among its 7 covered slots');
  });

  it('quotes the touching number whose own odds come closest to the cell’s chance', () => {
    // B1 is touched by the 1 at A1 (one mine among two covered cells), the 1 at A2 (one among four)
    // and the 1 at C2 (one among eight). B1 and B2 are a coin flip between them, as the 1 at A1 says.
    const art = ['o . . . .', 'o M o . .', '. . . . .'];
    for (const goal of ['mine', 'safe'] as const) {
      expect(explain(art, 0, 1, goal).reason).toMatchObject({ kind: 'likely', percent: 50, number: { at: 'A1', covered: 2 }, shifted: false });
    }
  });

  it('says when the rest of the board shifts the number’s own odds, so one mine in three is not read as the whole story', () => {
    // The 1 at C1 has three covered slots, yet B1 is a mine 60% of the time: the other numbers see to that.
    const { reason, text } = explain(['. M o', '. . .', '. o M'], 0, 1, 'mine');
    expect(reason).toMatchObject({ kind: 'likely', percent: 60, number: { at: 'C1', value: 1, covered: 3 }, shifted: true, extreme: true });
    expect(text).toBe(
      'Not certain. B1 touches the 1 at C1, which still needs 1 mine among its 3 covered slots, but the rest of the board shifts that; counting every way the hidden mines can fit the numbers, B1 is a mine about 60% of the time — the likeliest cell on the board.',
    );
    // Where the number's own odds are the chance, nothing is said about a shift.
    expect(explain(['M . .', '. o .', '. . .'], 0, 1, 'mine').text).not.toContain('shifts');
  });

  it('keeps the percent between 1 and 99 and says "about"', () => {
    const { reason, text } = explain(['M . .', '. o .', '. . .'], 1, 0, 'safe');
    if (reason.kind !== 'likely') throw new Error('expected a likely cell');
    expect(reason.percent).toBeGreaterThanOrEqual(1);
    expect(reason.percent).toBeLessThanOrEqual(99);
    expect(text).toMatch(/about \d+%/);
  });
});

describe('explainHint — untouched by any number', () => {
  it('says nothing pins it down, with the hidden mines and the slots no number reaches', () => {
    const { reason, text } = explain(['o M . . .', '. . . . .', '. . . . .', '. . . . M'], 0, 3, 'mine');
    expect(reason).toMatchObject({ kind: 'untouched', percent: 6, minesHidden: 2, unreached: 16, extreme: false });
    expect(text).toBe(
      "No open number touches D1, so nothing pins it down. With 2 mines still hidden and 16 covered slots out of every number's reach, D1 is a mine about 6% of the time.",
    );
  });

  it('does not count a found mine as a number that reaches a cell', () => {
    // The only thing beside A2 is a found mine, which says nothing about it.
    const { reason } = explain(['* . .', '. . .', '. . M'], 1, 0, 'safe');
    expect(reason.kind).toBe('untouched');
    expect(reason).toMatchObject({ minesHidden: 1, unreached: 8 });
  });
});

describe("explainHint — Puzzle's flagged hint", () => {
  it('ends by saying the flag is wrong when the cell is certainly safe', () => {
    const { reason, text } = explain(STRIP, 0, 0, 'safe', { flagged: true });
    expect(reason.flagged).toBe(true);
    expect(text).toBe('The 1 at A2 already touches a sure mine at B1, so A1 is safe. The flag on A1 is wrong, so take it off.');
  });

  it('says one flag has to be wrong, and this is the likeliest, when the cell is not certain', () => {
    const { text } = explain(['M . .', '. o .', '. . .'], 1, 0, 'safe', { flagged: true });
    expect(text.endsWith('One of your flags has to be wrong, and the one on A2 is the likeliest.')).toBe(true);
  });

  it('is plain text again once the flag is taken off', () => {
    const { reason } = explain(STRIP, 0, 0, 'safe', { flagged: true });
    expect(describeHintReason({ ...reason, flagged: false })).toBe('The 1 at A2 already touches a sure mine at B1, so A1 is safe.');
  });

  it('is ignored for a hint at a mine, where no flag is in the way', () => {
    const { reason, text } = explain(LINE, 1, 0, 'mine', { flagged: true });
    expect(reason.flagged).toBe(false);
    expect(text).not.toContain('flag');
  });
});

describe('explainHint — labels and odd input', () => {
  it('names columns past Z the way Hard’s 30-wide board does', () => {
    // Two rows of 30. The last two cells of the top row are covered mines (AC1 and AD1); everything else is open.
    const top = Array.from({ length: 30 }, (_, c) => (c >= 28 ? 'M' : 'o'));
    const bottom = Array.from({ length: 30 }, () => 'o');
    const { view, grid } = scene([top.join(' '), bottom.join(' ')]);
    const { reason, text } = explainHint(view, grid, { row: 0, col: 28 }, 'mine');
    expect(reason).toMatchObject({ cell: 'AC1', kind: 'forced', number: { at: 'AB1' }, cells: ['AC1'] });
    expect(text).toBe('The 1 at AB1 still needs 1 mine and touches only AC1, so AC1 is a mine.');
    expect(explainHint(view, grid, { row: 0, col: 29 }, 'mine').reason.cell).toBe('AD1');
    expect(puzzleCellLabel({ row: 0, col: 26 })).toBe('AA1');
  });

  it('never throws, and gives a cell with no chance the plain odds of a covered cell', () => {
    const { view, grid } = scene(['o M . .', '. . . .']);
    expect(() => explainHint(view, grid, { row: 0, col: 0 }, 'mine')).not.toThrow(); // an open cell
    expect(() => explainHint(view, grid, { row: 9, col: 9 }, 'safe')).not.toThrow(); // off the board
    expect(() => explainHint(view, [], { row: 0, col: 1 }, 'mine')).not.toThrow(); // no grid at all
    expect(() => explainHint({ rows: 0, cols: 0, mineCount: 0, revealed: [] }, [], { row: 0, col: 0 }, 'mine')).not.toThrow();
    const { reason } = explainHint(view, grid, { row: 9, col: 9 }, 'safe');
    expect(reason.kind).toBe('untouched');
  });

  it('gives facts that survive being sent as JSON, and the same text from them', () => {
    const { reason, text } = explain(LINE, 1, 0, 'mine');
    const sent = JSON.parse(JSON.stringify(reason)) as HintReason;
    expect(sent).toEqual(reason);
    expect(describeHintReason(sent)).toBe(text);
  });

  it('keeps every sentence short enough to read at a glance', () => {
    for (const art of [LINE, STRIP, ['M . .', '. o .', '. . .'], ['o M . . .', '. . . . .', '. . . . M']]) {
      const { view, grid } = scene(art);
      for (let row = 0; row < view.rows; row++) {
        for (let col = 0; col < view.cols; col++) {
          if (grid[row]![col] === null) continue;
          for (const goal of ['mine', 'safe'] as const) {
            expect(explainHint(view, grid, { row, col }, goal).text.length).toBeLessThanOrEqual(330);
          }
        }
      }
    }
  });
});

/* ── the text must agree with the hint sentence, and with the real board ── */

/** "about 64%" or "about 12% risk" → 64 / 12, from either hint sentence or explanation. */
function percentIn(text: string): number | null {
  const match = /about (\d+)%/.exec(text);
  return match ? Number(match[1]) : null;
}

/** The (row, col) a label such as "AD16" names. */
function cellOf(label: string): { row: number; col: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(label);
  if (!match) throw new Error(`not a label: ${label}`);
  let col = 0;
  for (const letter of match[1]!) col = col * 26 + (letter.charCodeAt(0) - 64);
  return { row: Number(match[2]) - 1, col: col - 1 };
}

describe('explainHint — against the Puzzle hint and the real mines', () => {
  /** A game part-way through: a first click, then random clicks, with the odd flag. */
  function midGame(seed: number, rows = 9, cols = 9, mines = 10): PuzzleGame {
    const rng = createRng(seed);
    let game = newPuzzle({ rows, cols, mines });
    game = playPuzzleCell(game, randomInt(rng, rows), randomInt(rng, cols), rng);
    for (let step = 0, limit = 1 + randomInt(rng, 12); step < limit && game.status === 'playing'; step++) {
      const covered = game.open.map((open, index) => (open ? -1 : index)).filter((index) => index >= 0);
      const pick = covered[randomInt(rng, covered.length)]!;
      const row = Math.floor(pick / game.cols);
      const col = pick % game.cols;
      // Mostly open cells the mines are not on, as a player would, so games last.
      if (game.mines[pick]) game = flagPuzzleCell(game, row, col);
      else game = playPuzzleCell(game, row, col, rng);
      if (rng() < 0.15) game = flagPuzzleCell(game, randomInt(rng, rows), randomInt(rng, cols));
    }
    return game;
  }

  it('agrees with describePuzzleHint, and its claims are true of the real board', () => {
    let checked = 0;
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 250; seed++) {
      const game = midGame(seed);
      const hint = puzzleHint(game);
      if (!hint) continue;
      checked++;
      const view = puzzleView(game);
      const grid = mineProbabilities(view);
      const { reason, text } = explainHint(view, grid, hint, 'safe', { flagged: hint.flagged });
      kinds.add(reason.kind);
      const sentence = describePuzzleHint(hint);

      expect(reason.cell).toBe(puzzleCellLabel(hint));
      expect(text).toContain(puzzleCellLabel(hint));
      if (hint.probability <= 0) {
        // "safe for sure": the explanation must prove it, and the cell really is safe.
        expect(['forced', 'combined', 'counted']).toContain(reason.kind);
        expect(text).not.toContain('Not certain');
        expect(game.mines[hint.row * game.cols + hint.col]).toBe(false);
        if (reason.kind === 'forced') {
          for (const label of reason.cells) {
            const { row, col } = cellOf(label);
            expect(game.mines[row * game.cols + col]).toBe(false);
          }
          const at = cellOf(reason.number.at);
          expect(game.open[at.row * game.cols + at.col]).toBe(true);
          expect(game.adjacent[at.row * game.cols + at.col]).toBe(reason.number.value);
        }
      } else if (hint.probability < 1) {
        expect(['likely', 'untouched']).toContain(reason.kind);
        expect(text).toMatch(/Not certain|nothing pins it down/);
        // The same percent as the hint sentence says.
        expect(percentIn(text)).toBe(percentIn(sentence));
      }
      // A flagged hint ends on the flag; an unflagged one never mentions it.
      expect(text.includes('flag')).toBe(hint.flagged);
    }
    expect(checked).toBeGreaterThan(100);
    // The random boards reach the main cases, so the checks above are not vacuous.
    expect(kinds.has('forced')).toBe(true);
    expect(kinds.has('likely') || kinds.has('untouched')).toBe(true);
  });

  it('agrees with describeHint for a mine hint, and every certain mine it names is one', () => {
    let certain = 0;
    let guessed = 0;
    for (let seed = 1; seed <= 250; seed++) {
      // Two sizes, so there are boards with a sure mine to find and boards that need a guess.
      const game = seed % 2 === 0 ? midGame(seed) : midGame(seed, 12, 12, 40);
      if (game.status !== 'playing') continue;
      // The match view of the same board: only what is open, no flags.
      const view = puzzleView(game);
      const grid = mineProbabilities(view);
      const hint = hintFor(grid);
      if (!hint) continue;
      const { reason, text } = explainHint(view, grid, hint, 'mine');
      const sentence = describeHint(hint);

      expect(text).toContain(puzzleCellLabel(hint));
      if (hint.probability >= 1) {
        certain++;
        expect(['forced', 'combined', 'counted']).toContain(reason.kind);
        expect(text).not.toContain('Not certain');
        expect(game.mines[hint.row * game.cols + hint.col]).toBe(true);
        if (reason.kind === 'forced') {
          for (const label of reason.cells) {
            const { row, col } = cellOf(label);
            expect(game.mines[row * game.cols + col]).toBe(true);
          }
          expect(reason.cells).toContain(reason.cell);
          expect(reason.cells).toHaveLength(reason.number.need);
        }
      } else {
        guessed++;
        expect(['likely', 'untouched']).toContain(reason.kind);
        expect(percentIn(text)).toBe(percentIn(sentence));
      }
    }
    expect(certain).toBeGreaterThan(10);
    expect(guessed).toBeGreaterThan(10);
  });

  it('can read a hand-made puzzle through puzzleView, as the Puzzle screen does', () => {
    // A mine at the right of a 3x3, one column of open cells beside it.
    const mines = [false, false, true, false, false, false, false, false, false];
    const base = puzzleFromMines(3, 3, mines);
    const game: PuzzleGame = { ...base, open: base.open.map((_, i) => i % 3 === 0 || i % 3 === 1) };
    const view = puzzleView(game);
    const grid = mineProbabilities(view);
    const hint = puzzleHint(game)!;
    const { text } = explainHint(view, grid, hint, 'safe', { flagged: hint.flagged });
    expect(text).toContain(puzzleCellLabel(hint));
    expect(describePuzzleHint(hint)).toContain(puzzleCellLabel(hint));
  });
});
