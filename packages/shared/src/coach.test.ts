import { describe, expect, it } from 'vitest';
import {
  COACH_QUESTION_MAX,
  cleanQuestion,
  mentionedCells,
  mentionedMoves,
  parseCellLabel,
} from './coach.js';

describe('cleanQuestion', () => {
  it('passes a plain question through', () => {
    expect(cleanQuestion('Where did the game turn?')).toEqual({ ok: true, text: 'Where did the game turn?' });
  });

  it('turns control characters and line breaks into single spaces, and trims', () => {
    expect(cleanQuestion('  why\n\nmove\t9\u0007 ?  ')).toEqual({ ok: true, text: 'why move 9 ?' });
  });

  it('refuses nothing-but-whitespace, empty and non-text', () => {
    for (const raw of ['', '   ', '\n\t', undefined, null, 7, {}, ['why']]) {
      expect(cleanQuestion(raw)).toEqual({ ok: false, error: 'Type a question first.' });
    }
  });

  it('allows exactly the limit and refuses one character more, rather than cutting it', () => {
    expect(cleanQuestion('a'.repeat(COACH_QUESTION_MAX)).ok).toBe(true);
    const long = cleanQuestion('a'.repeat(COACH_QUESTION_MAX + 1));
    expect(long.ok).toBe(false);
    expect(long.ok === false && long.error).toContain(String(COACH_QUESTION_MAX));
    expect(cleanQuestion('a'.repeat(5000)).ok).toBe(false);
    // A huge one is refused without being read through.
    const huge = cleanQuestion('a'.repeat(2_000_000));
    expect(huge.ok === false && huge.error).toContain(String(COACH_QUESTION_MAX));
  });

  it('counts an emoji as one character', () => {
    expect(cleanQuestion('💣'.repeat(COACH_QUESTION_MAX)).ok).toBe(true);
    expect(cleanQuestion('💣'.repeat(COACH_QUESTION_MAX + 1)).ok).toBe(false);
  });
});

describe('mentionedMoves', () => {
  it('finds "move N"', () => {
    expect(mentionedMoves('You missed a sure mine on move 9.')).toEqual([9]);
    expect(mentionedMoves('Move 12 and later move 3')).toEqual([12, 3]);
  });

  it('finds lists and ranges after "moves"', () => {
    expect(mentionedMoves('moves 4 to 7 were a streak')).toEqual([4, 7]);
    expect(mentionedMoves('moves 4, 5 and 7')).toEqual([4, 5, 7]);
    expect(mentionedMoves('Moves 3-5')).toEqual([3, 5]);
  });

  it('allows a hash', () => {
    expect(mentionedMoves('see move #14')).toEqual([14]);
  });

  it('ignores numbers that are not moves', () => {
    expect(mentionedMoves('C2 had 40% and there are 11 mines')).toEqual([]);
    expect(mentionedMoves('movement 9')).toEqual([]);
  });
});

describe('mentionedCells and parseCellLabel', () => {
  it('finds labels as the rulers write them', () => {
    expect(mentionedCells('C2 was sure, but F1 had 40%; AD16 too')).toEqual(['C2', 'F1', 'AD16']);
  });

  it('does not take ordinary words or numbers for a cell', () => {
    expect(mentionedCells('Ann scored 11 of 100 percent')).toEqual([]);
  });

  it('reads a label back to its cell on a board of that size', () => {
    expect(parseCellLabel('A1', 6, 6)).toBe(0);
    expect(parseCellLabel('F6', 6, 6)).toBe(35);
    expect(parseCellLabel('c2', 6, 6)).toBe(1 * 6 + 2);
    expect(parseCellLabel('AB2', 2, 30)).toBe(1 * 30 + 27);
  });

  it('refuses a label the board has no cell for', () => {
    expect(parseCellLabel('G1', 6, 6)).toBeNull(); // column past the edge
    expect(parseCellLabel('A7', 6, 6)).toBeNull(); // row past the edge
    expect(parseCellLabel('A0', 6, 6)).toBeNull();
    expect(parseCellLabel('1A', 6, 6)).toBeNull();
    expect(parseCellLabel('', 6, 6)).toBeNull();
    expect(parseCellLabel('ABC1', 6, 6)).toBeNull();
  });
});
