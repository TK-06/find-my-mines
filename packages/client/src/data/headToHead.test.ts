import { describe, expect, it } from 'vitest';
import {
  NO_HEAD_TO_HEAD,
  describeHeadToHead,
  formatNetElo,
  formatRecord,
  headToHead,
  headToHeads,
  type SeatRecord,
} from './headToHead.js';

const ME = 'me';
const ANN = 'ann';

const seat = (
  matchId: string,
  profileId: string | null,
  outcome: SeatRecord['outcome'],
  over: Partial<SeatRecord> = {},
): SeatRecord => ({ matchId, profileId, mode: 'casual', outcome, eloDelta: 0, ...over });

/** Both seats of one match: mine first, then hers. */
const match = (
  id: string,
  mine: SeatRecord['outcome'],
  hers: SeatRecord['outcome'],
  mode: SeatRecord['mode'] = 'casual',
  myDelta = 0,
  herDelta = -myDelta,
): SeatRecord[] => [
  seat(id, ME, mine, { mode, eloDelta: myDelta }),
  seat(id, ANN, hers, { mode, eloDelta: herDelta }),
];

describe('headToHead', () => {
  it('is all zeros when you have never played each other', () => {
    expect(headToHead([], ME, ANN)).toEqual(NO_HEAD_TO_HEAD);
  });

  it('counts wins, losses and draws from your side', () => {
    const seats = [
      ...match('m1', 'win', 'loss'),
      ...match('m2', 'win', 'loss'),
      ...match('m3', 'loss', 'win'),
      ...match('m4', 'draw', 'draw'),
    ];
    expect(headToHead(seats, ME, ANN)).toMatchObject({ games: 4, wins: 2, losses: 1, draws: 1 });
  });

  it('reads the outcome from your seat, not hers', () => {
    // The same match, listed with her seat first: still your win.
    const seats = [seat('m1', ANN, 'loss'), seat('m1', ME, 'win')];
    expect(headToHead(seats, ME, ANN)).toMatchObject({ games: 1, wins: 1, losses: 0 });
    // And her win is your loss — never the other way round.
    expect(headToHead(match('m2', 'loss', 'win'), ME, ANN)).toMatchObject({ wins: 0, losses: 1 });
  });

  it('only counts matches you were both in', () => {
    const seats = [
      ...match('shared', 'win', 'loss'),
      // Yours, against somebody else.
      seat('mine-only', ME, 'win'),
      seat('mine-only', 'cy', 'loss'),
      // Hers, against somebody else.
      seat('hers-only', ANN, 'win'),
      seat('hers-only', 'dee', 'loss'),
    ];
    expect(headToHead(seats, ME, ANN)).toMatchObject({ games: 1, wins: 1, losses: 0, draws: 0 });
  });

  it('counts a match you shared in a bigger room too', () => {
    const seats = [seat('big', ME, 'loss'), seat('big', ANN, 'win'), seat('big', 'cy', 'loss')];
    expect(headToHead(seats, ME, ANN)).toMatchObject({ games: 1, losses: 1 });
  });

  it('adds up your rating change over ranked matches only', () => {
    const seats = [
      ...match('r1', 'win', 'loss', 'ranked', 16),
      ...match('r2', 'loss', 'win', 'ranked', -9),
      ...match('r3', 'win', 'loss', 'ranked', 17),
      // A casual match moves nobody, whatever the row says.
      ...match('c1', 'win', 'loss', 'casual', 40),
    ];
    expect(headToHead(seats, ME, ANN)).toMatchObject({ games: 4, rankedGames: 3, netElo: 24 });
  });

  it('keeps a net loss negative, and a ranked set that cancels out at zero', () => {
    expect(headToHead(match('r1', 'loss', 'win', 'ranked', -12), ME, ANN).netElo).toBe(-12);
    const even = [...match('r1', 'win', 'loss', 'ranked', 10), ...match('r2', 'loss', 'win', 'ranked', -10)];
    const result = headToHead(even, ME, ANN);
    expect(result.netElo).toBe(0);
    expect(result.rankedGames).toBe(2);
  });

  it('has no net Elo to report for casual matches alone', () => {
    const result = headToHead(match('c1', 'win', 'loss', 'casual', 0), ME, ANN);
    expect(result).toMatchObject({ games: 1, rankedGames: 0, netElo: 0 });
  });

  it('counts a match once, even when the same seat was read by both sides', () => {
    const seats = [...match('m1', 'win', 'loss', 'ranked', 12), ...match('m1', 'win', 'loss', 'ranked', 12)];
    expect(headToHead(seats, ME, ANN)).toMatchObject({ games: 1, wins: 1, rankedGames: 1, netElo: 12 });
  });

  it('ignores guests and other players entirely', () => {
    const seats = [seat('m1', null, 'win'), seat('m1', ME, 'loss'), seat('m2', 'cy', 'win'), seat('m2', 'dee', 'loss')];
    expect(headToHead(seats, ME, ANN)).toEqual(NO_HEAD_TO_HEAD);
  });

  it('has no record against yourself', () => {
    expect(headToHead(match('m1', 'win', 'loss'), ME, ME)).toEqual(NO_HEAD_TO_HEAD);
  });

  it('has no record without both ids', () => {
    expect(headToHead(match('m1', 'win', 'loss'), '', ANN)).toEqual(NO_HEAD_TO_HEAD);
    expect(headToHead(match('m1', 'win', 'loss'), ME, '')).toEqual(NO_HEAD_TO_HEAD);
  });

  it('does not change the rows it was given', () => {
    const seats = match('m1', 'win', 'loss', 'ranked', 12);
    const copy = structuredClone(seats);
    headToHead(seats, ME, ANN);
    expect(seats).toEqual(copy);
  });
});

