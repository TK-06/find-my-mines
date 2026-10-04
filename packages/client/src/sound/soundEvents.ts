import type { ForfeitNotice, PublicMatchState, PuzzleStatus, RevealedCell } from '@fmm/shared';

/**
 * Which sound a moment in the game calls for — decided here, played elsewhere.
 *
 * Everything in this file is pure: it compares two snapshots of a room and
 * says what happened *to this player*. No audio, no React, no storage, so the
 * rules can be tested without a browser. The server stays the only judge of
 * the game; this only listens to what it already said.
 */

export type SoundEvent =
  /** You are on turn now, whether the match just began or the turn came round. */
  | { kind: 'myTurn' }
  /** You opened an empty slot. `adjacent` (0–8) is the number it showed. */
  | { kind: 'myEmpty'; adjacent: number }
  /** You found a mine — a point, so a reward. */
  | { kind: 'myMine' }
  /** Someone else found a mine. */
  | { kind: 'otherMine' }
  /** Someone else opened an empty slot. Barely there. */
  | { kind: 'otherEmpty' }
  /** One of the last three seconds of your turn. */
  | { kind: 'tick'; secondsLeft: number }
  /** Your clock ran out and the turn went on without you. */
  | { kind: 'timeout' }
  | { kind: 'win' }
  | { kind: 'lose' }
  /** A draw — and what a spectator hears, who has no side. */
  | { kind: 'draw' }
  /** Puzzle only: you opened a mine. */
  | { kind: 'explosion' };

/** The countdown ticks on 3, 2 and 1 — not on 0, where the timeout sound takes over. */
export const TICK_FROM = 3;

/** What the detector carries from one snapshot to the next. */
export interface SoundMemory {
  /** The last snapshot of the room we follow. Null before the first one, which stays silent. */
  last: PublicMatchState | null;
  /**
   * You opened an empty slot and the server has not handed the turn on yet.
   * The server says it in two messages — the reveal, then the new turn — so
   * without this the hand-over would look exactly like your clock running out.
   */
  handOverDue: boolean;
}

export const FRESH_MEMORY: SoundMemory = { last: null, handOverDue: false };

/** Whether this slot is the one the other snapshot already had. */
function sameSlot(a: RevealedCell, b: RevealedCell | undefined): boolean {
  return b !== undefined && a.row === b.row && a.col === b.col;
}

/**
 * The slots opened between two snapshots of one match, oldest first. Empty
 * when nothing was opened — and also when the board was cleared or swapped for
 * another (a reset, a rematch), so a new board never plays a burst of blips.
 */
function newCells(prev: PublicMatchState, next: PublicMatchState): RevealedCell[] {
  if (prev.status !== 'playing') return [];
  const before = prev.revealed.length;
  if (next.revealed.length <= before) return [];
  const last = prev.revealed[before - 1];
  if (last && !sameSlot(last, next.revealed[before - 1])) return [];
  return next.revealed.slice(before);
}

/**
 * One sound per player who opened something, however many slots came with it.
 * A reveal that opened several at once is still one move: it sounds by the
 * slot that was clicked (the first), or as a mine if any of them was one.
 */
function moveEvents(cells: RevealedCell[], myId: string): SoundEvent[] {
  const byPlayer = new Map<string, RevealedCell[]>();
  for (const cell of cells) {
    const list = byPlayer.get(cell.byPlayerId);
    if (list) list.push(cell);
    else byPlayer.set(cell.byPlayerId, [cell]);
  }

  const events: SoundEvent[] = [];
  for (const [playerId, opened] of byPlayer) {
    const mine = playerId === myId;
    if (opened.some((cell) => cell.kind === 'bomb')) {
      events.push({ kind: mine ? 'myMine' : 'otherMine' });
    } else {
      events.push(mine ? { kind: 'myEmpty', adjacent: opened[0]!.adjacent } : { kind: 'otherEmpty' });
    }
  }
  return events;
}

/** How a finished match sounds to this player. A spectator has no side. */
function endEvent(next: PublicMatchState, myId: string): SoundEvent {
  if (next.winnerId === null) return { kind: 'draw' };
  if (next.winnerId === myId) return { kind: 'win' };
  return next.players.some((p) => p.id === myId) ? { kind: 'lose' } : { kind: 'draw' };
}

