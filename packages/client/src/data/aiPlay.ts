import type { AiLevel, CellRef, PlayerPublic, PublicMatchState } from '@fmm/shared';

/**
 * Pure rules for games against the computer, as the client shows them: the
 * level buttons' words, when the Hint button is offered, and when a hint on
 * the board has stopped meaning anything. The server decides every outcome —
 * including whether a hint is given at all — this only decides what to show.
 */

/** The lobby's level buttons. */
export const AI_LEVEL_COPY: Record<AiLevel, { label: string; note: string }> = {
  easy: { label: 'Easy', note: 'Makes plenty of mistakes' },
  medium: { label: 'Medium', note: 'Makes some mistakes' },
  hard: { label: 'Hard', note: 'Makes almost none' },
};

/** A computer opponent's seat: unrated, so it shows no Elo. */
export function isBotSeat(player: Pick<PlayerPublic, 'bot'>): boolean {
  return player.bot !== undefined;
}

/**
 * Hints are for the person playing the computer, on their own turn. Anyone
 * watching, and every room a person made or matchmaking found, gets none.
 */
export function canAskHint(state: PublicMatchState | null, myId: string | null): boolean {
  if (!state || myId === null) return false;
  return (
    state.origin === 'ai' &&
    state.status === 'playing' &&
    state.currentPlayerId === myId &&
    state.players.some((p) => p.id === myId)
  );
}

/**
 * A hint on the board lasts until its cell is opened or the turn passes. The
 * caller clears it for good the first time this says no, so it does not come
 * back when the turn does.
 */
export function hintVisible(
  hint: CellRef | null,
  state: PublicMatchState | null,
  myId: string | null,
): boolean {
  if (!hint || !canAskHint(state, myId)) return false;
  return !state!.revealed.some((cell) => cell.row === hint.row && cell.col === hint.col);
}

/**
 * Whether `next` is the first look at a match that `prev` was not: the room's
 * first playing snapshot, a start or rematch, or the board cleared under a
 * running match. Hints are counted per match, so this resets the count.
 */
export function isNewMatch(prev: PublicMatchState | null, next: PublicMatchState): boolean {
  if (next.status !== 'playing') return false;
  if (!prev || prev.roomId !== next.roomId || prev.status !== 'playing') return true;
  return next.revealed.length < prev.revealed.length;
}

export function hintButtonLabel(hintsLeft: number): string {
  return hintsLeft > 0 ? `Hint (${hintsLeft} left)` : 'No hints left';
}
