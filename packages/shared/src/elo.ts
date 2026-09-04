import {
  ELO_K_MASTER,
  ELO_K_PROVISIONAL,
  ELO_K_STANDARD,
  ELO_MASTER_RATING,
  ELO_PROVISIONAL_GAMES,
  STARTING_ELO,
} from './config.js';

/**
 * Elo rating maths, chess.com / FIDE style.
 *
 * Pure by design: no I/O, no database, no clock. The server calls this after a
 * match ends and persists whatever comes back.
 */

/** One seat at the end of a match, as far as rating is concerned. */
export interface EloEntrant {
  /** Stable id — a profile id, or a socket id for a guest. */
  id: string;
  rating: number;
  gamesPlayed: number;
  /** Mines found. Higher wins. */
  score: number;
  /**
   * Guests have nowhere to store a rating, so their delta is computed (they
   * still affect opponents) and then discarded.
   */
  isGuest: boolean;
}

export interface EloResult {
  id: string;
  ratingBefore: number;
  /** Equal to ratingBefore for guests and for casual matches. */
  ratingAfter: number;
  delta: number;
  /** 1 = best score in the match. Ties share a placement. */
  placement: number;
  outcome: 'win' | 'loss' | 'draw';
}

/**
 * Probability that `rating` beats `opponentRating`.
 *
 * Symmetric: expectedScore(a, b) + expectedScore(b, a) === 1.
 */
export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

/** Provisional players move fastest; masters move least. */
export function kFactor(rating: number, gamesPlayed: number): number {
  if (gamesPlayed < ELO_PROVISIONAL_GAMES) return ELO_K_PROVISIONAL;
  if (rating >= ELO_MASTER_RATING) return ELO_K_MASTER;
  return ELO_K_STANDARD;
}

/** Actual score for one pairing: 1 win, 0.5 draw, 0 loss. */
function actualScore(score: number, opponentScore: number): 0 | 0.5 | 1 {
  if (score > opponentScore) return 1;
  if (score < opponentScore) return 0;
  return 0.5;
}

/** 1-based placement per entrant, ties sharing the same number. */
function placements(entrants: readonly EloEntrant[]): Map<string, number> {
  const ordered = [...entrants].sort((a, b) => b.score - a.score);
  const result = new Map<string, number>();

  let lastScore: number | null = null;
  let lastPlacement = 0;

  ordered.forEach((entrant, index) => {
    const placement = entrant.score === lastScore ? lastPlacement : index + 1;
    lastScore = entrant.score;
    lastPlacement = placement;
    result.set(entrant.id, placement);
  });

  return result;
}

/**
 * Rates a finished match.
 *
 * Two players is ordinary Elo. Three or more is resolved pairwise: every pair
 * is treated as its own head-to-head, the deltas are summed, then divided by
 * (N - 1) so a four-player game is not worth three times a 1v1. At N = 2 the
 * divisor is 1, so this reduces exactly to the standard formula — one code
 * path for both cases.
 *
 * `ranked` false still produces placements and outcomes (useful for match
 * history) but every delta is zero.
 */
export function rateMatch(entrants: readonly EloEntrant[], ranked: boolean): EloResult[] {
  if (entrants.length < 2) {
    throw new Error('rateMatch needs at least two entrants');
  }

  const place = placements(entrants);
  const opponents = entrants.length - 1;

  return entrants.map((entrant) => {
    const k = kFactor(entrant.rating, entrant.gamesPlayed);

    let totalDelta = 0;
    let wins = 0;
    let losses = 0;

    for (const other of entrants) {
      if (other.id === entrant.id) continue;

      const actual = actualScore(entrant.score, other.score);
      if (actual === 1) wins++;
      else if (actual === 0) losses++;

      totalDelta += k * (actual - expectedScore(entrant.rating, other.rating));
    }

    // Guests have no row to write to, and casual matches do not move ratings.
    const applies = ranked && !entrant.isGuest;
    const delta = applies ? Math.round(totalDelta / opponents) : 0;

    return {
      id: entrant.id,
      ratingBefore: entrant.rating,
      ratingAfter: entrant.rating + delta,
      delta,
      placement: place.get(entrant.id)!,
      outcome: wins > losses ? 'win' : losses > wins ? 'loss' : 'draw',
    };
  });
}

/** A guest entrant: fixed starting rating, never persisted. */
export function guestEntrant(id: string, score: number): EloEntrant {
  return { id, rating: STARTING_ELO, gamesPlayed: 0, score, isGuest: true };
}
