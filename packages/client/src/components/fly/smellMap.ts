/**
 * The Fruit Fly's "smell map" on the board. Its own tiny module because the
 * board is in the main bundle and the brain panel is a lazy chunk: whatever
 * the board imports must stay small and not drag the panel's code along.
 */

/**
 * Readout scores → 0–1 for tinting the board. The lowest score is 0 and the
 * highest is 1; when every score is the same there is nothing to compare, so
 * they all take the middle of the range.
 */
export function normalizeFlyScores(scores: readonly number[]): number[] {
  if (scores.length === 0) return [];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (max === min) return scores.map(() => 0.5);
  return scores.map((score) => (score - min) / (max - min));
}
