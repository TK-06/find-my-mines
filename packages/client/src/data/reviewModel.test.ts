import { parseCellLabel, parseReplay, reviewMatch, type MoveReview, type Review } from '@fmm/shared';
import { describe, expect, it } from 'vitest';
import {
  accuracyLabel,
  boardLine,
  coachChips,
  momentCardText,
  momentShort,
  moveCounter,
  moveDetail,
  moveHeadline,
  movesToShow,
  oddsTint,
  ratingLabel,
  ratingSummary,
  scoreBeforeLabel,
  seatOfMe,
  seatOfProfile,
  seatTones,
  seatWord,
  stepMove,
  teaserOf,
} from './reviewModel.js';

/** 1 x 5, mines A1 and C1: Ann opens B1, Ben passes over both sure mines by opening D1, Ann takes them. */
function sureMines(): Review {
  const at = (label: string) => parseCellLabel(label, 1, 5)!;
  const replay = parseReplay({
    v: 1,
    rows: 1,
    cols: 5,
    mineCount: 2,
    mines: [at('A1'), at('C1')],
    seats: [
      { name: 'Ann', bot: false },
      { name: 'Ben', bot: false },
    ],
    moves: [
      { i: at('B1'), s: 0 },
      { i: at('D1'), s: 1 },
      { i: at('A1'), s: 0 },
      { i: at('C1'), s: 0 },
    ],
  })!;
  return reviewMatch(replay);
}

const REVIEW = sureMines();
const NAMES = ['Ann', 'Ben'];
const move = (n: number): MoveReview => REVIEW.moves[n - 1]!;

describe('seatWord', () => {
  it('says you for your own seat, in capitals at the start of a sentence', () => {
    expect(seatWord(0, NAMES, 0)).toBe('you');
    expect(seatWord(0, NAMES, 0, true)).toBe('You');
  });

  it('says the name for anyone else, and a number for a seat with no name', () => {
    expect(seatWord(1, NAMES, 0)).toBe('Ben');
    expect(seatWord(1, NAMES, null)).toBe('Ben');
    expect(seatWord(4, NAMES, null)).toBe('Player 5');
  });
});

describe('moveHeadline', () => {
  it('says what was opened and that the turn passes', () => {
    expect(moveHeadline(move(1), NAMES, 0)).toBe('You opened B1: an empty slot showing 2, turn passes.');
    expect(moveHeadline(move(2), NAMES, 0)).toBe('Ben opened D1: an empty slot showing 1, turn passes.');
  });

  it('says a mine scored and the turn goes on', () => {
    expect(moveHeadline(move(3), NAMES, 0)).toBe('You opened A1: a mine, point scored, the turn goes on.');
    expect(moveHeadline(move(3), NAMES, null)).toBe('Ann opened A1: a mine, point scored, the turn goes on.');
  });

  it('describes an empty slot with no mines around it', () => {
    const quiet = { ...move(1), adjacent: 0 };
    expect(moveHeadline(quiet, NAMES, null)).toBe('Ann opened B1: an empty slot with no mines next to it, turn passes.');
  });
});

describe('moveDetail', () => {
  it('names the sure mine that was passed over', () => {
    expect(moveDetail(move(2))).toBe('A1 was a sure mine (100%), but D1 had 0%. That point was there for the taking.');
  });

  it('says a first move had the best chance on the board', () => {
    expect(moveDetail(move(1))).toBe('B1 had 40%, the best chance on the board.');
  });

  it('says taking a sure mine could not be beaten', () => {
    expect(moveDetail(move(3))).toBe('A1 was a sure mine (100%): nothing could beat that pick.');
  });

  it('compares a weaker pick with the best chance', () => {
    const risky: MoveReview = { ...move(1), rating: 'risky', pickedOdds: 1 / 3, bestOdds: 0.5, bestLabel: 'B1', label: 'E1', bestCell: 1 };
    expect(moveDetail(risky)).toBe('B1 had the best chance (50%), but E1 had 33%.');
  });

  it('calls a cell the numbers prove safe safe for sure', () => {
    const blunder: MoveReview = { ...move(1), rating: 'blunder', pickedOdds: 0, bestOdds: 2 / 3, bestLabel: 'A1', label: 'C1' };
    expect(moveDetail(blunder)).toBe('C1 was safe for sure (0%), while A1 had 67%.');
  });
});

