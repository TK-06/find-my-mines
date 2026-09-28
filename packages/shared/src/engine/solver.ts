import type { RevealKind } from '../types.js';

/** A revealed cell as the solver needs it. `RevealedCell` fits this shape. */
export interface SolverCell {
  row: number;
  col: number;
  kind: RevealKind;
  /** Mines in the eight neighbours, for an empty cell. */
  adjacent: number;
}

/** What every player can see: the board size, the mine count, and what is open. */
export interface SolverView {
  rows: number;
  cols: number;
  mineCount: number;
  revealed: readonly SolverCell[];
}

/** The chance each cell is a mine, indexed [row][col]; null where the cell is already open. */
export type ProbabilityGrid = (number | null)[][];

/**
 * Largest group of linked frontier cells the solver tries to enumerate. Each
 * extra cell can double the search; measured on 16x16 games, groups up to ~30
 * cells finish in a few thousand steps while groups past 40 rarely finish at
 * all, so bigger ones go straight to the approximation (see `localRatios`).
 */
const MAX_EXACT_GROUP = 40;

/**
 * Search steps one call may spend across all its groups — roughly 20 ms on a
 * laptop. Ordinary groups need a few hundred; this only bites when the numbers
 * pin a group down so loosely that the search stays wide, and it is what keeps
 * a call fast on any board. A group that runs out is approximated like an
 * oversized one.
 */
const SEARCH_BUDGET = 500_000;

const UNKNOWN = -1;
const SAFE = 0;
const MINE = 1;

/** One revealed number: exactly `need` mines among these covered cells. */
interface Constraint {
  cells: number[];
  need: number;
}

/** Frontier cells linked through shared numbers, with the numbers that link them. */
interface Group {
  cells: number[];
  constraints: Constraint[];
}

/** A group after the search, as shares of all the layouts its numbers allow. */
interface SolvedGroup {
  cells: number[];
  /** weight[k]: share of layouts that put k mines in this group. Sums to 1. */
  weight: number[];
  /**
   * mineShare[k][i]: share of layouts with k mines AND a mine on cells[i].
   * Null for an approximated group, whose cells keep their local ratios.
   */
  mineShare: number[][] | null;
}

/**
 * How likely each covered cell is to be a mine, from public information only:
 * the board size, the total mine count, and what has been revealed. Every
 * layout of the remaining mines that agrees with the revealed numbers is
 * treated as equally likely, which is exactly how the server places them.
 *
 * Never throws. Numbers that contradict each other get an even spread over
 * the covered cells rather than an error, because the bot and the hint must
 * still produce a move.
 */
export function mineProbabilities(view: SolverView): ProbabilityGrid {
  const { rows, cols } = view;
  const open = new Map<number, SolverCell>();
  for (const cell of view.revealed) {
    if (!Number.isInteger(cell.row) || !Number.isInteger(cell.col)) continue;
    if (cell.row < 0 || cell.row >= rows || cell.col < 0 || cell.col >= cols) continue;
    open.set(cell.row * cols + cell.col, cell);
  }

  const covered: number[] = [];
  for (let index = 0; index < rows * cols; index++) if (!open.has(index)) covered.push(index);
  let found = 0;
  open.forEach((cell) => {
    if (cell.kind === 'bomb') found++;
  });
  const remaining = view.mineCount - found;

  const chance = solve(rows, cols, open, covered, remaining) ?? evenSpread(rows * cols, covered, remaining);

  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (__, col) => {
      const index = row * cols + col;
      return open.has(index) ? null : clamp01(chance[index]!);
    }),
  );
}

