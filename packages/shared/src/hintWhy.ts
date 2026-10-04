import type { CellRef } from './ai.js';
import { puzzleCellLabel } from './engine/puzzle.js';
import type { ProbabilityGrid, SolverCell, SolverView } from './engine/solver.js';

/**
 * The "Why?" under a hint: one or two plain sentences saying why that cell,
 * using only what anyone can see on the board — the numbers around it, the
 * mines already found, and how many mines are still hidden. Pure, so the
 * server (match hints) and the browser (Puzzle hints) share it, and so the
 * Groq rewording can be handed the same facts instead of the board.
 *
 * Nothing here knows where the mines really are. The solver's grid is the only
 * input about what is likely, and it is built from the public view too.
 */

/** What the hint is after: a match hint points at a likely mine, a Puzzle hint at a safe cell. */
export type HintGoal = 'mine' | 'safe';

/** One open number the explanation leans on, as a plain fact. */
export interface HintNumber {
  /** Where it is, e.g. "B3". */
  at: string;
  /** The digit it shows. */
  value: number;
  /** Mines already found (revealed) around it — a multiplayer match shows those. */
  found: number;
  /** What it still needs: the digit minus the found mines around it. */
  need: number;
  /** How many covered cells touch it. */
  covered: number;
}

interface ReasonBase {
  goal: HintGoal;
  /** The hinted cell, e.g. "C3". */
  cell: string;
  /**
   * The hinted cell carries the player's flag (Puzzle only). That only happens
   * when a flag has to be wrong — see `puzzleHint` — so the text ends by saying so.
   */
  flagged: boolean;
}

/** One open number settles it on its own. */
export interface ForcedReason extends ReasonBase {
  kind: 'forced';
  number: HintNumber;
  /**
   * Goal 'mine': the number's covered neighbours that are not known safe — as
   * many as it still needs, so every one is a mine (the hinted cell among
   * them). Goal 'safe': its covered neighbours that are not sure mines — all safe.
   */
  cells: string[];
  /** Goal 'safe': the sure mines that use up the number, besides any found ones. */
  sureMines: string[];
  /** Goal 'mine': covered neighbours already known to be safe, left out of `cells`. */
  knownSafe: string[];
}

/** Certain, but only by putting several numbers together. */
export interface CombinedReason extends ReasonBase {
  kind: 'combined';
  /** The numbers that touch the cell, simplest first. At most four are listed. */
  numbers: HintNumber[];
  /** How many more touch it than are listed. */
  more: number;
}

/** Not certain: the chance, and the number that says the most about it. */
export interface LikelyReason extends ReasonBase {
  kind: 'likely';
  /** Whole percent, kept within 1–99. A mine chance for goal 'mine', a risk for 'safe'. */
  percent: number;
  /** The touching number whose own odds (need ÷ covered slots) come closest to the cell's chance. */
  number: HintNumber;
  /**
   * That number's own odds are well away from the cell's chance, because the
   * rest of the board (other numbers, the mine total) pushes it up or down.
   * The text says so, so "1 mine among 5 slots" is not read as the whole answer.
   */
  shifted: boolean;
  /** The best chance on the whole board (highest for 'mine', lowest for 'safe'). */
  extreme: boolean;
}

/** No open number touches the cell, so nothing pins it down. */
export interface UntouchedReason extends ReasonBase {
  kind: 'untouched';
  percent: number;
  /** Mines not found yet. */
  minesHidden: number;
  /** Covered cells no open number touches, the hinted one included. */
  unreached: number;
  extreme: boolean;
}

/** Certain, and no number touches the cell — the mine count alone settles it. */
export interface CountedReason extends ReasonBase {
  kind: 'counted';
  minesHidden: number;
  /** Covered cells on the whole board. */
  covered: number;
}

/** The structured facts behind a hint's explanation: serialisable, and all the Groq prompt ever sees. */
export type HintReason = ForcedReason | CombinedReason | LikelyReason | UntouchedReason | CountedReason;

/** An explanation: the facts and the sentences made from them. */
export interface HintExplanation {
  reason: HintReason;
  text: string;
}

export interface ExplainOptions {
  /** The hinted cell carries the player's flag. Goal 'safe' only. */
  flagged?: boolean;
}