/** The result of comparing two snapshots. */
export interface SoundStep {
  events: SoundEvent[];
  handOverDue: boolean;
}

/**
 * Compares two snapshots of the SAME room and says what to play.
 *
 * `handOverDue` is the memory from the last comparison (see `SoundMemory`).
 *
 * Moves come first, then the turn, the countdown and the end, so a final
 * reveal plays its own sound and then the fanfare, in that order.
 */
export function diffSnapshots(
  prev: PublicMatchState,
  next: PublicMatchState,
  myId: string,
  handOverDue: boolean,
): SoundStep {
  // Two rooms are not a change within one: nothing to say about it.
  if (prev.roomId !== next.roomId) return { events: [], handOverDue: false };

  const cells = newCells(prev, next);
  const events = moveEvents(cells, myId);

  const hadTurn = prev.status === 'playing' && prev.currentPlayerId === myId;
  const hasTurn = next.status === 'playing' && next.currentPlayerId === myId;
  const openedEmpty = cells.some((cell) => cell.byPlayerId === myId && cell.kind === 'empty');

  if (hasTurn && !hadTurn) events.push({ kind: 'myTurn' });

  // Your turn went to someone else. That is your clock running out — unless an
  // empty slot of yours ended it, which the server announces as the reveal
  // first and the hand-over after, either in this change or in the one before.
  const passedOn =
    hadTurn && next.status === 'playing' && next.currentPlayerId !== null && next.currentPlayerId !== myId;
  if (passedOn && !openedEmpty && !handOverDue) events.push({ kind: 'timeout' });

  const seconds = next.secondsLeft;
  if (hasTurn && seconds !== prev.secondsLeft && seconds >= 1 && seconds <= TICK_FROM) {
    events.push({ kind: 'tick', secondsLeft: seconds });
  }

  if (prev.status === 'playing' && next.status === 'ended') events.push(endEvent(next, myId));

  // An empty slot of yours with the turn still yours: the hand-over is on its
  // way. The question closes once the turn is no longer yours; until then
  // nothing else (a clock tick, someone joining) changes the answer.
  let due = false;
  if (hasTurn) due = openedEmpty || (hadTurn && handOverDue);
  return { events, handOverDue: due };
}

/** `diffSnapshots` for callers that only want the sounds. */
export function matchSoundEvents(
  prev: PublicMatchState,
  next: PublicMatchState,
  myId: string,
  handOverDue = false,
): SoundEvent[] {
  return diffSnapshots(prev, next, myId, handOverDue).events;
}

/**
 * Feeds the next snapshot (or none, once we have left the room) to the
 * detector. The first snapshot of a room — joining, spectating, reconnecting —
 * is silent: a board already in progress is not played back as a burst of blips.
 */
export function stepSounds(
  memory: SoundMemory,
  next: PublicMatchState | null,
  myId: string | null,
): { memory: SoundMemory; events: SoundEvent[] } {
  if (next === null || myId === null) return { memory: FRESH_MEMORY, events: [] };

  const { last } = memory;
  // The very same snapshot again (a re-render): nothing happened.
  if (last === next) return { memory, events: [] };
  if (last === null || last.roomId !== next.roomId) {
    return { memory: { last: next, handOverDue: false }, events: [] };
  }

  const step = diffSnapshots(last, next, myId, memory.handOverDue);
  return { memory: { last: next, handOverDue: step.handOverDue }, events: step.events };
}

/**
 * The match ended because the other side left. The room goes straight back to
 * waiting, so this notice — not the room's status — is the only sign of it.
 * A win for whoever stayed; anyone else in the room is only watching.
 */
export function forfeitSoundEvents(
  prev: ForfeitNotice | null,
  next: ForfeitNotice | null,
  myId: string | null,
): SoundEvent[] {
  if (next === null || next === prev || myId === null) return [];
  return [{ kind: next.winnerId === myId ? 'win' : 'draw' }];
}

/**
 * Puzzle mode: a game that was still going and is now won or lost. Starting a
 * new game, or arriving at one already over, plays nothing.
 */
export function puzzleSoundEvents(prev: PuzzleStatus, next: PuzzleStatus): SoundEvent[] {
  if (prev !== 'ready' && prev !== 'playing') return [];
  if (next === 'won') return [{ kind: 'win' }];
  if (next === 'lost') return [{ kind: 'explosion' }];
  return [];
}