/** The fallback: every covered cell equally likely. */
function evenSpread(total: number, covered: number[], remaining: number): Float64Array {
  const chance = new Float64Array(Math.max(0, total));
  const each = covered.length > 0 ? remaining / covered.length : 0;
  for (const index of covered) chance[index] = each;
  return chance;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** The exact answer where the search allows it, or null when the view is contradictory. */
function solve(
  rows: number,
  cols: number,
  open: Map<number, SolverCell>,
  covered: number[],
  remaining: number,
): Float64Array | null {
  if (!Number.isInteger(remaining) || remaining < 0 || remaining > covered.length) return null;

  const chance = new Float64Array(rows * cols);
  const known = new Int8Array(rows * cols).fill(UNKNOWN);

  const read = readConstraints(rows, cols, open);
  if (!read) return null;
  const deducedMines = deduce(read, known);
  if (deducedMines < 0) return null;
  // Mines still unplaced once the obvious ones are counted.
  const left = remaining - deducedMines;
  if (left < 0) return null;
  const constraints = read.filter((c) => c.cells.length > 0);

  // Smallest groups first, so a large group that exhausts the budget cannot
  // cost the small ones their exact answer.
  const solved: SolvedGroup[] = [];
  const approx = new Map<number, number>();
  const budget = { steps: SEARCH_BUDGET };
  const inGroup = new Set<number>();
  for (const group of splitGroups(constraints).sort((a, b) => a.cells.length - b.cells.length)) {
    group.cells.forEach((cell) => inGroup.add(cell));
    const result = group.cells.length <= MAX_EXACT_GROUP ? enumerate(group, left, budget) : 'gave-up';
    if (result === 'impossible') return null;
    if (result !== 'gave-up') {
      solved.push(result);
      continue;
    }
    // Too big to enumerate: each cell gets its local ratio, and the group's
    // mine total is taken as a spread (every cell independently a mine at its
    // ratio) rather than one fixed number. A fixed guess would pin the
    // interior — one high guess and every untouched cell reads as safe.
    const ratios = localRatios(group);
    group.cells.forEach((cell, i) => approx.set(cell, ratios[i]!));
    solved.push({ cells: group.cells, weight: spreadOf(ratios), mineShare: null });
  }
  const interior = covered.filter((index) => known[index] === UNKNOWN && !inGroup.has(index));

  // How the groups' mine counts combine: prefix[i] and suffix[i] let each
  // group see the distribution of all the OTHER groups without redoing the work.
  const prefix: number[][] = [[1]];
  for (const group of solved) prefix.push(convolve(prefix[prefix.length - 1]!, group.weight));
  const suffix: number[][] = new Array(solved.length + 1);
  suffix[solved.length] = [1];
  for (let i = solved.length - 1; i >= 0; i--) suffix[i] = convolve(solved[i]!.weight, suffix[i + 1]!);
  const all = prefix[solved.length]!;

  // Weight of a frontier total = ways to put the rest among the interior
  // cells, C(interior, left − total). In log space, because C(200, 100) is
  // ~1e59 and a product of such numbers overflows a double.
  const spare = interior.length;
  const logFact = [0];
  for (let i = 1; i <= spare; i++) logFact.push(logFact[i - 1]! + Math.log(i));
  const logChoose = (j: number): number => logFact[spare]! - logFact[j]! - logFact[spare - j]!;
  let top = -Infinity;
  for (let total = 0; total < all.length; total++) {
    const j = left - total;
    if (all[total]! > 0 && j >= 0 && j <= spare) top = Math.max(top, logChoose(j));
  }
  if (top === -Infinity) return null;
  const interiorWeight = (j: number): number => (j < 0 || j > spare ? 0 : Math.exp(logChoose(j) - top));

  let norm = 0;
  let interiorMines = 0;
  for (let total = 0; total < all.length; total++) {
    if (all[total] === 0) continue;
    const w = all[total]! * interiorWeight(left - total);
    norm += w;
    interiorMines += w * (left - total);
  }
  if (!(norm > 0)) return null;

  solved.forEach((group, g) => {
    const mineShare = group.mineShare;
    if (!mineShare) return;
    const others = convolve(prefix[g]!, suffix[g + 1]!);
    // reach[k]: how well k mines in this group fits with everything else.
    const reach = group.weight.map((_, k) => {
      let sum = 0;
      others.forEach((w, total) => {
        if (w > 0) sum += w * interiorWeight(left - k - total);
      });
      return sum;
    });
    // Numerator and denominator run the same sums in the same order, so a
    // cell that is a mine in every layout comes out as exactly 1 (and never
    // as 0.9999999), which is what lets callers trust "certain".
    let denom = 0;
    group.weight.forEach((w, k) => (denom += w * reach[k]!));
    group.cells.forEach((cell, i) => {
      let num = 0;
      mineShare.forEach((shares, k) => (num += shares[i]! * reach[k]!));
      chance[cell] = denom > 0 ? num / denom : NaN;
    });
  });
  approx.forEach((p, cell) => (chance[cell] = p));
  for (const index of covered) if (known[index] !== UNKNOWN) chance[index] = known[index]!;
  const each = spare > 0 ? interiorMines / norm / spare : 0;
  for (const index of interior) chance[index] = each;

  for (const index of covered) if (!Number.isFinite(chance[index]!)) return null;
  return chance;
}

/** Every revealed number as a constraint on its covered neighbours, or null if one is impossible. */
function readConstraints(rows: number, cols: number, open: Map<number, SolverCell>): Constraint[] | null {
  const list: Constraint[] = [];
  for (const [index, cell] of open) {
    if (cell.kind !== 'empty') continue;
    const row = Math.floor(index / cols);
    const col = index % cols;
    // Found mines count toward the number but are already known, so they
    // come off what the covered neighbours must still hold.
    let need = cell.adjacent;
    const cells: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = row + dr;
        const c = col + dc;
        if ((dr === 0 && dc === 0) || r < 0 || r >= rows || c < 0 || c >= cols) continue;
        const neighbour = open.get(r * cols + c);
        if (!neighbour) cells.push(r * cols + c);
        else if (neighbour.kind === 'bomb') need--;
      }
    }
    if (!Number.isInteger(need) || need < 0 || need > cells.length) return null;
    list.push({ cells, need });
  }
  return list;
}

