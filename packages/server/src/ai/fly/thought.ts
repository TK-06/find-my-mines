import type { CellRef } from '@fmm/shared';

const MAX_DISPLAY_CANDIDATES = 40;

/** Quantises a step-major neural trace to one byte per rate for the wire. */
export function encodeFlyRates(rates: ArrayLike<number>): string {
  const bytes = Uint8Array.from(rates, (rate) => Math.round(rate * 255));
  return Buffer.from(bytes).toString('base64');
}

/** The panel shows the full choice set up to 40 cells; larger frontiers keep the pick and its best alternatives. */
export function displayFlyCandidates(
  candidates: readonly CellRef[],
  scores: readonly number[],
  pick: CellRef,
): { row: number; col: number; score: number }[] {
  if (scores.length !== candidates.length) return [];
  const scored = candidates.map((cell, index) => ({ ...cell, score: scores[index]!, index }));
  if (scored.length <= MAX_DISPLAY_CANDIDATES) {
    return scored.map(({ row, col, score }) => ({ row, col, score }));
  }

  const picked = scored.find(({ row, col }) => row === pick.row && col === pick.col);
  if (!picked) return [];
  const alternatives = scored
    .filter(({ row, col }) => row !== pick.row || col !== pick.col)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_DISPLAY_CANDIDATES - 1);
  return [picked, ...alternatives].map(({ row, col, score }) => ({ row, col, score }));
}