/** More than this many numbers around a cell are summed up as "N more". */
const MAX_NUMBERS_LISTED = 4;

/** Probabilities this close count as the same, so float noise cannot hide a tie. */
const SAME = 1e-9;

/** A number's own odds this far (10 points) from the cell's chance no longer explain it on their own. */
const SHIFTED = 0.1;

/**
 * Why the hint points where it does. `grid` is the solver's chance for each
 * cell, worked out from `view`, and `goal` says whether the hint is the
 * likeliest mine or the safest cell. In order of preference:
 *
 *  - forced — one open number settles it: for a mine, the number still needs
 *    exactly as many mines as it has covered neighbours that could hold them;
 *    for a safe cell, every mine around the number is already accounted for;
 *  - counted — certain, and the mine count alone settles it (every covered
 *    cell is a mine, or no mine is left hidden), or no number touches the cell;
 *  - combined — certain, but only by putting the touching numbers together;
 *  - likely — not certain: the chance, and the touching number that says the
 *    most about it;
 *  - untouched — not certain, and no number touches the cell.
 *
 * Certain means the solver gave exactly 1 (a mine) or 0 (safe), the same test
 * the hint sentences use, so the text can never say "not certain" under
 * "must be a mine". Never throws; a cell that is not covered gets the plain
 * odds of a covered cell rather than an error.
 */
export function explainHint(
  view: SolverView,
  grid: ProbabilityGrid,
  cell: CellRef,
  goal: HintGoal,
  options: ExplainOptions = {},
): HintExplanation {
  const board = readBoard(view);
  const base = {
    goal,
    cell: puzzleCellLabel(cell),
    // A flag only means something on a safe-cell hint.
    flagged: goal === 'safe' && options.flagged === true,
  };

  let found = 0;
  board.open.forEach((c) => {
    if (c.kind === 'bomb') found++;
  });
  const minesHidden = Math.max(0, view.mineCount - found);
  const covered = board.rows * board.cols - board.open.size;

  const chance = chanceAt(grid, cell);
  const certain = chance !== null && (goal === 'mine' ? chance >= 1 : chance <= 0);
  const numbers = numbersAround(board, cell);

  let reason: HintReason;
  if (certain) {
    const forced = forcedBy(numbers, grid, goal);
    if (forced) {
      reason = {
        ...base,
        kind: 'forced',
        number: factOf(forced.number),
        cells: labels(forced.cells),
        sureMines: labels(forced.sureMines),
        knownSafe: labels(forced.knownSafe),
      };
    } else if (
      numbers.length === 0 ||
      (goal === 'mine' && covered > 0 && minesHidden === covered) ||
      (goal === 'safe' && minesHidden === 0)
    ) {
      reason = { ...base, kind: 'counted', minesHidden, covered };
    } else {
      reason = {
        ...base,
        kind: 'combined',
        numbers: [...numbers]
          .sort((a, b) => a.covered.length - b.covered.length)
          .slice(0, MAX_NUMBERS_LISTED)
          .map(factOf),
        more: Math.max(0, numbers.length - MAX_NUMBERS_LISTED),
      };
    }
  } else {
    // Without a chance for this cell (it is open, or off the board), the
    // plain odds of any covered cell: the hidden mines spread over the covered ones.
    const odds = chance ?? (covered > 0 ? minesHidden / covered : 0);
    // Kept between 1 and 99 so a guess never reads as "0%" or "100%", like the hint sentences.
    const percent = Math.min(99, Math.max(1, Math.round(odds * 100)));
    const extreme = isBest(grid, odds, goal);
    const telling = tellingNumber(numbers, odds);
    reason = telling
      ? {
          ...base,
          kind: 'likely',
          percent,
          number: factOf(telling),
          shifted: Math.abs(shareOf(telling) - odds) > SHIFTED,
          extreme,
        }
      : {
          ...base,
          kind: 'untouched',
          percent,
          minesHidden,
          unreached: countUnreached(board),
          extreme,
        };
  }
  return { reason, text: describeHintReason(reason) };
}

/** The sentences for a set of facts. A pure function of `reason`, so facts that change (a flag taken off) can be re-worded. */
export function describeHintReason(reason: HintReason): string {
  const body = bodyText(reason);
  const flag = flagText(reason);
  return flag ? `${body} ${flag}` : body;
}

