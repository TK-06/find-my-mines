import type { HintReason } from '@fmm/shared';

/**
 * The friendlier wording of a hint's "Why?", sent a moment after the hint.
 *
 * The hint itself never waits for this: its answer already carries the plain
 * explanation. This runs afterwards, asks the language model to reword only the
 * facts, and sends the result to the one player who asked — if it passes the
 * checks and the game has not moved on in the meantime. Everything that can go
 * wrong ends in "send nothing", and the plain explanation simply stays.
 *
 * No socket and no clock in here, so it is testable with fakes: the caller says
 * how to look at the room and how to send.
 */

/**
 * How long a reworded "Why?" is worth waiting for. A turn lasts 10 seconds and
 * a hint is read in the first few of them.
 */
export const WHY_TIMEOUT_MS = 4_000;

/** The moment a hint was given, as far as "is this still that hint's match?" goes. */
export interface HintStamp {
  /** `MatchManager.matchNumber` when the hint was given. */
  matchNumber: number;
  /** The asker's hints left right after it — another hint since would make this one stale. */
  hintsLeft: number;
}

/** What the room looks like now, to the asker. Null when they are no longer seated in it. */
export interface RoomLook extends HintStamp {
  /** The match is in progress. */
  playing: boolean;
  /** The hinted cell is still covered. */
  covered: boolean;
}

/**
 * Whether a reworded explanation still belongs on the asker's screen: they are
 * still seated in the same room, in the same match, which is still being
 * played, with the hinted cell still covered and no newer hint taken.
 */
export function whyStillApplies(stamp: HintStamp, look: RoomLook | null): boolean {
  return (
    look !== null &&
    look.playing &&
    look.covered &&
    look.matchNumber === stamp.matchNumber &&
    look.hintsLeft === stamp.hintsLeft
  );
}

/** What this needs from the advisor. `Advisor` fits this shape. */
export interface WhyAdvisor {
  explain(reason: HintReason, plain: string, timeoutMs: number): Promise<string | null>;
}

export interface RewordDeps {
  /** Null without a Groq key: nothing is reworded. */
  advisor: WhyAdvisor | null;
  /** The room as the asker sees it now, or null when they have left or been unseated. */
  look(): RoomLook | null;
  /** Sends the wording to the asker alone. */
  send(payload: { row: number; col: number; why: string }): void;
}

export interface RewordRequest {
  row: number;
  col: number;
  reason: HintReason;
  /** The plain explanation the player already has. */
  plain: string;
  stamp: HintStamp;
}

/**
 * Asks for the wording and, if it comes back valid and still applies, sends it.
 * Resolves true only when something was sent. Never throws: it is started
 * without anyone waiting on it.
 */
export async function rewordHint(deps: RewordDeps, request: RewordRequest): Promise<boolean> {
  try {
    if (!deps.advisor) return false;
    const why = await deps.advisor.explain(request.reason, request.plain, WHY_TIMEOUT_MS);
    if (!why) return false;
    // Checked after the wait, not before: the player may have moved on in 4 seconds.
    if (!whyStillApplies(request.stamp, deps.look())) return false;
    deps.send({ row: request.row, col: request.col, why });
    return true;
  } catch {
    return false;
  }
}
