import { describe, expect, it } from 'vitest';
import {
  ELO_K_MASTER,
  ELO_K_PROVISIONAL,
  ELO_K_STANDARD,
  ELO_MASTER_RATING,
  ELO_PROVISIONAL_GAMES,
  STARTING_ELO,
} from './config.js';
import { expectedScore, guestEntrant, kFactor, rateMatch, type EloEntrant } from './elo.js';

/** An established player, so the K tier is predictable. */
function player(id: string, rating: number, score: number, gamesPlayed = 50): EloEntrant {
  return { id, rating, gamesPlayed, score, isGuest: false };
}

describe('expectedScore', () => {
  it('is 0.5 between equal ratings', () => {
    expect(expectedScore(800, 800)).toBeCloseTo(0.5, 10);
  });

  it('is symmetric — the two expectations sum to 1', () => {
    expect(expectedScore(1200, 900) + expectedScore(900, 1200)).toBeCloseTo(1, 10);
  });

  it('favours the higher-rated player', () => {
    expect(expectedScore(1200, 900)).toBeGreaterThan(0.5);
    expect(expectedScore(900, 1200)).toBeLessThan(0.5);
  });

  it('gives about 0.76 for a 200-point edge, the textbook value', () => {
    expect(expectedScore(1000, 800)).toBeCloseTo(0.76, 2);
  });

  it('approaches certainty for a very large gap', () => {
    expect(expectedScore(2400, 400)).toBeGreaterThan(0.99);
  });
});

describe('kFactor', () => {
  it('uses the provisional K below the games threshold', () => {
    expect(kFactor(800, ELO_PROVISIONAL_GAMES - 1)).toBe(ELO_K_PROVISIONAL);
  });

  it('drops to the standard K exactly at the threshold', () => {
    expect(kFactor(800, ELO_PROVISIONAL_GAMES)).toBe(ELO_K_STANDARD);
  });

  it('uses the master K at and above the master rating', () => {
    expect(kFactor(ELO_MASTER_RATING, 100)).toBe(ELO_K_MASTER);
    expect(kFactor(ELO_MASTER_RATING + 500, 100)).toBe(ELO_K_MASTER);
  });

  it('a provisional master still counts as provisional', () => {
    // Games played is checked first — a new account cannot be a master yet.
    expect(kFactor(2500, 0)).toBe(ELO_K_PROVISIONAL);
  });
});

describe('rateMatch — two players', () => {
  it('moves the winner up and the loser down by the same amount', () => {
    const [a, b] = rateMatch([player('a', 800, 6), player('b', 800, 5)], true);
    expect(a!.delta).toBeGreaterThan(0);
    expect(b!.delta).toBeLessThan(0);
    expect(a!.delta + b!.delta).toBe(0);
  });

  it('awards K/2 for beating an equal opponent', () => {
    const [a] = rateMatch([player('a', 800, 6), player('b', 800, 5)], true);
    expect(a!.delta).toBe(Math.round(ELO_K_STANDARD * 0.5));
  });

  it('gains more for beating a stronger opponent than a weaker one', () => {
    const upset = rateMatch([player('a', 800, 6), player('b', 1400, 5)], true)[0]!;
    const expected = rateMatch([player('a', 800, 6), player('b', 400, 5)], true)[0]!;
    expect(upset.delta).toBeGreaterThan(expected.delta);
  });

  it('gives both players zero on a draw between equals', () => {
    const results = rateMatch([player('a', 800, 5), player('b', 800, 5)], true);
    expect(results.map((r) => r.delta)).toEqual([0, 0]);
    expect(results.every((r) => r.outcome === 'draw')).toBe(true);
  });

  it('still moves ratings on a draw between unequal players', () => {
    const [weak, strong] = rateMatch([player('a', 700, 5), player('b', 1300, 5)], true);
    expect(weak!.delta).toBeGreaterThan(0);
    expect(strong!.delta).toBeLessThan(0);
  });

  it('applies the provisional K to a new account', () => {
    const [a] = rateMatch([player('a', 800, 6, 0), player('b', 800, 5)], true);
    expect(a!.delta).toBe(Math.round(ELO_K_PROVISIONAL * 0.5));
  });

  it('reports ratingAfter as ratingBefore plus delta', () => {
    const results = rateMatch([player('a', 800, 6), player('b', 900, 5)], true);
    for (const r of results) expect(r.ratingAfter).toBe(r.ratingBefore + r.delta);
  });
});

