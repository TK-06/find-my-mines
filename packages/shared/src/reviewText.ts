import type { KeyMoment, KeyMomentKind } from './review.js';

/**
 * The words of the game review: rating names, a chance as a percent, and how a
 * key moment reads in a sentence. Kept apart from the analysis (review.ts, which
 * needs the solver) so a page that only has to SAY things about a finished
 * review does not pull the solver in with it.
 */

/** How a move compares with the best one available. */
export type Rating = 'best' | 'good' | 'risky' | 'blunder' | 'missed';

export const RATINGS: readonly Rating[] = ['best', 'good', 'risky', 'blunder', 'missed'];

export const RATING_LABELS: Readonly<Record<Rating, string>> = {
  best: 'Best',
  good: 'Good',
  risky: 'Risky',
  blunder: 'Blunder',
  missed: 'Missed a sure mine',
};

/** How a moment's seat reads in a sentence: "you" for the viewer's own seat, else the name. */
function who(seat: number, names: readonly string[], you: number | null): string {
  return seat === you ? 'you' : (names[seat] ?? `seat ${seat + 1}`);
}

/** A chance at or above this is a sure mine (the solver gives exactly 1 for those; this only absorbs rounding). */
const SURE = 1 - 1e-9;

/** A chance as a whole percent, never 0% or 100% unless it is exactly that. */
export function percentOf(chance: number): number {
  if (chance >= SURE) return 100;
  if (chance <= 0) return 0;
  return Math.min(99, Math.max(1, Math.round(chance * 100)));
}

/** A moment's headline, for its card. */
export function momentTitle(kind: KeyMomentKind): string {
  switch (kind) {
    case 'missed-sure':
      return 'Missed a sure mine';
    case 'run':
      return 'A streak';
    case 'lead-change':
      return 'The lead changed hands';
    case 'deciding':
      return 'The deciding mine';
  }
}

/**
 * What happened at a moment, as a clause that starts with who did it: "you
 * missed a sure mine at C2", "Ben found 4 mines in a row". `you` is the
 * viewer's own seat, or null to name everyone.
 */
export function momentClause(moment: KeyMoment, names: readonly string[], you: number | null): string {
  const actor = who(moment.seat, names, you);
  switch (moment.kind) {
    case 'missed-sure':
      return `${actor} missed a sure mine at ${moment.sureLabel ?? '?'} and opened ${moment.label ?? '?'} instead (${percentOf(moment.pickedOdds ?? 0)}%)`;
    case 'run':
      // Which moves the run covered is said once, by momentWhen, not here too.
      return `${actor} found ${moment.length ?? 0} mines in a row`;
    case 'lead-change': {
      const from = moment.from === undefined ? 'the other player' : who(moment.from, names, you);
      return `${actor} took the lead from ${from}`;
    }
    case 'deciding':
      return `${actor} found the mine that decided the game: nobody could catch up after it`;
  }
}

/** When a moment happened: "move 9", or for a run "moves 5 to 7". */
export function momentWhen(moment: KeyMoment): string {
  const end = moment.endMove ?? moment.move;
  return moment.kind === 'run' && end > moment.move ? `moves ${moment.move} to ${end}` : `move ${moment.move}`;
}

/** The same, as one line starting with the move: "move 9, you missed a sure mine at C2 …". */
export function momentSentence(moment: KeyMoment, names: readonly string[], you: number | null): string {
  return `${momentWhen(moment)}, ${momentClause(moment, names, you)}`;
}
