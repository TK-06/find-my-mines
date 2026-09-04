import type { RevealKind } from '../types.js';
import { allBombsFound, inBounds, isRevealed, type Board } from './board.js';

export type RevealRejection = 'out-of-bounds' | 'already-revealed';

export type RevealOutcome =
  | { ok: false; reason: RevealRejection }
  | {
      ok: true;
      kind: RevealKind;
      /** Bombs in the 8 surrounding slots. Only meaningful when kind === 'empty'. */
      adjacent: number;
      /** Spec: "Players earn 1 point for each bomb slot they have found." */
      pointsAwarded: number;
      /**
       * Spec: "If a bomb is found, the player continues their turn until time
       * runs out; otherwise, the turn passes to another player."
       */
      keepsTurn: boolean;
      /** Spec: "The match ends when all bombs have been found." */
      matchComplete: boolean;
    };

/**
 * Uncovers one cell and reports what happened.
 *
 * Pure with respect to everything except `board.revealed`, which it mutates.
 * Turn ownership, timers and scores are the caller's concern — this function
 * only decides what the cell *was* and what that implies.
 */
export function revealCell(board: Board, row: number, col: number): RevealOutcome {
  if (!inBounds(board, row, col)) {
    return { ok: false, reason: 'out-of-bounds' };
  }
  // Spec: revealed slots are disabled — a second click is a no-op, from either client.
  if (isRevealed(board, row, col)) {
    return { ok: false, reason: 'already-revealed' };
  }

  board.revealed[row]![col] = true;

  const bomb = board.bombs[row]![col]!;
  const adjacent = board.adjacent[row]![col]!;

  return {
    ok: true,
    kind: bomb ? 'bomb' : 'empty',
    adjacent,
    pointsAwarded: bomb ? 1 : 0,
    keepsTurn: bomb,
    matchComplete: allBombsFound(board),
  };
}
