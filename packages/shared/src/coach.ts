import { cleanLine } from './chat.js';

/**
 * The review coach's rules that the server and the page both need: how many
 * questions a game allows, what a question may look like, and how to find the
 * moves and cells a piece of text mentions. Pure.
 */

/** Questions one person may ask about one game. */
export const COACH_QUESTIONS_PER_GAME = 10;

/** Longest question, in characters, after cleaning. */
export const COACH_QUESTION_MAX = 280;

/** Longest answer the server will pass on, in characters. */
export const COACH_ANSWER_MAX = 600;

/** The least time between two questions from one connection. */
export const COACH_ASK_GAP_MS = 3_000;

/** What the coach says when it has no answer worth showing. */
export const COACH_FALLBACK_ANSWER = "I couldn't answer that one — try asking about a specific move.";

/** What the page is told when the model is out of reach or out of budget. */
export const COACH_BUSY_ERROR = 'The coach is busy — try again in a minute.';

export type CleanedQuestion = { ok: true; text: string } | { ok: false; error: string };

/**
 * A question made safe to send: control characters gone, spaces collapsed,
 * between 1 and COACH_QUESTION_MAX characters. A longer one is refused, not
 * cut — half a question would be answered as another one. Run by the server
 * on everything it receives and by the page's input, so people see the same
 * limit before they press Ask.
 */
export function cleanQuestion(raw: unknown): CleanedQuestion {
  // Far past the limit even before cleaning: no need to read all of it to know.
  if (typeof raw === 'string' && raw.length > COACH_QUESTION_MAX * 8) {
    return { ok: false, error: `Keep your question under ${COACH_QUESTION_MAX} characters.` };
  }
  // One past the limit, so a too-long question is told apart from a full one.
  const text = cleanLine(raw, COACH_QUESTION_MAX + 1);
  if (text === null) return { ok: false, error: 'Type a question first.' };
  if (Array.from(text).length > COACH_QUESTION_MAX) {
    return { ok: false, error: `Keep your question under ${COACH_QUESTION_MAX} characters.` };
  }
  return { ok: true, text };
}

/**
 * Every move number a text refers to as "move 9", "moves 4 and 7" or "moves 4
 * to 7" — the numbers themselves, in the order they appear, repeats included.
 */
export function mentionedMoves(text: string): number[] {
  const numbers: number[] = [];
  for (const phrase of text.matchAll(/\bmoves?\s+((?:#?\d{1,5}(?:\s*(?:-|–|—|,|&|and|to)\s*)?)+)/gi)) {
    for (const digits of phrase[1]!.match(/\d{1,5}/g) ?? []) numbers.push(Number(digits));
  }
  return numbers;
}

/** A cell label as the board's rulers write it: "C3", "AD16". */
const CELL_LABEL = /\b[A-Z]{1,2}[1-9]\d?\b/g;

/** Every cell label a text mentions, in capitals, as written. */
export function mentionedCells(text: string): string[] {
  return text.match(CELL_LABEL) ?? [];
}

/**
 * The row-major index of a cell label on a board of this size, or null when the
 * label names no cell of it ("Z9" on a 6×6, "A0").
 */
export function parseCellLabel(label: string, rows: number, cols: number): number | null {
  const match = /^([A-Z]{1,2})([1-9]\d?)$/.exec(label.trim().toUpperCase());
  if (!match) return null;

  // Column letters as a spreadsheet writes them: A..Z, AA, AB…
  let col = 0;
  for (const letter of match[1]!) col = col * 26 + (letter.charCodeAt(0) - 64);
  col -= 1;
  const row = Number(match[2]) - 1;

  if (row < 0 || row >= rows || col < 0 || col >= cols) return null;
  return row * cols + col;
}
