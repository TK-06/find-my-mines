import { describe, expect, it } from 'vitest';
import { CLASSIC_PRESET, MAX_GRID, MAX_PLAYERS_LIMIT, MIN_GRID } from './config.js';
import { createBoard } from './engine/board.js';
import { createRng } from './engine/rng.js';
import {
  coerceRoomConfig,
  generateRoomId,
  isClassicConfig,
  isRoomFull,
  joinRequestError,
  listedRooms,
  parseRoomCode,
  validateRoomConfig,
} from './rooms.js';
import type { RoomConfig, RoomSummary } from './types.js';

const classic = (): RoomConfig => ({ ...CLASSIC_PRESET });

describe('validateRoomConfig', () => {
  it('accepts the Classic preset, which is the graded configuration', () => {
    expect(validateRoomConfig(classic())).toEqual([]);
  });

  it('accepts an unlimited-player room', () => {
    expect(validateRoomConfig({ ...classic(), maxPlayers: null })).toEqual([]);
  });

  it('rejects a mine count equal to the cell count', () => {
    const errors = validateRoomConfig({ rows: 4, cols: 4, mineCount: 16, maxPlayers: 2, mode: 'casual' });
    expect(errors.join(' ')).toMatch(/less than 16/);
  });

  it('rejects a mine count above the cell count', () => {
    expect(validateRoomConfig({ rows: 4, cols: 4, mineCount: 99, maxPlayers: 2, mode: 'casual' })).not.toEqual([]);
  });

  it('accepts one fewer mine than there are cells', () => {
    expect(validateRoomConfig({ rows: 4, cols: 4, mineCount: 15, maxPlayers: 2, mode: 'casual' })).toEqual([]);
  });

  it('rejects zero mines', () => {
    expect(validateRoomConfig({ ...classic(), mineCount: 0 })).not.toEqual([]);
  });

  it('rejects a grid below the minimum', () => {
    expect(
      validateRoomConfig({ rows: MIN_GRID - 1, cols: 6, mineCount: 5, maxPlayers: 2, mode: 'casual' }),
    ).not.toEqual([]);
  });

  it('rejects a grid above the maximum', () => {
    expect(
      validateRoomConfig({ rows: MAX_GRID + 1, cols: 6, mineCount: 5, maxPlayers: 2, mode: 'casual' }),
    ).not.toEqual([]);
  });

  it('rejects non-integer dimensions', () => {
    expect(validateRoomConfig({ rows: 6.5, cols: 6, mineCount: 5, maxPlayers: 2, mode: 'casual' })).not.toEqual([]);
  });

  it('rejects a one-player room, since a match needs two', () => {
    expect(validateRoomConfig({ ...classic(), maxPlayers: 1, mode: 'casual' })).not.toEqual([]);
  });

  it('rejects a player limit above the ceiling', () => {
    expect(
      validateRoomConfig({ ...classic(), maxPlayers: MAX_PLAYERS_LIMIT + 1 }),
    ).not.toEqual([]);
  });

  it('reports every problem at once rather than only the first', () => {
    const errors = validateRoomConfig({ rows: 1, cols: 1, mineCount: 0, maxPlayers: 1, mode: 'casual' });
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

describe('room mode', () => {
  it('defaults to casual so a room is never ranked by accident', () => {
    expect(coerceRoomConfig(undefined).mode).toBe('casual');
    expect(coerceRoomConfig({ rows: 6 }).mode).toBe('casual');
  });

  it('coerces an unrecognised mode to casual', () => {
    expect(coerceRoomConfig({ mode: 'competitive' } as never).mode).toBe('casual');
  });

  it('keeps an explicit ranked mode', () => {
    expect(coerceRoomConfig({ mode: 'ranked' }).mode).toBe('ranked');
  });

  it('rejects an invalid mode in validation', () => {
    expect(validateRoomConfig({ ...classic(), mode: 'nope' as never })).not.toEqual([]);
  });

  it('accepts both valid modes', () => {
    expect(validateRoomConfig({ ...classic(), mode: 'casual' })).toEqual([]);
    expect(validateRoomConfig({ ...classic(), mode: 'ranked' })).toEqual([]);
  });
});

describe('isClassicConfig', () => {
  it('recognises the graded 6×6, 11-mine, two-player board', () => {
    expect(isClassicConfig(classic())).toBe(true);
  });

  it('is Classic in either mode — the board is what the professor grades', () => {
    expect(isClassicConfig({ ...classic(), mode: 'ranked' })).toBe(true);
  });

  it('is not Classic with a different seat limit', () => {
    expect(isClassicConfig({ ...classic(), maxPlayers: 3 })).toBe(false);
    expect(isClassicConfig({ ...classic(), maxPlayers: null })).toBe(false);
  });

  it('is not Classic with a different board or mine count', () => {
    expect(isClassicConfig({ ...classic(), rows: 8 })).toBe(false);
    expect(isClassicConfig({ ...classic(), mineCount: 10 })).toBe(false);
  });
});

describe('join by request', () => {
  it('defaults to open, so existing callers keep joining directly', () => {
    expect(coerceRoomConfig({ rows: 8, cols: 8, mineCount: 10 }).joinByRequest).toBe(false);
  });

  it('keeps ask-to-join on a Custom board', () => {
    expect(coerceRoomConfig({ rows: 8, cols: 8, mineCount: 10, joinByRequest: true }).joinByRequest).toBe(true);
  });

  it('forces Classic open, whatever the client sent — Classic is the original rules', () => {
    expect(coerceRoomConfig({ ...classic(), joinByRequest: true }).joinByRequest).toBe(false);
  });
});

describe('private rooms', () => {
  const custom = { rows: 8, cols: 8, mineCount: 10 };

  it('is listed by default, so existing callers keep appearing in the game list', () => {
    expect(coerceRoomConfig(custom).private).toBeUndefined();
    expect(coerceRoomConfig(undefined).private).toBeUndefined();
  });

  it('keeps a Custom room private when asked', () => {
    expect(coerceRoomConfig({ ...custom, private: true }).private).toBe(true);
  });

  it('forces Classic listed, whatever the client sent — Classic is the original rules', () => {
    expect(coerceRoomConfig({ ...classic(), private: true }).private).toBeUndefined();
    expect(coerceRoomConfig({ ...classic(), mode: 'ranked', private: true }).private).toBeUndefined();
  });

  it('treats anything but a literal true as listed', () => {
    for (const value of ['yes', 'true', 1, {}, [], null, false]) {
      expect(coerceRoomConfig({ ...custom, private: value } as never).private).toBeUndefined();
    }
  });

  it('keeps private and ask-to-join independent of each other', () => {
    expect(coerceRoomConfig({ ...custom, private: true, joinByRequest: true })).toMatchObject({
      private: true,
      joinByRequest: true,
    });
    expect(coerceRoomConfig({ ...custom, private: true, joinByRequest: false })).toMatchObject({
      private: true,
      joinByRequest: false,
    });
  });

  it('passes validation — being private is not a board setting', () => {
    expect(validateRoomConfig(coerceRoomConfig({ ...custom, private: true }))).toEqual([]);
  });
});

describe('listedRooms', () => {
  const summary = (id: string, config: Partial<RoomConfig> = {}): RoomSummary => ({
    id,
    name: `Room ${id}`,
    hostNickname: 'Host',
    config: { ...classic(), ...config },
    playerCount: 1,
    spectatorCount: 0,
    status: 'waiting',
    createdAt: 0,
    joinable: true,
  });

  it('leaves private rooms out of the game list', () => {
    const list = [summary('OPEN'), summary('HIDE', { rows: 8, private: true }), summary('ASKS', { joinByRequest: true })];
    expect(listedRooms(list).map((r) => r.id)).toEqual(['OPEN', 'ASKS']);
  });

  it('keeps every room that is not explicitly private, in order', () => {
    const list = [summary('B'), summary('A', { private: false })];
    expect(listedRooms(list).map((r) => r.id)).toEqual(['B', 'A']);
  });
});

describe('parseRoomCode', () => {
  it('upper-cases a typed code — codes are case-insensitive', () => {
    expect(parseRoomCode('abcd')).toBe('ABCD');
    expect(parseRoomCode('Ab3D')).toBe('AB3D');
  });

  it('ignores spaces around and inside the code', () => {
    expect(parseRoomCode('  ABCD ')).toBe('ABCD');
    expect(parseRoomCode('AB CD')).toBe('ABCD');
  });

  it('takes the code out of a pasted share link', () => {
    expect(parseRoomCode('https://findmymines.example/join/abcd')).toBe('ABCD');
    expect(parseRoomCode('http://localhost:5173/join/WXYZ/')).toBe('WXYZ');
    expect(parseRoomCode('/join/q7k2')).toBe('Q7K2');
  });

  it('refuses anything that cannot be a room code', () => {
    for (const input of ['', '   ', 'ABC', 'ABCDE', 'AB-D', 'AB_D', 'ÄBCD', '/join/', '/join/ABCDE']) {
      expect(parseRoomCode(input)).toBeNull();
    }
  });

  it('refuses a value that is not text at all', () => {
    for (const input of [undefined, null, 1234, {}, []]) expect(parseRoomCode(input)).toBeNull();
  });

  it('accepts every code the server hands out', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateRoomId(() => false);
      expect(parseRoomCode(id.toLowerCase())).toBe(id);
    }
  });
});

describe('joinRequestError', () => {
  const ok = {
    joinByRequest: true,
    alreadyMember: false,
    alreadyRequested: false,
    banned: false,
    full: false,
  };

  it('accepts a request to an ask-to-join room with a free seat', () => {
    expect(joinRequestError(ok)).toBeNull();
  });

  it('refuses a request to an open room — just join it', () => {
    expect(joinRequestError({ ...ok, joinByRequest: false })).toMatch(/open/i);
  });

  it('refuses someone already in the room', () => {
    expect(joinRequestError({ ...ok, alreadyMember: true })).toMatch(/already in/i);
  });

  it('refuses someone the host banned from the room', () => {
    expect(joinRequestError({ ...ok, banned: true })).toMatch(/banned/i);
  });

  it('refuses when every seat is taken', () => {
    expect(joinRequestError({ ...ok, full: true })).toMatch(/full/i);
  });

  it('refuses a duplicate request', () => {
    expect(joinRequestError({ ...ok, alreadyRequested: true })).toMatch(/already asked/i);
  });
});
