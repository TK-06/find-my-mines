import { describe, expect, it } from 'vitest';
import { CLASSIC_PRESET, MAX_GRID, MAX_PLAYERS_LIMIT, MIN_GRID } from './config.js';
import { createBoard } from './engine/board.js';
import { createRng } from './engine/rng.js';
import { coerceRoomConfig, isRoomFull, validateRoomConfig } from './rooms.js';
import type { RoomConfig } from './types.js';

const classic = (): RoomConfig => ({ ...CLASSIC_PRESET });

describe('validateRoomConfig', () => {
  it('accepts the Classic preset, which is the graded configuration', () => {
    expect(validateRoomConfig(classic())).toEqual([]);
  });

  it('accepts an unlimited-player room', () => {
    expect(validateRoomConfig({ ...classic(), maxPlayers: null })).toEqual([]);
  });

  it('rejects a mine count equal to the cell count', () => {
    const errors = validateRoomConfig({ rows: 4, cols: 4, mineCount: 16, maxPlayers: 2 });
    expect(errors.join(' ')).toMatch(/less than 16/);
  });

  it('rejects a mine count above the cell count', () => {
    expect(validateRoomConfig({ rows: 4, cols: 4, mineCount: 99, maxPlayers: 2 })).not.toEqual([]);
  });

  it('accepts one fewer mine than there are cells', () => {
    expect(validateRoomConfig({ rows: 4, cols: 4, mineCount: 15, maxPlayers: 2 })).toEqual([]);
  });

  it('rejects zero mines', () => {
    expect(validateRoomConfig({ ...classic(), mineCount: 0 })).not.toEqual([]);
  });

  it('rejects a grid below the minimum', () => {
    expect(
      validateRoomConfig({ rows: MIN_GRID - 1, cols: 6, mineCount: 5, maxPlayers: 2 }),
    ).not.toEqual([]);
  });

  it('rejects a grid above the maximum', () => {
    expect(
      validateRoomConfig({ rows: MAX_GRID + 1, cols: 6, mineCount: 5, maxPlayers: 2 }),
    ).not.toEqual([]);
  });

  it('rejects non-integer dimensions', () => {
    expect(validateRoomConfig({ rows: 6.5, cols: 6, mineCount: 5, maxPlayers: 2 })).not.toEqual([]);
  });

  it('rejects a one-player room, since a match needs two', () => {
    expect(validateRoomConfig({ ...classic(), maxPlayers: 1 })).not.toEqual([]);
  });

  it('rejects a player limit above the ceiling', () => {
    expect(
      validateRoomConfig({ ...classic(), maxPlayers: MAX_PLAYERS_LIMIT + 1 }),
    ).not.toEqual([]);
  });

  it('reports every problem at once rather than only the first', () => {
    const errors = validateRoomConfig({ rows: 1, cols: 1, mineCount: 0, maxPlayers: 1 });
    expect(errors.length).toBeGreaterThan(1);
  });
});

describe('coerceRoomConfig', () => {
  it('falls back to Classic when fields are missing', () => {
    expect(coerceRoomConfig(undefined)).toEqual(classic());
  });

  it('preserves an explicit null maxPlayers as unlimited', () => {
    // null is meaningful (unlimited) and must not collapse into the default.
    expect(coerceRoomConfig({ maxPlayers: null }).maxPlayers).toBeNull();
  });

  it('coerces numeric strings sent by a form', () => {
    const config = coerceRoomConfig({ rows: '8', cols: '8', mineCount: '9' } as never);
    expect(config).toMatchObject({ rows: 8, cols: 8, mineCount: 9 });
  });
});

describe('isRoomFull', () => {
  it('is full when the seat limit is reached', () => {
    expect(isRoomFull({ ...classic(), maxPlayers: 2 }, 2)).toBe(true);
  });

  it('is not full below the limit', () => {
    expect(isRoomFull({ ...classic(), maxPlayers: 4 }, 3)).toBe(false);
  });

  it('is never full when unlimited', () => {
    expect(isRoomFull({ ...classic(), maxPlayers: null }, 500)).toBe(false);
  });
});

describe('custom boards', () => {
  it('honours a custom size and mine count', () => {
    const board = createBoard({ rows: 10, cols: 12, bombCount: 25 }, createRng(3));
    expect(board.rows).toBe(10);
    expect(board.cols).toBe(12);
    expect(board.bombs.flat().filter(Boolean)).toHaveLength(25);
  });

  it('places an exact mine count at the maximum grid size', () => {
    const board = createBoard({ rows: MAX_GRID, cols: MAX_GRID, bombCount: 60 }, createRng(9));
    expect(board.bombs.flat().filter(Boolean)).toHaveLength(60);
  });

  it('places an exact mine count at the minimum grid size', () => {
    const board = createBoard({ rows: MIN_GRID, cols: MIN_GRID, bombCount: 3 }, createRng(11));
    expect(board.bombs.flat().filter(Boolean)).toHaveLength(3);
  });
});
