import { describe, expect, it } from 'vitest';
import { COACH_BOOK_MAX, COACH_BOOK_TTL_MS, COACH_KEEP_TURNS, CoachBook } from './coachBook.js';

const turn = (n: number) => ({ question: `q${n}`, answer: `a${n}` });

/** Asks and has an answer counted, as a question that went well does. */
function ask(book: CoachBook, person: string, game: string, now: number, n = 0): boolean {
  if (!book.begin(person, game, now)) return false;
  book.finish(person, game, now, turn(n));
  return true;
}

describe('CoachBook', () => {
  it('allows ten questions per person per game', () => {
    const book = new CoachBook();
    expect(book.left('ann', 'g1', 0)).toBe(10);
    for (let i = 0; i < 10; i++) expect(ask(book, 'ann', 'g1', i, i)).toBe(true);
    expect(book.left('ann', 'g1', 11)).toBe(0);
    expect(ask(book, 'ann', 'g1', 12)).toBe(false);
  });

  it('counts each person and each game on its own', () => {
    const book = new CoachBook();
    for (let i = 0; i < 10; i++) ask(book, 'ann', 'g1', i);
    expect(book.left('ben', 'g1', 20)).toBe(10);
    expect(book.left('ann', 'g2', 20)).toBe(10);
    expect(book.left('ann', 'g1', 20)).toBe(0);
  });

  it('spends nothing on a question that failed or gave no usable answer', () => {
    const book = new CoachBook();
    expect(book.begin('ann', 'g1', 0)).toBe(true);
    expect(book.left('ann', 'g1', 1)).toBe(9); // held while it is worked on
    book.finish('ann', 'g1', 2, null);
    expect(book.left('ann', 'g1', 3)).toBe(10);
    expect(book.history('ann', 'g1', 3)).toEqual([]);
  });

  it('holds a place for a question in flight, so two at once cannot both take the last one', () => {
    const book = new CoachBook(1);
    expect(book.begin('ann', 'g1', 0)).toBe(true);
    expect(book.begin('ann', 'g1', 0)).toBe(false);
    book.finish('ann', 'g1', 1, null);
    expect(book.begin('ann', 'g1', 2)).toBe(true);
  });

  it('remembers the last few exchanges, oldest first', () => {
    const book = new CoachBook();
    for (let i = 1; i <= 6; i++) ask(book, 'ann', 'g1', i, i);
    expect(COACH_KEEP_TURNS).toBe(4);
    expect(book.history('ann', 'g1', 10).map((t) => t.question)).toEqual(['q3', 'q4', 'q5', 'q6']);
    expect(book.history('ben', 'g1', 10)).toEqual([]);
  });

  it('forgets a tally half a day after the last question', () => {
    const book = new CoachBook();
    ask(book, 'ann', 'g1', 0);
    expect(book.left('ann', 'g1', COACH_BOOK_TTL_MS)).toBe(9);
    expect(book.left('ann', 'g1', COACH_BOOK_TTL_MS + 1)).toBe(10);
    expect(book.size).toBe(0);
  });

  it('does not forget a question still being worked on', () => {
    const book = new CoachBook(1);
    book.begin('ann', 'g1', 0);
    expect(book.left('ann', 'g1', COACH_BOOK_TTL_MS * 2)).toBe(0);
  });

  it('is bounded: the oldest tallies go when there are too many', () => {
    const book = new CoachBook(10, 4, COACH_BOOK_TTL_MS, 3);
    for (let i = 0; i < 5; i++) ask(book, `p${i}`, 'g', i);
    expect(book.size).toBe(3);
    expect(COACH_BOOK_MAX).toBe(5000);
    // The newest are the ones kept.
    expect(book.left('p4', 'g', 10)).toBe(9);
    expect(book.left('p0', 'g', 10)).toBe(10);
  });

  describe('when a replay is saved as a match', () => {
    it('counts the questions asked before under the match id after: one game', () => {
      const book = new CoachBook();
      for (let i = 0; i < 4; i++) ask(book, 'ann', 'replay-1', i, i);
      book.moveGame('replay-1', 'match-1');
      expect(book.left('ann', 'match-1', 10)).toBe(6);
      expect(book.left('ann', 'replay-1', 10)).toBe(10);
      expect(book.history('ann', 'match-1', 10)).toHaveLength(4);
    });

    it('keeps the larger tally where a person asked under both ids', () => {
      const book = new CoachBook();
      for (let i = 0; i < 3; i++) ask(book, 'ann', 'replay-1', i);
      for (let i = 0; i < 5; i++) ask(book, 'ann', 'match-1', 10 + i);
      book.moveGame('replay-1', 'match-1');
      expect(book.left('ann', 'match-1', 20)).toBe(5);
    });

    it('moves everyone’s tallies, not only one person’s, and leaves other games alone', () => {
      const book = new CoachBook();
      ask(book, 'ann', 'replay-1', 0);
      ask(book, 'ben', 'replay-1', 0);
      ask(book, 'ann', 'other', 0);
      book.moveGame('replay-1', 'match-1');
      expect(book.left('ann', 'match-1', 1)).toBe(9);
      expect(book.left('ben', 'match-1', 1)).toBe(9);
      expect(book.left('ann', 'other', 1)).toBe(9);
    });

    it('carries a question in flight across, so finishing it under the new id counts', () => {
      const book = new CoachBook(1);
      book.begin('ann', 'replay-1', 0);
      book.moveGame('replay-1', 'match-1');
      expect(book.begin('ann', 'match-1', 1)).toBe(false);
      book.finish('ann', 'match-1', 2, turn(1));
      expect(book.left('ann', 'match-1', 3)).toBe(0);
    });

    it('does nothing when the two ids are the same', () => {
      const book = new CoachBook();
      ask(book, 'ann', 'g', 0);
      book.moveGame('g', 'g');
      expect(book.left('ann', 'g', 1)).toBe(9);
    });
  });
});