function bodyText(reason: HintReason): string {
  switch (reason.kind) {
    case 'forced':
      return reason.goal === 'mine' ? forcedMineText(reason) : forcedSafeText(reason);
    case 'combined':
      return combinedText(reason);
    case 'counted':
      return countedText(reason);
    case 'likely':
      return likelyText(reason);
    case 'untouched':
      return untouchedText(reason);
  }
}

/** The flag line a Puzzle hint on a flagged cell ends with. */
function flagText(reason: HintReason): string {
  if (!reason.flagged || reason.goal !== 'safe') return '';
  const certain = reason.kind !== 'likely' && reason.kind !== 'untouched';
  return certain
    ? `The flag on ${reason.cell} is wrong, so take it off.`
    : `One of your flags has to be wrong, and the one on ${reason.cell} is the likeliest.`;
}

/** "The 2 at B3 still needs 2 mines and touches only C3 and C4, so both are mines." */
function forcedMineText(reason: ForcedReason): string {
  const n = reason.number;
  const count = reason.cells.length;
  const where = list(reason.cells);
  const verdict = count === 1 ? `${reason.cell} is a mine` : count === 2 ? 'both are mines' : `all ${count} are mines`;
  const subject = `The ${n.value} at ${n.at}`;
  const needs = n.found > 0 ? `already touches ${foundMines(n.found)} and still needs ${n.need} more` : `still needs ${mines(n.need)}`;

  if (reason.knownSafe.length > 0) {
    return `${subject} ${needs}, and with ${list(reason.knownSafe)} already known to be safe, only ${where} can hold ${count === 1 ? 'it' : 'them'}, so ${verdict}.`;
  }
  if (n.found > 0) {
    return `${subject} ${needs}, but only ${where} ${count === 1 ? 'is' : 'are'} still covered around it, so ${verdict}.`;
  }
  return `${subject} ${needs} and touches only ${where}, so ${verdict}.`;
}

/** "The 1 at C4 already touches a sure mine at D5, so C3 and its other covered neighbours are safe." */
function forcedSafeText(reason: ForcedReason): string {
  const n = reason.number;
  const accounted: string[] = [];
  if (n.found > 0) accounted.push(foundMines(n.found));
  if (reason.sureMines.length === 1) accounted.push(`a sure mine at ${reason.sureMines[0]}`);
  else if (reason.sureMines.length > 1) accounted.push(`sure mines at ${list(reason.sureMines)}`);

  const touches = accounted.length > 0 ? `already touches ${accounted.join(' and ')}` : 'touches no mines';
  const others = reason.cells.length - 1;
  const safe =
    others > 0
      ? `${reason.cell} and its other covered neighbour${others === 1 ? '' : 's'} are safe`
      : `${reason.cell} is safe`;
  return `The ${n.value} at ${n.at} ${touches}, so ${safe}.`;
}

function combinedText(reason: CombinedReason): string {
  const verdict = reason.goal === 'mine' ? `puts a mine at ${reason.cell}` : `leaves ${reason.cell} empty, so it is safe`;
  const names = reason.numbers.map((n) => `the ${n.value} at ${n.at}`);
  if (reason.more > 0) names.push(`${reason.more} more`);

  if (names.length === 1) {
    return `${capital(names[0]!)} cannot prove it alone, but every arrangement of the hidden mines that fits the numbers ${verdict}.`;
  }
  return `No single number proves it, but together they do: ${list(names)} touch ${reason.cell}, and every arrangement of the hidden mines that fits the numbers ${verdict}.`;
}

function countedText(reason: CountedReason): string {
  const { cell, minesHidden } = reason;
  if (reason.goal === 'mine') {
    if (reason.covered > 0 && minesHidden === reason.covered) {
      return `${cell} is a mine: ${mines(minesHidden)} still hidden and exactly ${reason.covered} covered ${reason.covered === 1 ? 'cell' : 'cells'}, so every covered cell has one.`;
    }
    return `No open number touches ${cell}, but counting the ${mines(minesHidden)} still hidden against the numbers elsewhere puts one there in every arrangement.`;
  }
  if (minesHidden === 0) return `Every mine is already found, so no covered cell hides one: ${cell} is safe.`;
  return `No open number touches ${cell}, but counting the ${mines(minesHidden)} still hidden against the numbers elsewhere leaves it empty in every arrangement.`;
}