describe('summaries', () => {
  it('says how many best moves and missed sure mines a seat had, in the singular too', () => {
    expect(ratingSummary(REVIEW.seats[0]!)).toBe('3 best · 0 missed sure mines');
    expect(ratingSummary(REVIEW.seats[1]!)).toBe('0 best · 1 missed sure mine');
  });

  it('shows an accuracy as a whole percent, 100% only when perfect', () => {
    expect(accuracyLabel(100)).toBe('100%');
    expect(accuracyLabel(99.6)).toBe('99%');
    expect(accuracyLabel(93.8)).toBe('94%');
    expect(accuracyLabel(0)).toBe('0%');
    expect(accuracyLabel(null)).toBe('–');
  });

  it('shows everyone’s score before a move', () => {
    expect(scoreBeforeLabel(move(4), NAMES, 0)).toBe('You 1 · Ben 0');
    expect(scoreBeforeLabel(move(4), NAMES, null)).toBe('Ann 1 · Ben 0');
  });

  it('labels ratings and the board', () => {
    expect(ratingLabel('missed')).toBe('Missed a sure mine');
    expect(ratingLabel('best')).toBe('Best');
    expect(boardLine({ rows: 6, cols: 6, mineCount: 11 })).toBe('6×6 · 11 mines');
    expect(moveCounter(9, 24)).toBe('Move 9 of 24');
  });
});

describe('key moments in words', () => {
  const missed = REVIEW.moments.find((m) => m.kind === 'missed-sure')!;

  it('puts a short clause in the popup and the full one on the card', () => {
    expect(momentShort(missed, NAMES, 1)).toBe('you missed a sure mine at A1');
    expect(momentShort(missed, NAMES, 0)).toBe('Ben missed a sure mine at A1');
    expect(momentCardText(missed, NAMES, 1)).toBe('You missed a sure mine at A1 and opened D1 instead (0%).');
  });

  it('uses the whole clause for the other kinds', () => {
    const deciding = REVIEW.moments.find((m) => m.kind === 'deciding')!;
    expect(momentShort(deciding, NAMES, 0)).toContain('you found the mine that decided the game');
  });
});

describe('teaserOf', () => {
  it('gives you your accuracy, your opponent’s, and the first key moment', () => {
    expect(teaserOf(REVIEW, 0)).toEqual({
      yours: '100%',
      opponent: { name: 'Ben', accuracy: '0%' },
      moment: 'Key moment: move 2, Ben missed a sure mine at A1.',
    });
    expect(teaserOf(REVIEW, 1)).toEqual({
      yours: '0%',
      opponent: { name: 'Ann', accuracy: '100%' },
      moment: 'Key moment: move 2, you missed a sure mine at A1.',
    });
  });

  it('gives a spectator the key moment and a comparison, but no accuracy of their own', () => {
    const teaser = teaserOf(REVIEW, null);
    expect(teaser.yours).toBeNull();
    expect(teaser.moment).toBe('Key moment: move 2, Ben missed a sure mine at A1.');
  });

  it('compares with the most accurate of several opponents', () => {
    const crowded: Review = {
      ...REVIEW,
      seats: [
        { ...REVIEW.seats[0]!, accuracy: 80 },
        { ...REVIEW.seats[1]!, name: 'Ben', accuracy: 60 },
        { ...REVIEW.seats[1]!, seat: 2, name: 'Cy', accuracy: 90 },
      ],
    };
    expect(teaserOf(crowded, 0).opponent).toEqual({ name: 'Cy', accuracy: '90%' });
  });

  it('says nothing about a moment when none stood out', () => {
    expect(teaserOf({ ...REVIEW, moments: [] }, 0).moment).toBeNull();
  });

  it('has no opponent to compare with when nobody else moved', () => {
    const alone: Review = { ...REVIEW, seats: [REVIEW.seats[0]!, { ...REVIEW.seats[1]!, accuracy: null }] };
    expect(teaserOf(alone, 0).opponent).toBeNull();
  });
});

describe('seatOfMe', () => {
  const replay = { seats: [{ name: 'Ann', bot: false }, { name: 'AI · Hard', bot: true }] };

  it('is your place in the room when the room’s order is the replay’s', () => {
    const players = [{ id: 'a', nickname: 'Ann' }, { id: 'bot:1', nickname: 'AI · Hard' }];
    expect(seatOfMe(replay, players, 'a')).toBe(0);
    expect(seatOfMe(replay, players, 'bot:1')).toBe(1);
  });

  it('is null for a spectator, who is in no seat', () => {
    expect(seatOfMe(replay, [{ id: 'a', nickname: 'Ann' }, { id: 'bot:1', nickname: 'AI · Hard' }], 's')).toBeNull();
    expect(seatOfMe(replay, [], null)).toBeNull();
  });

  it('falls back on your name when the room no longer lines up (the other player left)', () => {
    expect(seatOfMe(replay, [{ id: 'a', nickname: 'Ann' }], 'a')).toBe(0);
  });

  it('tells two players of the same name apart by their place in the room', () => {
    const twins = { seats: [{ name: 'Sam', bot: false }, { name: 'Sam', bot: false }] };
    const players = [{ id: 'x', nickname: 'Sam' }, { id: 'y', nickname: 'Sam' }];
    expect(seatOfMe(twins, players, 'y')).toBe(1);
  });

  it('is null when the name cannot settle it', () => {
    const twins = { seats: [{ name: 'Sam', bot: false }, { name: 'Sam', bot: false }] };
    expect(seatOfMe(twins, [{ id: 'x', nickname: 'Sam' }], 'x')).toBeNull();
  });
});

