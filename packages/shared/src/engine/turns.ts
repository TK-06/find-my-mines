/**
 * Who plays after the player on turn, or null when nobody can be next.
 *
 * `turnOrderIds` is the order turns rotate through — join order, which is also
 * the order `PublicMatchState.players` arrives in. The server uses this to pass
 * the turn and the leaderboard uses it to tag the "next" player, so the two can
 * never disagree. Finding a mine keeps the turn, so "next" is simply the player
 * after the current one, wrapping from the last back to the first.
 *
 * Null with fewer than two players, or when `currentId` is null or not in the
 * order. What to do then is the caller's decision.
 */
export function nextInTurn(
  turnOrderIds: readonly string[],
  currentId: string | null,
): string | null {
  if (turnOrderIds.length < 2 || currentId === null) return null;

  const index = turnOrderIds.indexOf(currentId);
  if (index < 0) return null;

  return turnOrderIds[(index + 1) % turnOrderIds.length]!;
}