/**
 * Settles the obvious cells first: a number that needs no more mines clears
 * its cells, one that needs all of them fills them. Repeats until nothing
 * changes. Removing these cells splits the frontier into smaller groups, which
 * makes the exact search cheaper. Returns the mines it found, or −1 on a
 * contradiction.
 */
function deduce(constraints: Constraint[], known: Int8Array): number {
  let mines = 0;
  for (let changed = true; changed; ) {
    changed = false;
    for (const constraint of constraints) {
      let need = constraint.need;
      const undecided: number[] = [];
      for (const cell of constraint.cells) {
        if (known[cell] === MINE) need--;
        else if (known[cell] === UNKNOWN) undecided.push(cell);
      }
      constraint.cells = undecided;
      constraint.need = need;
      if (need < 0 || need > undecided.length) return -1;
      if (undecided.length > 0 && (need === 0 || need === undecided.length)) {
        const value = need === 0 ? SAFE : MINE;
        for (const cell of undecided) known[cell] = value;
        if (value === MINE) mines += undecided.length;
        constraint.cells = [];
        constraint.need = 0;
        changed = true;
      }
    }
  }
  return mines;
}

/** Splits the frontier into groups that share no number, so each can be solved on its own. */
function splitGroups(constraints: Constraint[]): Group[] {
  const parent = new Map<number, number>();
  const find = (cell: number): number => {
    let root = cell;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const constraint of constraints) {
    for (const cell of constraint.cells) if (!parent.has(cell)) parent.set(cell, cell);
    const first = find(constraint.cells[0]!);
    for (const cell of constraint.cells) parent.set(find(cell), first);
  }
  const groups = new Map<number, Group>();
  for (const cell of parent.keys()) {
    const root = find(cell);
    if (!groups.has(root)) groups.set(root, { cells: [], constraints: [] });
    groups.get(root)!.cells.push(cell);
  }
  for (const constraint of constraints) groups.get(find(constraint.cells[0]!))!.constraints.push(constraint);
  return [...groups.values()];
}

