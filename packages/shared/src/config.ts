/**
 * Single source of truth for game + network configuration.
 *
 * ─── SERVER ADDRESS ────────────────────────────────────────────────────────
 * Assignment requirement:
 *   "Assume each client game knows the server's address and port. Game clients
 *    do not need to enter the IP address or port number. The server's IP
 *    address and port must be set in the program's source code."
 *
 * Clients NEVER prompt for a host or port — they read the constants below.
 * To deploy on AWS, change SERVER_HOST to your EC2 instance's public IP.
 * ───────────────────────────────────────────────────────────────────────────
 */
export const SERVER_HOST = 'localhost';
export const SERVER_PORT = 3000;
export const SERVER_URL = `http://${SERVER_HOST}:${SERVER_PORT}`;

/** Board dimensions. Parameterised so the future "custom map size" mode is a config change. */
export const GRID_ROWS = 6;
export const GRID_COLS = 6;

/** Spec: "The server randomly places 11 bombs on a 6x6 grid." */
export const BOMB_COUNT = 11;

/** Spec: "Each player has 10 seconds per turn to find bombs." */
export const TURN_SECONDS = 10;

/**
 * Spec: "If a bomb is found, the player continues their turn until time runs
 * out; otherwise, the turn passes to another player."
 *
 * Read literally, the countdown is NOT restarted when a bomb is hit — the
 * player simply keeps picking inside the same 10-second window.
 *
 * Set this to `true` if your instructor reads it as "each bomb grants a fresh
 * 10 seconds" instead. That is the only change required.
 */
export const BOMB_RESETS_TIMER = false;

/**
 * Default seat count. Rooms now carry their own `maxPlayers`, so this is only
 * the Classic value — see CLASSIC_PRESET below.
 */
export const MAX_PLAYERS = 2;

/**
 * The graded configuration, exactly as the assignment specifies it: a 6x6 grid,
 * 11 mines, two players. This is the default in the create-game form so the
 * spec behaviour is what a grader sees without touching any setting.
 */
export const CLASSIC_PRESET = {
  rows: GRID_ROWS,
  cols: GRID_COLS,
  mineCount: BOMB_COUNT,
  maxPlayers: MAX_PLAYERS as number | null,
} as const;

/** Bounds for custom rooms. Keeps boards renderable and matches winnable. */
export const MIN_GRID = 4;
export const MAX_GRID = 16;

/** A match needs at least two players, whatever the room's limit is. */
export const MIN_PLAYERS_TO_START = 2;

/** Hard ceiling for a fixed-size room. `null` maxPlayers means unlimited. */
export const MAX_PLAYERS_LIMIT = 12;

/** Socket.IO namespace used by the server's own admin console. */
export const ADMIN_NAMESPACE = '/admin';
