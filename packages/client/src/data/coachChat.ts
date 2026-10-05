import type { ReviewAskResult, ReviewRef } from '@fmm/shared';

/**
 * The coach panel's conversation, as pure state: the bubbles on screen and how
 * many questions are left. The server keeps its own count and its own record of
 * what was said (this copy is only what is drawn, and is gone with the page);
 * this just mirrors what its replies say.
 */

export interface CoachEntry {
  id: number;
  from: 'you' | 'coach';
  text: string;
  /** A bubble that is an error, not an answer: drawn quieter, and it did not use up a question. */
  failed?: boolean;
}

export interface CoachChat {
  entries: CoachEntry[];
  /** Questions left for this game, as the server last said; null until it has. */
  left: number | null;
  nextId: number;
}

/** Bubbles kept on screen. A person gets ten questions a game, so this is never the limit in practice. */
export const COACH_ENTRIES_MAX = 40;

export const COACH_NO_ANSWER = 'The coach did not answer. Try again in a moment.';

export function emptyChat(): CoachChat {
  return { entries: [], left: null, nextId: 1 };
}

function add(chat: CoachChat, entry: Omit<CoachEntry, 'id'>): CoachChat {
  const entries = [...chat.entries, { ...entry, id: chat.nextId }].slice(-COACH_ENTRIES_MAX);
  return { ...chat, entries, nextId: chat.nextId + 1 };
}

/** The server said how many questions are left, before any was asked. */
export function withLeft(chat: CoachChat, left: number | undefined): CoachChat {
  return left === undefined ? chat : { ...chat, left };
}

/** The person's own question, drawn at once while the answer is awaited. */
export function askedQuestion(chat: CoachChat, question: string): CoachChat {
  return add(chat, { from: 'you', text: question });
}

/**
 * The coach's reply to the last question: its answer, or why there is none. A
 * null result is no reply at all (the connection dropped, or it took too long).
 * The count follows what the server says; a failure leaves it as it was.
 */
export function receivedAnswer(chat: CoachChat, result: ReviewAskResult | null): CoachChat {
  if (result === null) return add(chat, { from: 'coach', text: COACH_NO_ANSWER, failed: true });

  const counted = withLeft(chat, result.questionsLeft);
  if (result.ok && typeof result.answer === 'string' && result.answer.length > 0) {
    return add(counted, { from: 'coach', text: result.answer });
  }
  return add(counted, { from: 'coach', text: result.error ?? COACH_NO_ANSWER, failed: true });
}

/** Whether the Ask button may be pressed. */
export function canAsk(chat: CoachChat, input: string, asking: boolean, connected: boolean): boolean {
  return connected && !asking && input.trim().length > 0 && (chat.left === null || chat.left > 0);
}

/** "7 questions left for this game". */
export function questionsLeftText(left: number | null): string {
  if (left === null) return 'Questions are limited for each game';
  if (left === 0) return 'No questions left for this game';
  return `${left} question${left === 1 ? '' : 's'} left for this game`;
}

/**
 * Which game a question is about, as the server wants it named: the replay id
 * for a game just played (it holds the replay under that), the saved match's id
 * for a game opened from the log. Both when a game just played has been saved.
 */
export function coachRef(game: { replayId?: string | null; matchId?: string | null }): ReviewRef | null {
  const ref: ReviewRef = {};
  if (game.replayId) ref.replayId = game.replayId;
  if (game.matchId) ref.matchId = game.matchId;
  return ref.replayId !== undefined || ref.matchId !== undefined ? ref : null;
}