/**
 * Every layout of mines on a group that satisfies its numbers, counted by how
 * many mines it uses. Backtracking with a check on each number after every
 * cell, so a branch dies as soon as some number can no longer be met.
 */
function enumerate(
  group: Group,
  maxMines: number,
  budget: { steps: number },
): SolvedGroup | 'impossible' | 'gave-up' {
  const n = group.cells.length;
  const local = new Map(group.cells.map((cell, i) => [cell, i]));
  const touching: number[][] = group.cells.map(() => []);
  group.constraints.forEach((c, ci) => c.cells.forEach((cell) => touching[local.get(cell)!]!.push(ci)));

  // Breadth-first through shared numbers: each number gets all its cells
  // decided soon after its first one, so dead branches are cut near the root.
  const order: number[] = [0];
  const queued = new Uint8Array(n);
  queued[0] = 1;
  for (let head = 0; head < order.length; head++) {
    for (const ci of touching[order[head]!]!) {
      for (const cell of group.constraints[ci]!.cells) {
        const i = local.get(cell)!;
        if (!queued[i]) {
          queued[i] = 1;
          order.push(i);
        }
      }
    }
  }

  const need = group.constraints.map((c) => c.need);
  const placed = need.map(() => 0);
  const undecided = group.constraints.map((c) => c.cells.length);
  const isMine = new Uint8Array(n);
  const layouts: number[] = new Array(n + 1).fill(0);
  const hits: number[][] = Array.from({ length: n + 1 }, () => new Array(n).fill(0));
  let gaveUp = false;

  const visit = (depth: number, mines: number): void => {
    if (gaveUp) return;
    if (--budget.steps < 0) {
      gaveUp = true;
      return;
    }
    if (depth === n) {
      layouts[mines]!++;
      const row = hits[mines]!;
      for (let i = 0; i < n; i++) if (isMine[i]) row[i]!++;
      return;
    }
    const i = order[depth]!;
    for (let value = 0; value <= 1 && mines + value <= maxMines; value++) {
      let fits = true;
      for (const ci of touching[i]!) {
        placed[ci]! += value;
        undecided[ci]!--;
        if (placed[ci]! > need[ci]! || placed[ci]! + undecided[ci]! < need[ci]!) fits = false;
      }
      if (fits) {
        isMine[i] = value;
        visit(depth + 1, mines + value);
      }
      for (const ci of touching[i]!) {
        placed[ci]! -= value;
        undecided[ci]!++;
      }
    }
    isMine[i] = 0;
  };
  visit(0, 0);

  if (gaveUp) return 'gave-up';
  const total = layouts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return 'impossible';
  return {
    cells: group.cells,
    weight: layouts.map((count) => count / total),
    mineShare: hits.map((row) => row.map((count) => count / total)),
  };
}

/**
 * The approximation for a group too big to enumerate: each cell gets the
 * average, over the numbers touching it, of (mines still needed ÷ covered
 * cells). After `deduce` no number is 0 or full, so this stays strictly
 * between 0 and 1 — it never claims a certainty it has not proved.
 */
function localRatios(group: Group): number[] {
  const sum = new Map<number, number>();
  const count = new Map<number, number>();
  for (const constraint of group.constraints) {
    const ratio = constraint.need / constraint.cells.length;
    for (const cell of constraint.cells) {
      sum.set(cell, (sum.get(cell) ?? 0) + ratio);
      count.set(cell, (count.get(cell) ?? 0) + 1);
    }
  }
  return group.cells.map((cell) => sum.get(cell)! / count.get(cell)!);
}

/** Distribution of the number of mines among cells that are each a mine with their own chance. */
function spreadOf(chances: number[]): number[] {
  return chances.reduce<number[]>((dist, p) => convolve(dist, [1 - p, p]), [1]);
}

/** Distribution of a + b mines, given the distributions of a and b. */
function convolve(a: number[], b: number[]): number[] {
  const out: number[] = new Array(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => {
    if (x !== 0) b.forEach((y, j) => (out[i + j]! += x * y));
  });
  return out;
}
