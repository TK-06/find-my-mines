import { describe, expect, it } from 'vitest';
import {
  cellLabel,
  createBoard,
  createRng,
  mineProbabilities,
  revealCell,
  aiBoard,
  type AiLevel,
  type CellRef,
  type ProbabilityGrid,
  type RevealedCell,
  type SolverView,
} from '@fmm/shared';
import { loadFlyBrain } from './load.js';
import { FLY_STEPS } from './brain.js';
import type { FlyBrain } from './brain.js';
import { flyFeatures } from './features.js';
import { FLY_TEMPERATURE, flyLine, flyMove } from './play.js';

const key = (cell: CellRef) => `${cell.row}:${cell.col}`;

/** A seeded Classic board part-way through a match, with the mines kept aside for scoring. */
function midGame(seed: number): { view: SolverView; grid: ProbabilityGrid; isMine: (cell: CellRef) => boolean } {
  const rng = createRng(seed);
  const board = createBoard({ rows: 6, cols: 6, bombCount: 11 }, rng);
  const revealed: RevealedCell[] = [];
  const target = 4 + Math.floor(rng() * 16);
  let found = 0;
  for (let tries = 0; revealed.length < target && tries < 200; tries++) {
    const row = Math.floor(rng() * 6);
    const col = Math.floor(rng() * 6);
    if (board.bombs[row]![col] && found === 10) continue; // keep one mine hidden
    const outcome = revealCell(board, row, col);
    if (!outcome.ok) continue;
    if (outcome.kind === 'bomb') found++;
    revealed.push({ row, col, kind: outcome.kind, adjacent: outcome.adjacent, byPlayerId: 'p' });
  }
  const view = { rows: 6, cols: 6, mineCount: 11, revealed };
  return { view, grid: mineProbabilities(view), isMine: (cell) => board.bombs[cell.row]![cell.col]! };
}

/** Shannon entropy, in bits, of how often each cell was picked. */
function entropy(counts: Map<string, number>): number {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return -[...counts.values()].reduce((sum, n) => sum + (n / total) * Math.log2(n / total), 0);
}