describe('headToHeads', () => {
  const CY = 'cy';
  /** Both seats of one match against `other`: mine first, then theirs. */
  const against = (
    other: string,
    id: string,
    mine: SeatRecord['outcome'],
    theirs: SeatRecord['outcome'],
    mode: SeatRecord['mode'] = 'casual',
    myDelta = 0,
  ): SeatRecord[] => [
    seat(id, ME, mine, { mode, eloDelta: myDelta }),
    seat(id, other, theirs, { mode, eloDelta: -myDelta }),
  ];

  it('works out every friend’s record from one set of seats', () => {
    const seats = [
      ...against(ANN, 'a1', 'win', 'loss'),
      ...against(ANN, 'a2', 'loss', 'win'),
      ...against(CY, 'c1', 'draw', 'draw'),
      ...against(CY, 'c2', 'win', 'loss', 'ranked', 14),
    ];
    const records = headToHeads(seats, ME, [ANN, CY]);
    expect(records.get(ANN)).toMatchObject({ games: 2, wins: 1, losses: 1, draws: 0, rankedGames: 0 });
    expect(records.get(CY)).toMatchObject({ games: 2, wins: 1, losses: 0, draws: 1, rankedGames: 1, netElo: 14 });
  });

  it('agrees with headToHead for each of them, whatever the order or mix of the rows', () => {
    const seats = [
      ...against(CY, 'c1', 'loss', 'win', 'ranked', -9),
      ...against(ANN, 'a1', 'win', 'loss', 'ranked', 16),
      seat('both', ANN, 'loss'),
      seat('both', CY, 'win'),
      seat('both', ME, 'draw'),
      seat('elsewhere', ANN, 'win'),
      seat('elsewhere', 'dee', 'loss'),
      seat('guests', null, 'win'),
    ];
    const records = headToHeads(seats, ME, [ANN, CY]);
    expect(records.get(ANN)).toEqual(headToHead(seats, ME, ANN));
    expect(records.get(CY)).toEqual(headToHead(seats, ME, CY));
  });

  it('gives a friend you never played an entry of zeros, not a missing one', () => {
    const records = headToHeads(against(ANN, 'a1', 'win', 'loss'), ME, [ANN, CY]);
    expect(records.get(CY)).toEqual(NO_HEAD_TO_HEAD);
    expect([...records.keys()].sort()).toEqual([ANN, CY]);
  });

  it('counts a match with two friends in it for both of them', () => {
    const seats = [seat('trio', ME, 'win'), seat('trio', ANN, 'loss'), seat('trio', CY, 'loss')];
    const records = headToHeads(seats, ME, [ANN, CY]);
    expect(records.get(ANN)).toMatchObject({ games: 1, wins: 1 });
    expect(records.get(CY)).toMatchObject({ games: 1, wins: 1 });
  });

  it('does not count a match one friend played without you, or two friends played without you', () => {
    const seats = [seat('theirs', ANN, 'win'), seat('theirs', CY, 'loss')];
    const records = headToHeads(seats, ME, [ANN, CY]);
    expect(records.get(ANN)).toEqual(NO_HEAD_TO_HEAD);
    expect(records.get(CY)).toEqual(NO_HEAD_TO_HEAD);
  });

  it('keeps one friend’s matches out of another’s record', () => {
    const records = headToHeads(against(ANN, 'a1', 'win', 'loss', 'ranked', 10), ME, [ANN, CY]);
    expect(records.get(CY)).toEqual(NO_HEAD_TO_HEAD);
    expect(records.get(ANN)).toMatchObject({ games: 1, netElo: 10 });
  });

  it('counts a match once even when its seats are listed twice', () => {
    const seats = [...against(ANN, 'a1', 'win', 'loss', 'ranked', 12), ...against(ANN, 'a1', 'win', 'loss', 'ranked', 12)];
    expect(headToHeads(seats, ME, [ANN]).get(ANN)).toMatchObject({ games: 1, wins: 1, netElo: 12 });
  });

  it('never lists you against yourself, an empty id, or anyone twice', () => {
    const records = headToHeads(against(ANN, 'a1', 'win', 'loss'), ME, [ME, '', ANN, ANN]);
    expect([...records.keys()]).toEqual([ANN]);
    expect(records.get(ANN)).toMatchObject({ games: 1 });
  });

  it('has nothing to say without friends, or without who you are', () => {
    expect(headToHeads(against(ANN, 'a1', 'win', 'loss'), ME, []).size).toBe(0);
    expect(headToHeads(against(ANN, 'a1', 'win', 'loss'), '', [ANN]).get(ANN)).toEqual(NO_HEAD_TO_HEAD);
  });

  it('hands every friend a record of their own, not the shared empty one', () => {
    const records = headToHeads([], ME, [ANN, CY]);
    expect(records.get(ANN)).not.toBe(records.get(CY));
    expect(records.get(ANN)).not.toBe(NO_HEAD_TO_HEAD);
  });

  it('does not change the rows it was given', () => {
    const seats = against(ANN, 'a1', 'win', 'loss', 'ranked', 12);
    const copy = structuredClone(seats);
    headToHeads(seats, ME, [ANN]);
    expect(seats).toEqual(copy);
  });
});

