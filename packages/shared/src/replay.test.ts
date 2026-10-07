import { describe, expect, it } from 'vitest';
import { createBoard } from './engine/board.js';
import { createRng } from './engine/rng.js';
import {
  REPLAY_MAX_SEATS,
  REPLAY_MAX_SIDE,
  REPLAY_NAME_MAX,
  buildReplay,
  parseReplay,
  replayAdjacency,
  replayComplete,
  type Replay,
} from './replay.js';

/** A small valid replay: 3 × 3, mines at cells 0 and 4, opened 8, then 0 and 4. */
function valid(): Replay {
  return {
    v: 1,
    rows: 3,
    cols: 3,
    mineCount: 2,
    mines: [0, 4],
    seats: [
      { name: 'Ann', bot: false },
      { name: 'AI · Hard', bot: true },
    ],
    moves: [
      { i: 8, s: 0 },
      { i: 0, s: 1 },
      { i: 4, s: 1 },
    ],
  };
}

/** The same replay with one field changed, as untrusted input. */
const mutated = (change: Record<string, unknown>): unknown => ({ ...valid(), ...change });

describe('parseReplay', () => {
  it('reads a valid replay back, whole', () => {
    expect(parseReplay(valid())).toEqual(valid());
  });

  it('survives a trip through JSON, as it does on the wire and in the database', () => {
    expect(parseReplay(JSON.parse(JSON.stringify(valid())))).toEqual(valid());
  });

  it('accepts a match cut short: fewer moves, mines still hidden', () => {
    expect(parseReplay(mutated({ moves: [{ i: 8, s: 0 }] }))?.moves).toHaveLength(1);
    expect(parseReplay(mutated({ moves: [] }))?.moves).toEqual([]);
  });

  it('accepts a free-for-all of three or more seats', () => {
    const seats = [0, 1, 2].map((n) => ({ name: `P${n}`, bot: false }));
    expect(parseReplay(mutated({ seats, moves: [{ i: 8, s: 2 }] }))?.seats).toHaveLength(3);
  });

  it('is not a replay: not an object, wrong version', () => {
    for (const bad of [null, undefined, 7, 'text', [], [valid()], mutated({ v: 2 }), mutated({ v: undefined }), mutated({ v: '1' })]) {
      expect(parseReplay(bad)).toBeNull();
    }
  });

  it('rejects wrong board sizes', () => {
    for (const change of [
      { rows: 0 },
      { cols: 0 },
      { rows: -3 },
      { rows: 2.5 },
      { cols: '3' },
      { rows: REPLAY_MAX_SIDE + 1 },
      { cols: REPLAY_MAX_SIDE + 1 },
      { rows: Number.NaN },
      { cols: Number.POSITIVE_INFINITY },
    ]) {
      expect(parseReplay(mutated(change)), JSON.stringify(change)).toBeNull();
    }
  });

  it('rejects a mine count that does not fit the board or the list', () => {
    for (const change of [
      { mineCount: 3 }, // the list has two
      { mineCount: 1 },
      { mineCount: 0, mines: [] },
      { mineCount: 9, mines: [0, 1, 2, 3, 4, 5, 6, 7, 8] }, // a board of nothing but mines
      { mineCount: 2.5 },
    ]) {
      expect(parseReplay(mutated(change)), JSON.stringify(change)).toBeNull();
    }
  });

  it('rejects mines out of range, repeated, or not whole numbers', () => {
    for (const mines of [[0, 9], [-1, 4], [0, 0], [0, 4.5], [0, '4'], [0, null]]) {
      expect(parseReplay(mutated({ mines })), JSON.stringify(mines)).toBeNull();
    }
    expect(parseReplay(mutated({ mines: 'nope' }))).toBeNull();
  });

  it('rejects moves out of range, repeated, or by a seat that does not exist', () => {
    for (const moves of [
      [{ i: 9, s: 0 }],
      [{ i: -1, s: 0 }],
      [{ i: 1.5, s: 0 }],
      [{ i: 8, s: 0 }, { i: 8, s: 1 }], // the same cell twice
      [{ i: 8, s: 2 }],
      [{ i: 8, s: -1 }],
      [{ i: 8 }],
      [null],
      ['8'],
    ]) {
      expect(parseReplay(mutated({ moves })), JSON.stringify(moves)).toBeNull();
    }
    expect(parseReplay(mutated({ moves: 'none' }))).toBeNull();
  });

  it('rejects a move after the last mine was found: the match is over by then', () => {
    const moves = [{ i: 0, s: 0 }, { i: 4, s: 0 }, { i: 8, s: 1 }];
    expect(parseReplay(mutated({ moves }))).toBeNull();
  });

  it('rejects oversized payloads without walking them', () => {
    // More moves than the board has cells, and a mines list far past the board.
    const many = Array.from({ length: 5000 }, (_, i) => ({ i: i % 9, s: 0 }));
    expect(parseReplay(mutated({ moves: many }))).toBeNull();
    expect(parseReplay(mutated({ mines: Array.from({ length: 100_000 }, (_, i) => i) }))).toBeNull();
    const seats = Array.from({ length: 500 }, () => ({ name: 'x', bot: false }));
    expect(parseReplay(mutated({ seats }))).toBeNull();
  });

  it('needs at least two seats', () => {
    expect(parseReplay(mutated({ seats: [{ name: 'Solo', bot: false }], moves: [] }))).toBeNull();
    expect(parseReplay(mutated({ seats: [], moves: [] }))).toBeNull();
    expect(parseReplay(mutated({ seats: 'Ann and Bob' }))).toBeNull();
  });

  it('takes as many seats as an unlimited room can have, not just a fixed room’s 12', () => {
    const seatsOf = (count: number) => Array.from({ length: count }, (_, n) => ({ name: `P${n}`, bot: false }));
    expect(parseReplay(mutated({ seats: seatsOf(13) }))?.seats).toHaveLength(13);
    expect(parseReplay(mutated({ seats: seatsOf(REPLAY_MAX_SEATS) }))?.seats).toHaveLength(REPLAY_MAX_SEATS);
    expect(parseReplay(mutated({ seats: seatsOf(REPLAY_MAX_SEATS + 1) }))).toBeNull();
  });

  it('rejects a seat that is not a name', () => {
    expect(parseReplay(mutated({ seats: [{ name: 'Ann', bot: false }, { name: 7, bot: false }] }))).toBeNull();
    expect(parseReplay(mutated({ seats: [{ name: 'Ann', bot: false }, null] }))).toBeNull();
  });

  it('cleans names: control characters, runs of spaces, length', () => {
    const seats = [
      { name: 'An\nn\u0007   Lee', bot: false },
      { name: 'x'.repeat(500), bot: 'yes' },
    ];
    const read = parseReplay(mutated({ seats }))!;
    expect(read.seats[0]!.name).toBe('An n Lee');
    expect(Array.from(read.seats[1]!.name)).toHaveLength(REPLAY_NAME_MAX);
    // Only a real true makes a bot.
    expect(read.seats[1]!.bot).toBe(false);
  });

  it('gives a name that cleans to nothing a plain one', () => {
    const read = parseReplay(mutated({ seats: [{ name: '  \n ', bot: false }, { name: 'Bo', bot: false }] }))!;
    expect(read.seats[0]!.name).toBe('Player');
  });

  it('hands back a copy, so nothing odd in the input survives', () => {
    const input = { ...valid(), extra: 'ignored', moves: [{ i: 8, s: 0, note: 'x' }] };
    const read = parseReplay(input)!;
    expect(read).not.toHaveProperty('extra');
    expect(read.moves[0]).toEqual({ i: 8, s: 0 });
    expect(read.mines).not.toBe(input.mines);
  });
});