function likelyText(reason: LikelyReason): string {
  const n = reason.number;
  const slots = n.covered === 1 ? 'slot' : 'slots';
  const needs =
    n.found > 0
      ? `already touches ${foundMines(n.found)} and still needs ${n.need} more among its ${n.covered} covered ${slots}`
      : `still needs ${mines(n.need)} among its ${n.covered} covered ${slots}`;
  const aside = reason.shifted ? ', but the rest of the board shifts that' : '';
  return `Not certain. ${reason.cell} touches the ${n.value} at ${n.at}, which ${needs}${aside}; counting every way the hidden mines can fit the numbers, ${oddsText(reason)}.`;
}

function untouchedText(reason: UntouchedReason): string {
  const slots = reason.unreached === 1 ? 'slot' : 'slots';
  return `No open number touches ${reason.cell}, so nothing pins it down. With ${mines(reason.minesHidden)} still hidden and ${reason.unreached} covered ${slots} out of every number's reach, ${oddsText(reason)}.`;
}

/** The chance itself, worded for the goal — and "the best on the board" only when it is. */
function oddsText(reason: LikelyReason | UntouchedReason): string {
  if (reason.goal === 'mine') {
    return `${reason.cell} is a mine about ${reason.percent}% of the time${reason.extreme ? ' — the likeliest cell on the board' : ''}`;
  }
  return `${reason.cell} carries about ${reason.percent}% risk${reason.extreme ? ', the lowest on the board' : ''}`;
}

/* ── reading the board ──────────────────────────────────────────────────── */

interface Board {
  rows: number;
  cols: number;
  open: Map<number, SolverCell>;
}

/** The open cells by index, ignoring any that are off the board — as the solver does. */
function readBoard(view: SolverView): Board {
  const { rows, cols } = view;
  const open = new Map<number, SolverCell>();
  for (const cell of view.revealed) {
    if (!Number.isInteger(cell.row) || !Number.isInteger(cell.col)) continue;
    if (cell.row < 0 || cell.row >= rows || cell.col < 0 || cell.col >= cols) continue;
    open.set(cell.row * cols + cell.col, cell);
  }
  return { rows, cols, open };
}

/** An open number and what is around it. */
interface NumberInfo extends CellRef {
  value: number;
  /** Found mines among its neighbours. */
  found: number;
  /** Its covered neighbours, in reading order. */
  covered: CellRef[];
}

function numberInfo(board: Board, row: number, col: number): NumberInfo | null {
  const here = board.open.get(row * board.cols + col);
  if (!here || here.kind !== 'empty') return null;
  let found = 0;
  const covered: CellRef[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = row + dr;
      const c = col + dc;
      if ((dr === 0 && dc === 0) || r < 0 || r >= board.rows || c < 0 || c >= board.cols) continue;
      const next = board.open.get(r * board.cols + c);
      if (!next) covered.push({ row: r, col: c });
      else if (next.kind === 'bomb') found++;
    }
  }
  return { row, col, value: here.adjacent, found, covered };
}

/** The open numbers touching a cell, in reading order. */
function numbersAround(board: Board, cell: CellRef): NumberInfo[] {
  const out: NumberInfo[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const row = cell.row + dr;
      const col = cell.col + dc;
      if (row < 0 || row >= board.rows || col < 0 || col >= board.cols) continue;
      const info = numberInfo(board, row, col);
      if (info) out.push(info);
    }
  }
  return out;
}

