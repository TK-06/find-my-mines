import { COACH_QUESTIONS_PER_GAME } from '@fmm/shared';

/** Question and answer pairs remembered per person and game, as context for the next question. */
export const COACH_KEEP_TURNS = 4;

/** How long a person's tally for a game is kept after they last asked: half a day. */
export const COACH_BOOK_TTL_MS = 12 * 60 * 60 * 1000;

/** Most tallies held at once, so the book cannot grow without bound on a long-running server. */
export const COACH_BOOK_MAX = 5_000;

/** One exchange, as kept for context. Never persisted, never sent back to a client. */
export interface CoachTurn {
  question: string;
  answer: string;
}

interface Tally {
  person: string;
  game: string;
  /** Questions answered, which is what the allowance counts. */
  asked: number;
  /** Questions being worked on right now: they hold a place in the allowance until they finish. */
  pending: number;
  turns: CoachTurn[];
  touchedAt: number;
}

/**
 * How many questions each person has asked about each game, and the last few
 * exchanges, in memory only. The allowance is per game, so a game is one thing
 * whether it is asked about by the id the replay was held under or by the saved
 * match's id: `moveGame` joins the two once the server learns they are one.
 *
 * A question holds its place from `begin` until `finish`, so two asked at once
 * cannot both slip past the last one. Pure — the caller passes the clock in.
 */
export class CoachBook {
  private readonly tallies = new Map<string, Tally>();

  constructor(
    private readonly allowance = COACH_QUESTIONS_PER_GAME,
    private readonly keepTurns = COACH_KEEP_TURNS,
    private readonly ttlMs = COACH_BOOK_TTL_MS,
    private readonly maxTallies = COACH_BOOK_MAX,
  ) {}

  /** Questions this person may still ask about this game. */
  left(person: string, game: string, now: number): number {
    this.forgetOld(now);
    const tally = this.tallies.get(keyOf(person, game));
    return Math.max(0, this.allowance - (tally ? tally.asked + tally.pending : 0));
  }

  /** The last few exchanges, oldest first. */
  history(person: string, game: string, now: number): CoachTurn[] {
    this.forgetOld(now);
    return [...(this.tallies.get(keyOf(person, game))?.turns ?? [])];
  }

  /** Holds a place for a question about to be worked on. False, and nothing held, when none is left. */
  begin(person: string, game: string, now: number): boolean {
    if (this.left(person, game, now) <= 0) return false;
    const tally = this.tallyFor(person, game, now);
    tally.pending++;
    return true;
  }

  /**
   * Gives the held place back. With the exchange, the question counts and is
   * remembered; with null (it failed, or the answer was no good) it costs nothing.
   */
  finish(person: string, game: string, now: number, turn: CoachTurn | null): void {
    const tally = this.tallies.get(keyOf(person, game));
    if (!tally) return;
    tally.pending = Math.max(0, tally.pending - 1);
    tally.touchedAt = now;
    if (turn) {
      tally.asked++;
      tally.turns.push(turn);
      if (tally.turns.length > this.keepTurns) tally.turns.splice(0, tally.turns.length - this.keepTurns);
    }
    this.touch(tally);
  }

  /**
   * What was counted under one game id now counts under another: the server has
   * learned they are the same game. Where a person has both, the larger tally wins.
   */
  moveGame(from: string, to: string): void {
    if (from === to) return;
    for (const tally of [...this.tallies.values()]) {
      if (tally.game !== from) continue;
      this.tallies.delete(keyOf(tally.person, from));
      const existing = this.tallies.get(keyOf(tally.person, to));
      if (existing) {
        existing.asked = Math.max(existing.asked, tally.asked);
        existing.pending += tally.pending;
        existing.turns = [...existing.turns, ...tally.turns].slice(-this.keepTurns);
        existing.touchedAt = Math.max(existing.touchedAt, tally.touchedAt);
        this.touch(existing);
      } else {
        tally.game = to;
        this.tallies.set(keyOf(tally.person, to), tally);
      }
    }
  }

  get size(): number {
    return this.tallies.size;
  }

  private tallyFor(person: string, game: string, now: number): Tally {
    const key = keyOf(person, game);
    let tally = this.tallies.get(key);
    if (!tally) {
      tally = { person, game, asked: 0, pending: 0, turns: [], touchedAt: now };
      this.tallies.set(key, tally);
      while (this.tallies.size > this.maxTallies) this.tallies.delete(this.tallies.keys().next().value!);
    }
    tally.touchedAt = now;
    this.touch(tally);
    return tally;
  }

  /** To the back of the line: the Map iterates oldest touch first. */
  private touch(tally: Tally): void {
    const key = keyOf(tally.person, tally.game);
    this.tallies.delete(key);
    this.tallies.set(key, tally);
  }

  private forgetOld(now: number): void {
    for (const [key, tally] of this.tallies) {
      // Never forget a question that is being worked on right now.
      if (tally.pending === 0 && now - tally.touchedAt > this.ttlMs) this.tallies.delete(key);
      else if (now - tally.touchedAt <= this.ttlMs) break;
    }
  }
}

/** A person and a game, as one map key. The separator cannot occur in either. */
function keyOf(person: string, game: string): string {
  return `${person}\u0000${game}`;
}
