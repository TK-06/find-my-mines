import {
  AI_DEFAULT_DENSITY,
  AI_DEFAULT_SIZE,
  AI_DENSITY_RATIO,
  AI_MODEL_NAME,
  aiBoard,
  isAiBoardSize,
  isAiDensity,
  isAiLevel,
  isAiModel,
  type AiAbout,
  type AiDensity,
  type AiLevel,
  type AiModel,
  type CellRef,
  type PlayerPublic,
  type PublicMatchState,
} from '@fmm/shared';

/**
 * Pure rules for games against the computer, as the client shows them: the
 * card's words and remembered choice, when the Hint button is offered, and
 * when a hint on the board has stopped meaning anything. The server decides
 * every outcome — including whether a hint is given at all — this only
 * decides what to show.
 */

/** The difficulty buttons. */
export const AI_LEVEL_COPY: Record<AiLevel, { label: string; note: string }> = {
  easy: { label: 'Easy', note: 'Makes plenty of mistakes' },
  medium: { label: 'Medium', note: 'Makes some mistakes' },
  hard: { label: 'Hard', note: 'Makes almost none' },
};

/** The opponent tiles: a short note each. JEV's changes when this server cannot play it. */
export const AI_MODEL_COPY: Record<AiModel, { note: string }> = {
  ai: { note: 'Reads the board and chats' },
  fly: { note: '244 real neurons' },
  jev: { note: 'Fast multiple-choice' },
};

/** What JEV's tile says, and what picking it says, on a server that has no JEV key. */
export const JEV_UNAVAILABLE_NOTE = 'Not set up here';
export const JEV_UNAVAILABLE = 'JEV isn’t set up on this server.';

/**
 * What the server said about its opponents: the answer, null when it could not
 * be had, or 'checking' while the question is out.
 */
export type AboutState = AiAbout | null | 'checking';

/**
 * Whether this server can play an opponent. Only JEV depends on the server (it
 * needs a key); and until the server has answered, or if it never does, JEV
 * counts as unavailable rather than letting someone start a game that fails.
 */
export function isModelAvailable(model: AiModel, about: AboutState): boolean {
  if (model !== 'jev') return true;
  return about !== 'checking' && about !== null && about.jev !== null;
}

/**
 * The opponent to show and to play: the remembered one, unless it cannot be
 * played here (a remembered JEV on a server without a key), then the AI.
 */
export function playableModel(model: AiModel, about: AboutState): AiModel {
  return isModelAvailable(model, about) ? model : 'ai';
}

/** The note under an opponent's name on its tile. */
export function opponentNote(model: AiModel, about: AboutState): string {
  return isModelAvailable(model, about) ? AI_MODEL_COPY[model].note : JEV_UNAVAILABLE_NOTE;
}

/** The mine-density buttons; the share of mines shows beside each. */
export const AI_DENSITY_LABEL: Record<AiDensity, string> = {
  light: 'Light',
  classic: 'Classic',
  heavy: 'Heavy',
};

/** "20%": what share of the cells are mines at this density (Classic rounds to 31%). */
export function densityPercent(density: AiDensity): string {
  return `${Math.round(AI_DENSITY_RATIO[density] * 100)}%`;
}

/** Everything the lobby card lets the player choose. */
export interface AiSetup {
  level: AiLevel;
  model: AiModel;
  size: number;
  density: AiDensity;
}

export const DEFAULT_AI_SETUP: AiSetup = {
  level: 'medium',
  model: 'ai',
  size: AI_DEFAULT_SIZE,
  density: AI_DEFAULT_DENSITY,
};

/** "10×10 · 40 mines", and on the default board, where it comes from. */
export function boardSummary(size: number, density: AiDensity): string {
  const { rows, cols, mineCount } = aiBoard(size, density);
  const text = `${rows}×${cols} · ${mineCount} mines`;
  return size === AI_DEFAULT_SIZE && density === AI_DEFAULT_DENSITY
    ? `${text} — the Classic board from the assignment`
    : text;
}

/** The Play button: "Play Fruit Fly · Hard". */
export function playLabel(model: AiModel, level: AiLevel): string {
  return `Play ${AI_MODEL_NAME[model]} · ${AI_LEVEL_COPY[level].label}`;
}

