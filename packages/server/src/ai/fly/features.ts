import { randomInt, type CellRef, type Rng, type SolverView } from '@fmm/shared';

/**
 * What the fly is told about each cell it might open — its "smells". Every
 * value is something a player can see by looking at the cells around it on the
 * public board: what is open, the numbers showing, the mines found. There is
 * no solver in here (no chance of a mine worked out from the whole board) and
 * mine positions are never an input. Each value is 0–1, so it can drive a
 * neuron directly.
 *
 * The last three are the nearest thing to reasoning the fly gets: each open
 * number nearby "presses" on this cell by how many of its mines are still
 * unaccounted for, per covered cell it could be hiding in.
 */
export const FLY_FEATURES = [
  /** Share of the neighbours already open. */
  'open neighbours',
  /** Average of the open neighbours' numbers, out of 8. */
  'numbers nearby',
  /** Share of the neighbours that are found mines. */
  'mines found nearby',
  /** 0 in the middle; higher on an edge, highest in a corner (fewer neighbours). */
  'at the edge',
  /** Mines still hidden, per covered cell — the same for every cell on the board. */
  'mines left',
  /** The strongest pressure from any open numbered neighbour (0 when it has none). */
  'pressure max',
  /** The average pressure over its open numbered neighbours (0 when it has none). */
  'pressure mean',
  /** The weakest pressure from any open numbered neighbour (0 when it has none). */
  'pressure min',
] as const;

export type FlyFeature = (typeof FLY_FEATURES)[number];

/** Where the cells around a cell are looked up: the open cells, by position. */
function openCells(view: SolverView) {
  const { rows, cols } = view;
  const inside = (row: number, col: number) =>
    Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < rows && col >= 0 && col < cols;
  const open = new Map<number, { kind: string; adjacent: number }>();
  for (const cell of view.revealed) {
    if (inside(cell.row, cell.col)) open.set(cell.row * cols + cell.col, cell);
  }
  return { inside, open, at: (row: number, col: number) => (inside(row, col) ? open.get(row * cols + col) : undefined) };
}

/** One row of `FLY_FEATURES` values per cell, in the order given. */
export function flyFeatures(view: SolverView, cells: readonly CellRef[]): number[][] {
  const { rows, cols } = view;
  const { inside, open, at } = openCells(view);
  let found = 0;
  open.forEach((cell) => {
    if (cell.kind === 'bomb') found++;
  });
  const covered = rows * cols - open.size;
  const minesLeft = covered > 0 ? unit((view.mineCount - found) / covered) : 0;

  /**
   * An open numbered cell's pressure: the mines its number says are still
   * hidden (the number, less the mines already found around it), per covered
   * cell around it. Counted from its own side, so every covered cell it
   * touches feels the same push. 0 when it has nothing covered left.
   */
  const pressure = (row: number, col: number, adjacent: number): number => {
    let mines = 0;
    let hidden = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if ((dr === 0 && dc === 0) || !inside(row + dr, col + dc)) continue;
        const cell = at(row + dr, col + dc);
        if (!cell) hidden++;
        else if (cell.kind === 'bomb') mines++;
      }
    }
    return hidden > 0 ? unit((adjacent - mines) / hidden) : 0;
  };

  return cells.map(({ row, col }) => {
    let neighbours = 0;
    let opened = 0;
    let numbers = 0;
    let mines = 0;
    const pressures: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if ((dr === 0 && dc === 0) || !inside(row + dr, col + dc)) continue;
        neighbours++;
        const cell = at(row + dr, col + dc);
        if (!cell) continue;
        opened++;
        if (cell.kind === 'bomb') mines++;
        else {
          numbers += cell.adjacent;
          pressures.push(pressure(row + dr, col + dc, cell.adjacent));
        }
      }
    }
    const numbered = pressures.length;
    return [
      neighbours > 0 ? opened / neighbours : 0,
      numbered > 0 ? unit(numbers / numbered / 8) : 0,
      neighbours > 0 ? mines / neighbours : 0,
      1 - neighbours / 8,
      minesLeft,
      numbered > 0 ? Math.max(...pressures) : 0,
      numbered > 0 ? pressures.reduce((s, p) => s + p, 0) / numbered : 0,
      numbered > 0 ? Math.min(...pressures) : 0,
    ];
  });
}

/** Most cells the fly looks at on a move, unless more than that touch an open cell. */
export const FLY_CANDIDATE_CAP = 40;

/**
 * The cells the fly chooses between: every covered cell, or — when there are
 * more than `cap` — every covered cell that touches an open cell (the ones
 * there is something to see around), then a random sample of the rest to fill
 * up to `cap`. A frontier larger than `cap` is kept whole, so the cap never
 * drops a cell with information. Deterministic given `rng`; no solver involved.
 */
export function flyCandidatesAll(view: SolverView, rng: Rng, cap: number = FLY_CANDIDATE_CAP): CellRef[] {
  const { rows, cols } = view;
  const { open, at } = openCells(view);
  const covered: CellRef[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) if (!at(row, col)) covered.push({ row, col });
  }
  if (covered.length <= cap) return covered;

  const touches = ({ row, col }: CellRef) => {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) if ((dr !== 0 || dc !== 0) && at(row + dr, col + dc)) return true;
    }
    return false;
  };
  const frontier = open.size > 0 ? covered.filter(touches) : [];
  const rest = open.size > 0 ? covered.filter((cell) => !touches(cell)) : covered;
  const extra = Math.min(rest.length, Math.max(0, cap - frontier.length));
  for (let i = 0; i < extra; i++) {
    const j = i + randomInt(rng, rest.length - i);
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return [...frontier, ...rest.slice(0, extra)];
}

function unit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