/** The solver's chance for a cell, or null when the grid has none (the cell is open, or off the board). */
function chanceAt(grid: ProbabilityGrid, cell: CellRef): number | null {
  const value = grid[cell.row]?.[cell.col];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const isSureMine = (chance: number | null) => chance !== null && chance >= 1;
const isSureSafe = (chance: number | null) => chance !== null && chance <= 0;

/** A number that settles the hinted cell, with the cells it speaks for. */
interface Forced {
  number: NumberInfo;
  cells: CellRef[];
  sureMines: CellRef[];
  knownSafe: CellRef[];
}

/**
 * The simplest single number that settles the hinted cell (the one with the
 * fewest covered neighbours), or null when none does.
 *
 * A mine: the number still needs as many mines as it has covered neighbours
 * that are not known safe, so all of them are mines. (Sure mines among them
 * stay in the count; taking them off both sides changes nothing.) A safe cell:
 * the number's mines are all accounted for — found ones plus sure mines — so
 * its other covered neighbours are safe.
 */
function forcedBy(numbers: readonly NumberInfo[], grid: ProbabilityGrid, goal: HintGoal): Forced | null {
  let best: Forced | null = null;
  for (const info of numbers) {
    const sureMines: CellRef[] = [];
    const knownSafe: CellRef[] = [];
    const rest: CellRef[] = [];
    for (const cell of info.covered) {
      const chance = chanceAt(grid, cell);
      if (isSureMine(chance)) sureMines.push(cell);
      else if (isSureSafe(chance)) knownSafe.push(cell);
      else rest.push(cell);
    }

    let cells: CellRef[];
    if (goal === 'mine') {
      // Every covered neighbour not known safe has to be a mine.
      cells = [...sureMines, ...rest].sort(byReadingOrder);
      if (cells.length === 0 || info.value - info.found !== cells.length) continue;
      if (best && best.number.covered.length <= info.covered.length) continue;
      best = { number: info, cells, sureMines: [], knownSafe };
    } else {
      // Found mines plus sure mines already make up the number.
      if (info.found + sureMines.length !== info.value) continue;
      cells = [...knownSafe, ...rest].sort(byReadingOrder);
      if (best && best.number.covered.length <= info.covered.length) continue;
      best = { number: info, cells, sureMines, knownSafe: [] };
    }
  }
  return best;
}

/** What a number asks of each of its covered cells: the mines it still needs ÷ its covered slots. */
function shareOf(n: NumberInfo): number {
  return n.covered.length > 0 ? Math.max(0, n.value - n.found) / n.covered.length : 0;
}

/**
 * The touching number that says the most about a cell that is not certain: the
 * one whose own odds (see `shareOf`) come closest to the cell's chance, so the
 * figure and the number it is quoted beside read as one. A tie goes to the
 * number with fewer covered cells, then to the first in reading order.
 */
function tellingNumber(numbers: readonly NumberInfo[], chance: number): NumberInfo | null {
  let best: NumberInfo | null = null;
  for (const n of numbers) {
    if (!best) {
      best = n;
      continue;
    }
    const gap = Math.abs(shareOf(n) - chance) - Math.abs(shareOf(best) - chance);
    if (gap < -SAME || (Math.abs(gap) <= SAME && n.covered.length < best.covered.length)) best = n;
  }
  return best;
}

/** Covered cells with no open number beside them — what no number reaches. */
function countUnreached(board: Board): number {
  let count = 0;
  for (let row = 0; row < board.rows; row++) {
    for (let col = 0; col < board.cols; col++) {
      if (board.open.has(row * board.cols + col)) continue;
      if (numbersAround(board, { row, col }).length === 0) count++;
    }
  }
  return count;
}

/** Whether no covered cell on the grid is better odds for the goal than `chance`. */
function isBest(grid: ProbabilityGrid, chance: number, goal: HintGoal): boolean {
  for (const row of grid) {
    for (const other of row) {
      if (typeof other !== 'number') continue;
      if (goal === 'mine' ? other > chance + SAME : other < chance - SAME) return false;
    }
  }
  return true;
}

function factOf(info: NumberInfo): HintNumber {
  return {
    at: puzzleCellLabel(info),
    value: info.value,
    found: info.found,
    need: Math.max(0, info.value - info.found),
    covered: info.covered.length,
  };
}

function byReadingOrder(a: CellRef, b: CellRef): number {
  return a.row - b.row || a.col - b.col;
}

function labels(cells: readonly CellRef[]): string[] {
  return [...cells].sort(byReadingOrder).map(puzzleCellLabel);
}

/* ── wording ────────────────────────────────────────────────────────────── */

/** "C3", "C3 and C4", "C3, C4 and D5". */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function mines(count: number): string {
  return `${count} mine${count === 1 ? '' : 's'}`;
}

function foundMines(count: number): string {
  return `${count} found mine${count === 1 ? '' : 's'}`;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
