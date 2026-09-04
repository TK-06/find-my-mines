import {
  CLASSIC_PRESET,
  MAX_GRID,
  MAX_PLAYERS_LIMIT,
  MIN_GRID,
  MIN_PLAYERS_TO_START,
} from './config.js';
import type { RoomConfig } from './types.js';

export type ConfigError = string;

/**
 * Validates a room configuration.
 *
 * Pure and shared: the server runs it before creating a room (never trust a
 * client), and the create-game form runs the same function so the user sees the
 * same message without a round trip.
 */
export function validateRoomConfig(config: RoomConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  const { rows, cols, mineCount, maxPlayers } = config;

  for (const [label, value] of [
    ['Rows', rows],
    ['Columns', cols],
  ] as const) {
    if (!Number.isInteger(value) || value < MIN_GRID || value > MAX_GRID) {
      errors.push(`${label} must be a whole number between ${MIN_GRID} and ${MAX_GRID}.`);
    }
  }

  const cells = rows * cols;
  if (!Number.isInteger(mineCount) || mineCount < 1) {
    errors.push('Mine count must be at least 1.');
  } else if (Number.isInteger(rows) && Number.isInteger(cols) && mineCount >= cells) {
    // At least one empty slot must remain, otherwise there is nothing to
    // reveal an adjacency count on and the board is a degenerate sweep.
    errors.push(`Mine count must be less than ${cells} for a ${rows}x${cols} board.`);
  }

  if (maxPlayers !== null) {
    if (!Number.isInteger(maxPlayers) || maxPlayers < MIN_PLAYERS_TO_START) {
      errors.push(`Player limit must be at least ${MIN_PLAYERS_TO_START}, or unlimited.`);
    } else if (maxPlayers > MAX_PLAYERS_LIMIT) {
      errors.push(`Player limit cannot exceed ${MAX_PLAYERS_LIMIT}.`);
    }
  }

  if (config.mode !== 'casual' && config.mode !== 'ranked') {
    errors.push('Mode must be either casual or ranked.');
  }

  return errors;
}

/** Normalises untrusted input into a RoomConfig, falling back to Classic values. */
export function coerceRoomConfig(input: Partial<RoomConfig> | undefined): RoomConfig {
  return {
    rows: Number(input?.rows ?? CLASSIC_PRESET.rows),
    cols: Number(input?.cols ?? CLASSIC_PRESET.cols),
    mineCount: Number(input?.mineCount ?? CLASSIC_PRESET.mineCount),
    // null is meaningful here (unlimited), so it must not collapse into the
    // "missing, use Classic" case.
    maxPlayers:
      input?.maxPlayers === undefined
        ? CLASSIC_PRESET.maxPlayers
        : input.maxPlayers === null
          ? null
          : Number(input.maxPlayers),
    // Anything unrecognised falls back to casual: a room should never become
    // ranked by accident.
    mode: input?.mode === 'ranked' ? 'ranked' : 'casual',
  };
}

/** True when the room's seats are all taken. Unlimited rooms are never full. */
export function isRoomFull(config: RoomConfig, playerCount: number): boolean {
  return config.maxPlayers !== null && playerCount >= config.maxPlayers;
}

/** Short, unambiguous room code. Excludes easily-confused characters. */
export function generateRoomId(exists: (id: string) => boolean): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 1000; attempt++) {
    let id = '';
    for (let i = 0; i < 4; i++) {
      id += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!exists(id)) return id;
  }
  throw new Error('Could not allocate a room id');
}