describe('rateMatch — casual', () => {
  it('produces no rating change at all', () => {
    const results = rateMatch([player('a', 800, 6), player('b', 800, 5)], false);
    expect(results.every((r) => r.delta === 0)).toBe(true);
    expect(results.every((r) => r.ratingAfter === r.ratingBefore)).toBe(true);
  });

  it('still reports placements and outcomes for match history', () => {
    const [a, b] = rateMatch([player('a', 800, 6), player('b', 800, 5)], false);
    expect(a!.placement).toBe(1);
    expect(b!.placement).toBe(2);
    expect(a!.outcome).toBe('win');
  });
});

describe('rateMatch — guests', () => {
  it('discards the guest delta but still moves the registered player', () => {
    const [registered, guest] = rateMatch(
      [player('a', 800, 6), guestEntrant('g', 5)],
      true,
    );
    expect(registered!.delta).toBeGreaterThan(0);
    expect(guest!.delta).toBe(0);
    expect(guest!.ratingAfter).toBe(STARTING_ELO);
  });

  it('rates the guest as a fixed 800 opponent', () => {
    const vsGuest = rateMatch([player('a', 800, 6), guestEntrant('g', 5)], true)[0]!;
    const vs800 = rateMatch([player('a', 800, 6), player('b', 800, 5)], true)[0]!;
    expect(vsGuest.delta).toBe(vs800.delta);
  });

  it('losing to a guest costs the registered player rating', () => {
    const [registered] = rateMatch([player('a', 800, 4), guestEntrant('g', 7)], true);
    expect(registered!.delta).toBeLessThan(0);
  });
});

describe('rateMatch — free-for-all', () => {
  it('reduces to standard Elo when there are two players', () => {
    // The (N-1) divisor is 1 here, so it must match the 1v1 formula exactly.
    const [a] = rateMatch([player('a', 1000, 6), player('b', 1200, 5)], true);
    const k = ELO_K_STANDARD;
    expect(a!.delta).toBe(Math.round(k * (1 - expectedScore(1000, 1200))));
  });

  it('ranks four players by score', () => {
    const results = rateMatch(
      [player('a', 800, 5), player('b', 800, 3), player('c', 800, 8), player('d', 800, 1)],
      true,
    );
    const byId = Object.fromEntries(results.map((r) => [r.id, r.placement]));
    expect(byId).toEqual({ c: 1, a: 2, b: 3, d: 4 });
  });

  it('the winner gains and the last place loses', () => {
    const results = rateMatch(
      [player('a', 800, 9), player('b', 800, 2), player('c', 800, 0)],
      true,
    );
    const byId = Object.fromEntries(results.map((r) => [r.id, r.delta]));
    expect(byId.a).toBeGreaterThan(0);
    expect(byId.c).toBeLessThan(0);
  });

  it('keeps a four-player game roughly zero-sum', () => {
    const results = rateMatch(
      [player('a', 800, 5), player('b', 900, 3), player('c', 1100, 8), player('d', 700, 1)],
      true,
    );
    const sum = results.reduce((total, r) => total + r.delta, 0);
    // Rounding each delta to a whole number leaves a small residue.
    expect(Math.abs(sum)).toBeLessThanOrEqual(results.length);
  });

  it('does not inflate deltas as the field grows', () => {
    const oneOnOne = rateMatch([player('a', 800, 9), player('b', 800, 0)], true)[0]!;
    const fourWay = rateMatch(
      [player('a', 800, 9), player('b', 800, 0), player('c', 800, 0), player('d', 800, 0)],
      true,
    )[0]!;
    // Beating three equals should be worth about the same as beating one.
    expect(fourWay.delta).toBe(oneOnOne.delta);
  });

  it('shares a placement between tied players', () => {
    const results = rateMatch(
      [player('a', 800, 4), player('b', 800, 4), player('c', 800, 1)],
      true,
    );
    const byId = Object.fromEntries(results.map((r) => [r.id, r.placement]));
    expect(byId.a).toBe(1);
    expect(byId.b).toBe(1);
    expect(byId.c).toBe(3);
  });

  it('rejects a match with fewer than two entrants', () => {
    expect(() => rateMatch([player('a', 800, 1)], true)).toThrow();
  });
});
