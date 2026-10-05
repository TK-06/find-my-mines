import { reviewMatchAsync, timeSlicedPause, type Replay, type Review } from '@fmm/shared';
import type { CoachTurn } from '../state/coachBook.js';
import { buildCoachMessages, checkCoachAnswer, coachFacts, focusFor, nameThePlayers } from './coachPrompt.js';
import type { ChatTurn } from './prompt.js';

/**
 * The review coach: one question about one finished game, answered by a
 * language model from the server's own facts about that game.
 *
 * Everything that can go wrong ends in a plain outcome and never a throw: the
 * model is slow or out of budget (`busy`), or says something the facts do not
 * back up (`unhelpful`) — and in neither case does the question count.
 */

/** How long a question waits for the model. */
export const COACH_TIMEOUT_MS = 8_000;

/**
 * The share of the main Groq key's minute that is kept for the AI opponents when
 * the coach has no key of its own. The computer's moves are the game; the
 * coach is a nicety, so it may only use the first half.
 */
export const COACH_RESERVE = 0.5;

/** What the coach needs from the advisor. `Advisor` fits this shape. */
export interface CoachModel {
  coach(messages: readonly ChatTurn[], timeoutMs: number, reserve: number): Promise<string | null>;
}

export type CoachOutcome =
  /** A checked answer, safe to show. The question counts. */
  | { kind: 'answer'; answer: string }
  /** The model answered, but not in a way the facts back up. Say so; the question does not count. */
  | { kind: 'unhelpful' }
  /** No answer: the budget is spent, the model was slow, or the call failed. The question does not count. */
  | { kind: 'busy' };

/**
 * Asks the model one question about a game and checks what comes back.
 * `reserve` is how much of the model's per-minute budget to leave to others.
 */
export async function askCoach(
  model: CoachModel,
  input: { game: { replay: Replay; review: Review }; question: string; history: readonly CoachTurn[] },
  reserve: number,
  timeoutMs = COACH_TIMEOUT_MS,
): Promise<CoachOutcome> {
  const messages = buildCoachMessages(input);
  let raw: string | null;
  try {
    raw = await model.coach(messages, timeoutMs, reserve);
  } catch {
    return { kind: 'busy' };
  }
  if (raw === null) return { kind: 'busy' };

  // Checked against the same facts the model was given.
  const facts = coachFacts(input.game, focusFor(input.question, input.history));
  const answer = checkCoachAnswer(raw, input.game, facts);
  return answer === null
    ? { kind: 'unhelpful' }
    : { kind: 'answer', answer: nameThePlayers(answer, input.game.replay.seats) };
}

/** Hands the event loop back, so a long analysis never holds up every game on the server. */
const toEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Each replay's analysis, made once however many questions follow. Dropped with the replay. */
const analyses = new WeakMap<Replay, Promise<Review | null>>();

/**
 * The review of a replay, for the facts. Worked out the first time it is
 * needed, in short stretches (a long game is a few hundred solver calls), and
 * remembered. The odds grids are dropped: the coach never needs them.
 */
export function reviewForCoach(replay: Replay): Promise<Review | null> {
  let analysis = analyses.get(replay);
  if (!analysis) {
    analysis = reviewMatchAsync(replay, {
      pause: timeSlicedPause(toEventLoop, () => performance.now()),
    })
      .then((review) => (review ? { ...review, odds: [] } : null))
      .catch((error: unknown) => {
        // Not cached: the next question tries again.
        analyses.delete(replay);
        console.error('[coach] could not analyse a game:', error);
        return null;
      });
    analyses.set(replay, analysis);
  }
  return analysis;
}