describe('seatOfProfile', () => {
  const replay = { seats: [{ name: 'Ann', bot: false }, { name: 'Ben', bot: false }] };
  const rows = [
    { profile_id: 'p1', display_name: 'Ann' },
    { profile_id: null, display_name: 'Ben' },
  ];

  it('finds the signed-in viewer’s seat by the name they played under', () => {
    expect(seatOfProfile(replay, rows, 'p1')).toBe(0);
  });

  it('is null for anyone not in the match, for a guest and for no one', () => {
    expect(seatOfProfile(replay, rows, 'p9')).toBeNull();
    expect(seatOfProfile(replay, rows, null)).toBeNull();
  });

  it('is null when two seats have the name', () => {
    const twins = { seats: [{ name: 'Ann', bot: false }, { name: 'Ann', bot: false }] };
    expect(seatOfProfile(twins, rows, 'p1')).toBeNull();
  });
});

describe('seatTones', () => {
  it('colours you orange and the other seat ink: you against one opponent', () => {
    expect(seatTones(2, 0)).toEqual(['you', 'p0']);
    expect(seatTones(2, 1)).toEqual(['p0', 'you']);
  });

  it('gives a spectator’s two players ink and the next tone', () => {
    expect(seatTones(2, null)).toEqual(['p0', 'p1']);
  });

  it('tells every opponent of a free-for-all apart', () => {
    expect(seatTones(4, 1)).toEqual(['p0', 'you', 'p1', 'p2']);
  });

  it('starts the tones again past six opponents', () => {
    const tones = seatTones(8, null);
    expect(tones[6]).toBe('p0');
    expect(tones[7]).toBe('p1');
  });
});

describe('oddsTint', () => {
  it('is the chance as a percent, between 0 and 100', () => {
    expect(oddsTint(0.4)).toBe(40);
    expect(oddsTint(1)).toBe(100);
    expect(oddsTint(0)).toBe(0);
  });

  it('is 0 for a cell already open, and for nonsense', () => {
    expect(oddsTint(null)).toBe(0);
    expect(oddsTint(Number.NaN)).toBe(0);
    expect(oddsTint(-1)).toBe(0);
    expect(oddsTint(7)).toBe(100);
  });
});

describe('stepMove', () => {
  it('steps one move with the arrow keys', () => {
    expect(stepMove(5, 'ArrowRight', 10)).toBe(6);
    expect(stepMove(5, 'ArrowDown', 10)).toBe(6);
    expect(stepMove(5, 'ArrowLeft', 10)).toBe(4);
    expect(stepMove(5, 'ArrowUp', 10)).toBe(4);
  });

  it('jumps to the first and last with Home and End', () => {
    expect(stepMove(5, 'Home', 10)).toBe(1);
    expect(stepMove(5, 'End', 10)).toBe(10);
  });

  it('stays inside the game', () => {
    expect(stepMove(1, 'ArrowLeft', 10)).toBe(1);
    expect(stepMove(10, 'ArrowRight', 10)).toBe(10);
  });

  it('leaves every other key alone, so typing and tabbing work as ever', () => {
    for (const key of ['Tab', 'Enter', ' ', 'a', 'Escape', 'PageDown', 'Shift']) {
      expect(stepMove(5, key, 10)).toBeNull();
    }
  });

  it('does nothing in a game with no moves', () => {
    expect(stepMove(1, 'ArrowRight', 0)).toBeNull();
  });
});

describe('coachChips', () => {
  it('offers the turning point, the first key moment, and how to spot a sure mine', () => {
    expect(coachChips(REVIEW)).toEqual(['Where did the game turn?', 'Explain move 2', 'How do I spot a sure mine?']);
  });

  it('explains the first move when no moment stood out', () => {
    expect(coachChips({ ...REVIEW, moments: [] })[1]).toBe('Explain move 1');
  });

  it('has a general question when there is nothing to explain, or no review yet', () => {
    expect(coachChips({ moments: [], moves: [] })[1]).toBe('Who played better, and why?');
    expect(coachChips(null)[1]).toBe('Who played better, and why?');
    expect(coachChips(null)).toHaveLength(3);
  });
});

describe('movesToShow', () => {
  it('finds the moves an answer names, within the game', () => {
    expect(movesToShow('It turned on move 9, after move 4.', 24)).toEqual([9, 4]);
  });

  it('skips repeats and moves that are not in the game', () => {
    expect(movesToShow('Move 9 then move 9 again, and move 99.', 24)).toEqual([9]);
    expect(movesToShow('Move 0 is nothing.', 24)).toEqual([]);
  });

  it('offers at most two links', () => {
    expect(movesToShow('Moves 3, 4 and 5.', 24)).toEqual([3, 4]);
  });

  it('offers none for an answer that names no move', () => {
    expect(movesToShow('Look for numbers that match their covered neighbours.', 24)).toEqual([]);
  });
});
