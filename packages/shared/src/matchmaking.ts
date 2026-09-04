import type { RoomMode } from './types.js';

/**
 * Matchmaking pairing rules.
 *
 * Pure and clock-injected: the server passes `now`, so every rule here is
 * unit-testable without timers, sockets or a database.
 */

/** Starting Elo tolerance. Two 800s pair instantly; 800 and 950 do not. */
export const MATCH_WINDOW_START = 100;

/** The window grows by this much every step, so nobody waits forever. */
export const MATCH_WINDOW_STEP = 50;

/** How long a step lasts. */
export const MATCH_WINDOW_STEP_MS = 5000;

/** Beyond this the window stops growing — effectively "anyone will do". */
export const MATCH_WINDOW_MAX = 800;

export interface QueueEntry {
  /** Socket id. */
  id: string;
  nickname: string;
  elo: number;
  mode: RoomMode;
  /** Epoch ms when they joined the queue. */
  joinedAt: number;
}

export interface QueuePair {
  a: QueueEntry;
  b: QueueEntry;
  mode: RoomMode;
}

/** How wide a player's acceptable Elo range has grown after waiting. */
export function eloWindow(waitedMs: number): number {
  if (waitedMs <= 0) return MATCH_WINDOW_START;
  const steps = Math.floor(waitedMs / MATCH_WINDOW_STEP_MS);
  return Math.min(MATCH_WINDOW_START + steps * MATCH_WINDOW_STEP, MATCH_WINDOW_MAX);
}

/**
 * Two players may meet only if BOTH are willing.
 *
 * Using the tighter of the two windows stops a long-waiting player from being
 * force-matched against someone who just arrived and still expects a close game.
 */
export function canPair(a: QueueEntry, b: QueueEntry, now: number): boolean {
  if (a.id === b.id) return false;
  if (a.mode !== b.mode) return false;

  const window = Math.min(eloWindow(now - a.joinedAt), eloWindow(now - b.joinedAt));
  return Math.abs(a.elo - b.elo) <= window;
}

/**
 * Pairs off as many players as possible in one pass.
 *
 * Longest-waiting first, and for each of those the closest-rated opponent, so
 * queueing longer never makes your match worse. Anyone left over stays queued
 * and their window keeps widening.
 */
export function findPairs(entries: readonly QueueEntry[], now: number): QueuePair[] {
  const waiting = [...entries].sort((a, b) => a.joinedAt - b.joinedAt);
  const taken = new Set<string>();
  const pairs: QueuePair[] = [];

  for (const candidate of waiting) {
    if (taken.has(candidate.id)) continue;

    let best: QueueEntry | null = null;
    let bestGap = Number.POSITIVE_INFINITY;

    for (const other of waiting) {
      if (taken.has(other.id) || other.id === candidate.id) continue;
      if (!canPair(candidate, other, now)) continue;

      const gap = Math.abs(candidate.elo - other.elo);
      // Ties break towards whoever has waited longer, since `waiting` is sorted.
      if (gap < bestGap) {
        best = other;
        bestGap = gap;
      }
    }

    if (best) {
      taken.add(candidate.id);
      taken.add(best.id);
      pairs.push({ a: candidate, b: best, mode: candidate.mode });
    }
  }

  return pairs;
}