const STORAGE_KEY = 'fmm.aiSetup';

/**
 * A remembered setup read back from storage. Every field is checked on its
 * own, so one stale or hand-edited value falls back to its default without
 * losing the rest. JEV is remembered like any opponent: whether this server can
 * play it is only known once it has answered, so the card falls back to the AI
 * for display and play with `playableModel` until then.
 */
export function parseAiSetup(raw: string | null): AiSetup {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON: start from the defaults.
  }
  return {
    level: isAiLevel(data.level) ? data.level : DEFAULT_AI_SETUP.level,
    model: isAiModel(data.model) ? data.model : DEFAULT_AI_SETUP.model,
    size: isAiBoardSize(data.size) ? data.size : DEFAULT_AI_SETUP.size,
    density: isAiDensity(data.density) ? data.density : DEFAULT_AI_SETUP.density,
  };
}

/** The last choice, if storage works and has one; the defaults otherwise. */
export function loadAiSetup(): AiSetup {
  try {
    return parseAiSetup(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_AI_SETUP;
  }
}

/** Remembered for next time. Best effort: a blocked or full store just forgets. */
export function saveAiSetup(setup: AiSetup): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(setup));
  } catch {
    // Private window or storage blocked: the card still works, it just starts fresh next time.
  }
}

/**
 * The Fruit Fly's short line under the opponent row: the wiring is a fly's,
 * the choosing mostly isn't, and it is handed the solver's odds. Difficulty
 * works as it does for the AI.
 */
export const FLY_EXPLAINER =
  'It sees only the open board around each cell — no solver — and those signals pass through a few hundred ' +
  'neurons wired like a real fruit fly’s smell-learning centre, with a small trained readout on top. On Hard it ' +
  'takes the cell it wants most; on Easy it is sleepier and picks more loosely.';

/**
 * The data's licence (CC BY 4.0) asks for the creators, the licence and a link
 * to it wherever the circuit is used. Same credit as circuit.json's provenance.
 */
export const FLY_CREDIT = {
  text: 'Brain wiring: male fruit fly connectome (MaleCNS) — Janelia FlyEM, University of Cambridge, MRC LMB and Google Research',
  href: 'https://male-cns.janelia.org',
  license: 'CC BY 4.0',
  licenseHref: 'https://creativecommons.org/licenses/by/4.0/',
} as const;

/** A computer opponent's seat: unrated, so it shows no Elo. */
export function isBotSeat(player: Pick<PlayerPublic, 'bot'>): boolean {
  return player.bot !== undefined;
}

/**
 * Hints are for the person playing the computer, on their own turn. Anyone
 * watching, and every room a person made or matchmaking found, gets none.
 */
export function canAskHint(state: PublicMatchState | null, myId: string | null): boolean {
  if (!state || myId === null) return false;
  return (
    state.origin === 'ai' &&
    state.status === 'playing' &&
    state.currentPlayerId === myId &&
    state.players.some((p) => p.id === myId)
  );
}

/**
 * A hint on the board lasts until its cell is opened or the turn passes. The
 * caller clears it for good the first time this says no, so it does not come
 * back when the turn does.
 */
export function hintVisible(
  hint: CellRef | null,
  state: PublicMatchState | null,
  myId: string | null,
): boolean {
  if (!hint || !canAskHint(state, myId)) return false;
  return !state!.revealed.some((cell) => cell.row === hint.row && cell.col === hint.col);
}

/**
 * Whether `next` is the first look at a match that `prev` was not: the room's
 * first playing snapshot, a start or rematch, or the board cleared under a
 * running match. Hints are counted per match, so this resets the count.
 */
export function isNewMatch(prev: PublicMatchState | null, next: PublicMatchState): boolean {
  if (next.status !== 'playing') return false;
  if (!prev || prev.roomId !== next.roomId || prev.status !== 'playing') return true;
  return next.revealed.length < prev.revealed.length;
}

export function hintButtonLabel(hintsLeft: number): string {
  return hintsLeft > 0 ? `Hint (${hintsLeft} left)` : 'No hints left';
}
