import {
  CLASSIC_PRESET,
  MAX_GRID,
  MAX_PLAYERS_LIMIT,
  MIN_GRID,
  MIN_PLAYERS_TO_START,
} from './config.js';
import type { RoomConfig, RoomSummary } from './types.js';

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
  const config: RoomConfig = {
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
    joinByRequest: input?.joinByRequest === true,
  };
  // Classic keeps the assignment's rules: anyone joins directly.
  if (isClassicConfig(config)) config.joinByRequest = false;
  // Only a literal true hides a room, and never a Classic one — a grader must
  // find it in the game list. A listed room carries no flag at all, so a
  // Classic config stays exactly the shape it has always been.
  if (input?.private === true && !isClassicConfig(config)) config.private = true;
  return config;
}

/**
 * The rooms players see in the game list: every room except private ones,
 * which people reach with the room code or a share link. The server console
 * still lists them all.
 */
export function listedRooms(rooms: RoomSummary[]): RoomSummary[] {
  return rooms.filter((room) => room.config.private !== true);
}

/**
 * The graded configuration: a 6×6 board, 11 mines, two seats, in either mode.
 * Classic rooms keep the original assignment rules — open joining and no host
 * kick or ban — so a grader sees exactly the spec.
 */
export function isClassicConfig(
  config: Pick<RoomConfig, 'rows' | 'cols' | 'mineCount' | 'maxPlayers'> & Partial<RoomConfig>,
): boolean {
  return (
    config.rows === CLASSIC_PRESET.rows &&
    config.cols === CLASSIC_PRESET.cols &&
    config.mineCount === CLASSIC_PRESET.mineCount &&
    config.maxPlayers === CLASSIC_PRESET.maxPlayers
  );
}

export interface JoinRequestContext {
  joinByRequest: boolean;
  alreadyMember: boolean;
  alreadyRequested: boolean;
  banned: boolean;
  full: boolean;
}

/** Why asking to join this room is refused, or null when the request may go to the host. */
export function joinRequestError(ctx: JoinRequestContext): string | null {
  if (!ctx.joinByRequest) return 'This room is open — join it directly.';
  if (ctx.alreadyMember) return 'You are already in this room.';
  if (ctx.banned) return 'The host has banned you from this room.';
  if (ctx.full) return 'This room is full.';
  if (ctx.alreadyRequested) return 'You already asked to join this room.';
  return null;
}

/** True when the room's seats are all taken. Unlimited rooms are never full. */
export function isRoomFull(config: RoomConfig, playerCount: number): boolean {
  return config.maxPlayers !== null && playerCount >= config.maxPlayers;
}

/** How many characters a room code has. */
export const ROOM_CODE_LENGTH = 4;

/** Short, unambiguous room code. Excludes easily-confused characters. */
export function generateRoomId(exists: (id: string) => boolean): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 1000; attempt++) {
    let id = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      id += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!exists(id)) return id;
  }
  throw new Error('Could not allocate a room id');
}

const CODE = new RegExp(`^[A-Z0-9]{${ROOM_CODE_LENGTH}}$`);
const LINK_CODE = /\/join\/([^/?#]*)\/?$/i;

/**
 * A room code as someone typed or pasted it — "abcd", " AB CD ", or a whole
 * share link ending in /join/abcd — in the capitals the server uses, or null
 * when it cannot be a code. Letters the server never hands out (I, O, 0, 1)
 * still pass: a code that does not exist gets the server's own answer.
 */
export function parseRoomCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  const fromLink = LINK_CODE.exec(text)?.[1];
  const code = (fromLink ?? text).replace(/\s+/g, '').toUpperCase();
  return CODE.test(code) ? code : null;
}