describe('buildReplay', () => {
  it('takes the mines from the server board, whatever the board is', () => {
    const board = createBoard({ rows: 6, cols: 6, bombCount: 11 }, createRng(5));
    const replay = buildReplay({
      rows: 6,
      cols: 6,
      bombs: board.bombs,
      seats: [{ name: 'Ann', bot: false }, { name: 'Bot', bot: true }],
      moves: [{ row: 0, col: 0, seat: 0 }, { row: 0, col: 1, seat: 1 }],
    });

    expect(replay.v).toBe(1);
    expect(replay.mineCount).toBe(11);
    expect(replay.mines).toHaveLength(11);
    for (const cell of replay.mines) expect(board.bombs[Math.floor(cell / 6)]![cell % 6]).toBe(true);
    expect(replay.moves).toEqual([{ i: 0, s: 0 }, { i: 1, s: 1 }]);
  });

  it('maps a row and column to a row-major cell index', () => {
    const bombs = [
      [false, false, false, true],
      [false, true, false, false],
    ];
    const replay = buildReplay({
      rows: 2,
      cols: 4,
      bombs,
      seats: [{ name: 'A', bot: false }, { name: 'B', bot: false }],
      moves: [{ row: 1, col: 2, seat: 1 }],
    });
    expect(replay.mines).toEqual([3, 5]);
    expect(replay.moves).toEqual([{ i: 6, s: 1 }]);
    expect(parseReplay(replay)).toEqual(replay);
  });

  it('stays far inside the database’s 100 kB check for the biggest game a room can play', () => {
    // 16 x 16, every cell but one a mine, all of them opened; the most seats, with the longest names.
    const size = 16;
    const bombs = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => row + col > 0));
    const seats = Array.from({ length: REPLAY_MAX_SEATS }, (_, n) => ({ name: `${n}`.padEnd(REPLAY_NAME_MAX, 'x'), bot: false }));
    const moves = Array.from({ length: size * size }, (_, i) => ({ row: Math.floor(i / size), col: i % size, seat: i % seats.length }));
    const replay = buildReplay({ rows: size, cols: size, bombs, seats, moves });

    expect(parseReplay(replay)).toEqual(replay);
    // jsonb is a little bigger than its text; a tenth of the limit leaves plenty of room.
    expect(JSON.stringify(replay).length).toBeLessThan(10_000);
  });
});

describe('replayAdjacency', () => {
  it('counts the mines around each cell', () => {
    // Mines at the top-left and the middle of a 3x3 board.
    expect(replayAdjacency({ rows: 3, cols: 3, mines: [0, 4] })).toEqual([1, 2, 1, 2, 1, 1, 1, 1, 1]);
  });

  it('does not count a cell itself, and stops at the edges', () => {
    expect(replayAdjacency({ rows: 1, cols: 3, mines: [1] })).toEqual([1, 0, 1]);
  });
});

describe('replayComplete', () => {
  it('is true only when every mine was found', () => {
    expect(replayComplete(valid())).toBe(true);
    expect(replayComplete(mutatedMoves([{ i: 0, s: 0 }]))).toBe(false);
    expect(replayComplete(mutatedMoves([]))).toBe(false);
  });
});

function mutatedMoves(moves: Replay['moves']): Replay {
  return { ...valid(), moves };
}