describe('flyMove', () => {
  const brain = loadFlyBrain();
  const levels: AiLevel[] = ['easy', 'medium', 'hard'];

  it('never picks an open cell, at any level', () => {
    for (let seed = 0; seed < 40; seed++) {
      const { view } = midGame(seed);
      const open = new Set(view.revealed.map(key));
      for (const level of levels) {
        const move = flyMove(brain, view, level, createRng(seed))!;
        expect(open.has(key(move.pick))).toBe(false);
        expect(move.candidates.map(key)).toContain(key(move.pick));
        expect(move.scores).toHaveLength(move.candidates.length);
        for (const cell of move.candidates) expect(open.has(key(cell))).toBe(false);
      }
    }
  });

  it('on Hard takes the top-scoring cell, the earlier on a tie, whatever the random numbers', () => {
    for (let seed = 0; seed < 30; seed++) {
      const { view } = midGame(seed);
      const first = flyMove(brain, view, 'hard', createRng(1))!;
      const best = first.scores.indexOf(Math.max(...first.scores));
      expect(first.pick).toEqual(first.candidates[best]);
      expect(flyMove(brain, view, 'hard', createRng(99))!.pick).toEqual(first.pick);
    }
  });

  it('plays the same move for the same board, level and seed', () => {
    const { view } = midGame(5);
    for (const level of levels) {
      expect(flyMove(brain, view, level, createRng(8))).toEqual(flyMove(brain, view, level, createRng(8)));
    }
  });

  it('traces the picked cell without changing the move, scores, or candidate order', () => {
    const { view } = midGame(31);
    const plain = flyMove(brain, view, 'medium', createRng(47))!;
    const traced = flyMove(brain, view, 'medium', createRng(47), { trace: true })!;

    expect(traced.pick).toEqual(plain.pick);
    expect(traced.scores).toEqual(plain.scores);
    expect(traced.candidates).toEqual(plain.candidates);
    expect(plain).not.toHaveProperty('trace');
    expect(traced.trace).toBeInstanceOf(Float64Array);
    expect(traced.trace).toHaveLength(FLY_STEPS * 244);
    expect([...traced.trace!]).toEqual([...brain.trace(flyFeatures(view, [traced.pick])[0]!)]);
  });

  it('keeps the fly move if only the optional trace fails', () => {
    const { view } = midGame(72);
    const plain = flyMove(brain, view, 'medium', createRng(91))!;
    const traceFailure = new Error('trace unavailable');
    const brokenTrace = {
      score: brain.score.bind(brain),
      trace: () => {
        throw traceFailure;
      },
    } as unknown as FlyBrain;
    const traced = flyMove(brokenTrace, view, 'medium', createRng(91), { trace: true })!;

    expect(traced.pick).toEqual(plain.pick);
    expect(traced.scores).toEqual(plain.scores);
    expect(traced.candidates).toEqual(plain.candidates);
    expect(traced.trace).toBeUndefined();
    expect(traced.traceError).toBe(traceFailure);
  });

  it('gets sleepier as the level gets easier: more variety, same ordering of temperatures', () => {
    expect(FLY_TEMPERATURE.hard).toBe(0);
    expect(FLY_TEMPERATURE.medium).toBeGreaterThan(FLY_TEMPERATURE.hard);
    expect(FLY_TEMPERATURE.easy).toBeGreaterThan(FLY_TEMPERATURE.medium);

    const { view } = midGame(21);
    const spread: Record<string, number> = {};
    const topShare: Record<string, number> = {};
    for (const level of levels) {
      const counts = new Map<string, number>();
      const rng = createRng(4);
      const calls = 150;
      const top = flyMove(brain, view, 'hard', rng)!.pick;
      let onTop = 0;
      for (let i = 0; i < calls; i++) {
        const pick = flyMove(brain, view, level, rng)!.pick;
        counts.set(key(pick), (counts.get(key(pick)) ?? 0) + 1);
        if (key(pick) === key(top)) onTop++;
      }
      spread[level] = entropy(counts);
      topShare[level] = onTop / calls;
    }
    expect(spread.hard).toBeCloseTo(0);
    expect(spread.medium).toBeGreaterThan(spread.hard!);
    expect(spread.easy).toBeGreaterThan(spread.medium! + 0.3);
    expect(topShare.hard).toBe(1);
    expect(topShare.easy).toBeLessThan(topShare.medium!);
  }, 30_000);

  it('finds mines far more often than a random cell, even when sleepy', () => {
    const rate = (level: AiLevel) => {
      let hits = 0;
      let base = 0;
      const boards = 200;
      for (let seed = 2_000; seed < 2_000 + boards; seed++) {
        const { view, isMine } = midGame(seed);
        const move = flyMove(brain, view, level, createRng(seed))!;
        if (isMine(move.pick)) hits++;
        base += move.candidates.filter(isMine).length / move.candidates.length;
      }
      return { hits: hits / boards, base: base / boards };
    };
    const hard = rate('hard');
    const easy = rate('easy');
    expect(hard.hits).toBeGreaterThan(hard.base + 0.15);
    expect(easy.hits).toBeGreaterThan(easy.base);
    expect(hard.hits).toBeGreaterThan(easy.hits);
  }, 30_000);

  it('is null when nothing is covered', () => {
    const all: RevealedCell[] = Array.from({ length: 36 }, (_, i) => ({
      row: Math.floor(i / 6),
      col: i % 6,
      kind: 'empty',
      adjacent: 0,
      byPlayerId: 'p',
    }));
    expect(flyMove(brain, { rows: 6, cols: 6, mineCount: 11, revealed: all }, 'hard', createRng(1))).toBeNull();
  });

  it('on a 16×16 board looks at a capped set of cells and answers quickly', () => {
    const { rows, cols, mineCount } = aiBoard(16, 'classic');
    const rng = createRng(77);
    const board = createBoard({ rows, cols, bombCount: mineCount }, rng);
    const revealed: RevealedCell[] = [];
    for (let i = 0; i < 30; i++) {
      const row = Math.floor(rng() * rows);
      const col = Math.floor(rng() * cols);
      const outcome = revealCell(board, row, col);
      if (outcome.ok) revealed.push({ row, col, kind: outcome.kind, adjacent: outcome.adjacent, byPlayerId: 'p' });
    }
    const view = { rows, cols, mineCount, revealed };
    const frontier = flyMove(brain, view, 'hard', createRng(1))!.candidates;
    const started = performance.now();
    const move = flyMove(brain, view, 'medium', createRng(2))!;
    const elapsed = performance.now() - started;
    expect(move.candidates.length).toBeLessThanOrEqual(Math.max(40, frontier.length));
    expect(move.candidates.length).toBeLessThan(rows * cols - revealed.length);
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe('flyLine', () => {
  it('buzzes about the cell it just opened, happier on a mine', () => {
    const cell = { row: 3, col: 2 };
    const rng = createRng(5);
    const found = new Set<string>();
    const missed = new Set<string>();
    for (let i = 0; i < 60; i++) {
      found.add(flyLine(cell, true, rng));
      missed.add(flyLine(cell, false, rng));
    }
    for (const line of [...found, ...missed]) {
      expect(line).toContain(cellLabel(cell));
      expect(line.length).toBeLessThanOrEqual(60);
    }
    expect(found.size).toBeGreaterThan(1);
    expect([...found].some((line) => missed.has(line))).toBe(false);
  });

  it('says the same thing for the same seed', () => {
    expect(flyLine({ row: 0, col: 0 }, true, createRng(9))).toBe(flyLine({ row: 0, col: 0 }, true, createRng(9)));
  });
});
