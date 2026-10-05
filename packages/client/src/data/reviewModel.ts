import {
  RATING_LABELS,
  mentionedMoves,
  momentClause,
  momentWhen,
  percentOf,
  type KeyMoment,
  type MoveReview,
  type Rating,
  type Replay,
  type Review,
  type SeatReview,
} from '@fmm/shared';

/**
 * Pure presentation helpers for the game review: the words, the colours' class
 * names, the arithmetic behind the board's tints and the keyboard. Kept apart
 * from the components so they can be unit-tested without a browser.
 *
 * `you` is the seat this tab played (an index into the replay's seats), or null
 * for someone who only watched or who is looking at somebody else's game.
 */

/** How a seat reads in a sentence: "You" / "you" for your own seat, else the name. */
export function seatWord(seat: number, names: readonly string[], you: number | null, capital = false): string {
  if (seat === you) return capital ? 'You' : 'you';
  return names[seat] ?? `Player ${seat + 1}`;
}

/** The first letter in capitals, for a sentence that starts with a name that was lower case. */
function upFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ── move headline and detail ────────────────────────────────────────────────

/** "You opened F1: an empty slot showing 1, turn passes." */
export function moveHeadline(move: MoveReview, names: readonly string[], you: number | null): string {
  const who = seatWord(move.seat, names, you, true);
  if (move.result === 'mine') return `${who} opened ${move.label}: a mine, point scored, the turn goes on.`;
  const shows = move.adjacent > 0 ? `an empty slot showing ${move.adjacent}` : 'an empty slot with no mines next to it';
  return `${who} opened ${move.label}: ${shows}, turn passes.`;
}

/**
 * The line under the headline, saying how the pick compared with the best one:
 * "C2 was a sure mine (100%), but F1 had 40%."
 */
export function moveDetail(move: MoveReview): string {
  const picked = percentOf(move.pickedOdds);
  const best = percentOf(move.bestOdds);
  switch (move.rating) {
    case 'missed':
      return `${move.bestLabel} was a sure mine (100%), but ${move.label} had ${picked}%. That point was there for the taking.`;
    case 'best':
      return move.bestOdds >= 1
        ? `${move.label} was a sure mine (100%): nothing could beat that pick.`
        : `${move.label} had ${picked}%, the best chance on the board.`;
    default:
      return move.pickedOdds <= 0
        ? `${move.label} was safe for sure (0%), while ${move.bestLabel} had ${best}%.`
        : `${move.bestLabel} had the best chance (${best}%), but ${move.label} had ${picked}%.`;
  }
}

/** "5 best · 1 missed sure mine" under a seat's accuracy. */
export function ratingSummary(seat: Pick<SeatReview, 'counts'>): string {
  const missed = seat.counts.missed;
  return `${seat.counts.best} best · ${missed} missed sure mine${missed === 1 ? '' : 's'}`;
}

/** An accuracy as the page shows it: a whole percent, 100% only when every pick was the best, "–" with no moves. */
export function accuracyLabel(accuracy: number | null): string {
  if (accuracy === null) return '–';
  return `${accuracy >= 100 ? 100 : Math.min(99, Math.round(accuracy))}%`;
}

/** Everyone's score before a move, for "Score before move N": "You 3 · Ben 2". */
export function scoreBeforeLabel(move: MoveReview, names: readonly string[], you: number | null): string {
  return move.scores.map((score, seat) => `${seatWord(seat, names, you, true)} ${score}`).join(' · ');
}

/** What a rating chip says. */
export function ratingLabel(rating: Rating): string {
  return RATING_LABELS[rating];
}

// ── key moments ─────────────────────────────────────────────────────────────

/** A key moment as a short clause, without the detail the cards add: "you missed a sure mine at C2". */
export function momentShort(moment: KeyMoment, names: readonly string[], you: number | null): string {
  if (moment.kind === 'missed-sure') {
    return `${seatWord(moment.seat, names, you)} missed a sure mine at ${moment.sureLabel ?? '?'}`;
  }
  return momentClause(moment, names, you);
}

/** What a moment's card says under its title: "You missed a sure mine at C2 and opened F1 instead (40%)". */
export function momentCardText(moment: KeyMoment, names: readonly string[], you: number | null): string {
  return `${upFirst(momentClause(moment, names, you))}.`;
}

/** The pieces of the end-of-game popup's teaser card, from a finished review. */
export interface Teaser {
  /** Your accuracy, e.g. "95%"; null for a spectator, or a seat that made no move. */
  yours: string | null;
  /** The opponent to compare with: the only one, or the most accurate of several. Null when there is none. */
  opponent: { name: string; accuracy: string } | null;
  /** "Key moment: move 9, you missed a sure mine at C2." Null when nothing stood out. */
  moment: string | null;
}