describe('formatRecord and formatNetElo', () => {
  it('writes wins–losses–draws', () => {
    expect(formatRecord({ ...NO_HEAD_TO_HEAD, games: 4, wins: 3, losses: 1 })).toBe('3–1–0');
    expect(formatRecord(NO_HEAD_TO_HEAD)).toBe('0–0–0');
  });

  it('signs the net Elo like the rest of the app', () => {
    const ranked = { ...NO_HEAD_TO_HEAD, games: 2, rankedGames: 2 };
    expect(formatNetElo({ ...ranked, netElo: 24 })).toBe('+24');
    expect(formatNetElo({ ...ranked, netElo: -8 })).toBe('-8');
    expect(formatNetElo({ ...ranked, netElo: 0 })).toBe('0');
  });

  it('shows a dash when nothing ranked was played, rather than a misleading zero', () => {
    expect(formatNetElo({ ...NO_HEAD_TO_HEAD, games: 3, wins: 3 })).toBe('—');
  });
});

describe('describeHeadToHead', () => {
  it('says so when you have not played each other', () => {
    expect(describeHeadToHead(NO_HEAD_TO_HEAD, 'Ann')).toBe('You and Ann have not played each other yet.');
  });

  it('spells the record and the rating out', () => {
    const text = describeHeadToHead(
      { games: 5, wins: 3, losses: 1, draws: 1, rankedGames: 2, netElo: 24 },
      'Ann',
    );
    expect(text).toBe('Against Ann: 3 wins, 1 loss, 1 draw; +24 Elo over 2 ranked games.');
  });

  it('says there was no rating change when nothing ranked was played', () => {
    const text = describeHeadToHead({ ...NO_HEAD_TO_HEAD, games: 1, wins: 1 }, 'Ann');
    expect(text).toContain('no ranked games');
  });
});