export function teaserOf(review: Review, you: number | null): Teaser {
  const names = review.seats.map((seat) => seat.name);
  const mine = you === null ? null : (review.seats[you] ?? null);
  const others = review.seats.filter((seat) => seat.seat !== you && seat.accuracy !== null);
  const top = [...others].sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0))[0];
  const first = review.moments[0];

  return {
    yours: mine && mine.accuracy !== null ? accuracyLabel(mine.accuracy) : null,
    opponent: top ? { name: top.name, accuracy: accuracyLabel(top.accuracy) } : null,
    moment: first ? `Key moment: ${momentWhen(first)}, ${momentShort(first, names, you)}.` : null,
  };
}

// ── whose seat is whose ─────────────────────────────────────────────────────

/**
 * Which seat of a replay this tab's player was. The replay lists the seats in
 * turn order, which is the room's own seat order, so with the same number of
 * seats the player's place in the room is their seat. After someone has left
 * the orders no longer line up, and the name has to do: it counts only if no
 * other seat has it. Null when it cannot be told (a spectator, or an odd case).
 */
export function seatOfMe(
  replay: Pick<Replay, 'seats'>,
  players: readonly { id: string; nickname: string }[],
  myId: string | null,
): number | null {
  if (myId === null) return null;
  const me = players.find((player) => player.id === myId);
  if (!me) return null;

  if (players.length === replay.seats.length && players.every((p, i) => replay.seats[i]!.name === p.nickname)) {
    return players.findIndex((player) => player.id === myId);
  }
  const byName = replay.seats.flatMap((seat, index) => (!seat.bot && seat.name === me.nickname ? [index] : []));
  return byName.length === 1 ? byName[0]! : null;
}

/**
 * Which seat of a saved match was the signed-in viewer, from the match's own
 * seat rows. Names are what the replay and the rows share; a name two seats
 * share cannot be told apart, so it names no one.
 */
export function seatOfProfile(
  replay: Pick<Replay, 'seats'>,
  rows: readonly { profile_id: string | null; display_name: string }[],
  profileId: string | null,
): number | null {
  if (!profileId) return null;
  const mine = rows.find((row) => row.profile_id === profileId);
  if (!mine) return null;
  const byName = replay.seats.flatMap((seat, index) => (!seat.bot && seat.name === mine.display_name ? [index] : []));
  return byName.length === 1 ? byName[0]! : null;
}

/** The class that colours a seat's found mines: your own seat is signal orange; each other seat gets its own tone. */
export type SeatTone = 'you' | 'p0' | 'p1' | 'p2' | 'p3' | 'p4' | 'p5';

const OTHER_TONES: readonly SeatTone[] = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'];

/**
 * One tone per seat. Yours is 'you'; the others take 'p0', 'p1'… in seat order,
 * so a two-player game is orange against ink, and a free-for-all tells each
 * opponent apart. Past six opponents the tones start again.
 */
export function seatTones(seatCount: number, you: number | null): SeatTone[] {
  let next = 0;
  return Array.from({ length: seatCount }, (_, seat) =>
    seat === you ? 'you' : OTHER_TONES[next++ % OTHER_TONES.length]!,
  );
}

// ── the board's tints ───────────────────────────────────────────────────────

/** How strongly a covered slot is tinted, 0–100: its chance of being a mine, in percent. */
export function oddsTint(odds: number | null): number {
  if (odds === null || !Number.isFinite(odds)) return 0;
  return Math.min(100, Math.max(0, Math.round(odds * 100)));
}

// ── keyboard ────────────────────────────────────────────────────────────────

/**
 * The move a key steps to, from the current one (1-based), or null for a key
 * that is not for stepping. Stays inside 1..total.
 */
export function stepMove(current: number, key: string, total: number): number | null {
  if (total < 1) return null;
  let next: number;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      next = current - 1;
      break;
    case 'ArrowRight':
    case 'ArrowDown':
      next = current + 1;
      break;
    case 'Home':
      next = 1;
      break;
    case 'End':
      next = total;
      break;
    default:
      return null;
  }
  return Math.min(total, Math.max(1, next));
}

// ── the coach's side of the page ────────────────────────────────────────────

/** The three questions offered above the box: the game's turning point, its first key moment, a general one. */
export function coachChips(review: Pick<Review, 'moments' | 'moves'> | null): string[] {
  const first = review?.moments[0]?.move ?? (review && review.moves.length > 0 ? 1 : null);
  return [
    'Where did the game turn?',
    first === null ? 'Who played better, and why?' : `Explain move ${first}`,
    'How do I spot a sure mine?',
  ];
}

/**
 * The moves an answer points at, for its "Show move N" links: each distinct
 * move it names that is in the game, in the order it names them, at most two.
 */
export function movesToShow(text: string, total: number): number[] {
  const shown: number[] = [];
  for (const move of mentionedMoves(text)) {
    if (move >= 1 && move <= total && !shown.includes(move)) shown.push(move);
    if (shown.length === 2) break;
  }
  return shown;
}

/** "Score before move 9" and the like read better with the number of moves in the title of the board. */
export function moveCounter(current: number, total: number): string {
  return `Move ${current} of ${total}`;
}

/** A line for the page header: "6×6 · 11 mines". */
export function boardLine(replay: Pick<Replay, 'rows' | 'cols' | 'mineCount'>): string {
  return `${replay.rows}×${replay.cols} · ${replay.mineCount} mines`;
}
