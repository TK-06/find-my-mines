import { describe, expect, it } from 'vitest';
import { AI_LEVELS, AI_MODELS, type PlayerPublic, type PublicMatchState, type RevealedCell } from '@fmm/shared';
import {
  AI_DENSITY_LABEL,
  AI_LEVEL_COPY,
  AI_MODEL_COPY,
  DEFAULT_AI_SETUP,
  FLY_CREDIT,
  FLY_EXPLAINER,
  JEV_UNAVAILABLE,
  JEV_UNAVAILABLE_NOTE,
  applyHintWhy,
  boardSummary,
  canAskHint,
  densityPercent,
  hintButtonLabel,
  hintVisible,
  isModelAvailable,
  isNewMatch,
  isBotSeat,
  opponentNote,
  parseAiSetup,
  playLabel,
  playableModel,
  type AboutState,
} from './aiPlay.js';

const ME = 'me';
const BOT = 'bot-1';

const player = (id: string, over: Partial<PlayerPublic> = {}): PlayerPublic => ({
  id,
  nickname: id,
  score: 0,
  totalScore: 0,
  connected: true,
  elo: 800,
  isGuest: true,
  ...over,
});

const revealedAt = (row: number, col: number): RevealedCell => ({
  row,
  col,
  kind: 'empty',
  adjacent: 1,
  byPlayerId: ME,
});

/** A game against the computer, on my turn, nothing opened yet. */
const aiState = (over: Partial<PublicMatchState> = {}): PublicMatchState => ({
  roomId: 'AI01',
  roomName: 'vs AI',
  hostId: ME,
  config: { rows: 6, cols: 6, mineCount: 11, maxPlayers: 2, mode: 'casual' },
  origin: 'ai',
  status: 'playing',
  rows: 6,
  cols: 6,
  bombCount: 11,
  bombsFound: 0,
  players: [player(ME), player(BOT, { nickname: 'AI · Hard', bot: { level: 'hard', model: 'ai' } })],
  spectatorCount: 0,
  spectators: [],
  joinRequests: [],
  currentPlayerId: ME,
  secondsLeft: 10,
  revealed: [],
  winnerId: null,
  rematchVotes: [],
  ...over,
});

const jevHere: AboutState = { llm: null, jev: { provider: 'typesafe', model: 'jev-1' } };
const noJev: AboutState = { llm: null, jev: null };

describe('AI_LEVEL_COPY', () => {
  it('names and describes every level, easiest first', () => {
    expect(AI_LEVELS.map((level) => AI_LEVEL_COPY[level].label)).toEqual(['Easy', 'Medium', 'Hard']);
    for (const level of AI_LEVELS) expect(AI_LEVEL_COPY[level].note.length).toBeGreaterThan(0);
  });
});

describe('opponent copy', () => {
  it('has a note for every opponent, and JEV’s changes when the server cannot play it', () => {
    for (const model of AI_MODELS) expect(AI_MODEL_COPY[model].note.length).toBeGreaterThan(0);
    expect(JEV_UNAVAILABLE).toBe('JEV isn’t set up on this server.');
    expect(opponentNote('jev', jevHere)).toBe(AI_MODEL_COPY.jev.note);
    expect(opponentNote('jev', noJev)).toBe(JEV_UNAVAILABLE_NOTE);
    expect(opponentNote('fly', noJev)).toBe(AI_MODEL_COPY.fly.note);
  });

  it('labels the densities with their share of the cells', () => {
    expect(AI_DENSITY_LABEL.classic).toBe('Classic');
    expect(densityPercent('light')).toBe('20%');
    expect(densityPercent('classic')).toBe('31%');
    expect(densityPercent('heavy')).toBe('40%');
  });
});

describe('Fruit Fly copy', () => {
  it('says the fly reads the open board itself, with no solver, through a trained readout', () => {
    expect(FLY_EXPLAINER).toMatch(/fly/i);
    expect(FLY_EXPLAINER).toMatch(/no solver/i);
    expect(FLY_EXPLAINER).toMatch(/trained readout/i);
    expect(FLY_EXPLAINER).not.toMatch(/solver’s odds/i);
  });

  it('explains difficulty as how sleepy the fly is, not as handed-in mistakes', () => {
    expect(FLY_EXPLAINER).not.toMatch(/as well as Hard/i);
    expect(FLY_EXPLAINER).toMatch(/sleepier/i);
    expect(FLY_EXPLAINER).not.toMatch(/difficulty works as it does for the AI/i);
  });

  it('credits the connectome’s creators under CC BY 4.0 and links to the data and the licence', () => {
    expect(FLY_CREDIT.text).toBe(
      'Brain wiring: male fruit fly connectome (MaleCNS) — Janelia FlyEM, University of Cambridge, MRC LMB and Google Research',
    );
    expect(FLY_CREDIT.href).toBe('https://male-cns.janelia.org');
    expect(FLY_CREDIT.license).toBe('CC BY 4.0');
    expect(FLY_CREDIT.licenseHref).toBe('https://creativecommons.org/licenses/by/4.0/');
  });
});

describe('boardSummary', () => {
  it('gives the side and the mine count', () => {
    expect(boardSummary(10, 'heavy')).toBe('10×10 · 40 mines');
    expect(boardSummary(16, 'light')).toBe('16×16 · 51 mines');
    expect(boardSummary(6, 'heavy')).toBe('6×6 · 14 mines');
  });

  it('says where the default board comes from', () => {
    expect(boardSummary(6, 'classic')).toBe('6×6 · 11 mines — the Classic board from the assignment');
    // Only that exact board is the assignment's.
    expect(boardSummary(8, 'classic')).not.toMatch(/assignment/);
  });
});

describe('playLabel', () => {
  it('names the opponent and the level', () => {
    expect(playLabel('ai', 'medium')).toBe('Play AI · Medium');
    expect(playLabel('fly', 'hard')).toBe('Play Fruit Fly · Hard');
  });
});

describe('parseAiSetup', () => {
  it('starts on the AI, Medium, the Classic 6×6 board', () => {
    expect(DEFAULT_AI_SETUP).toEqual({ level: 'medium', model: 'ai', size: 6, density: 'classic' });
    expect(parseAiSetup(null)).toEqual(DEFAULT_AI_SETUP);
  });

  it('reads back what was stored', () => {
    const setup = { level: 'hard', model: 'fly', size: 12, density: 'heavy' };
    expect(parseAiSetup(JSON.stringify(setup))).toEqual(setup);
  });

  it('falls back per field, keeping the valid ones', () => {
    const raw = JSON.stringify({ level: 'fly', model: 'fly', size: 7, density: 'heavy' });
    expect(parseAiSetup(raw)).toEqual({ level: 'medium', model: 'fly', size: 6, density: 'heavy' });
  });

  it('restores JEV like any opponent, and nothing that is not one', () => {
    expect(parseAiSetup(JSON.stringify({ model: 'jev' })).model).toBe('jev');
    expect(parseAiSetup(JSON.stringify({ level: 'hard', model: 'jev', size: 8, density: 'light' }))).toEqual({
      level: 'hard',
      model: 'jev',
      size: 8,
      density: 'light',
    });
    for (const model of ['nope', 'JEV', '', 3, null]) {
      expect(parseAiSetup(JSON.stringify({ model })).model).toBe('ai');
    }
  });

  it('shrugs off anything that is not a stored setup', () => {
    for (const raw of ['', '{', 'null', '[]', '"hard"', '42']) {
      expect(parseAiSetup(raw)).toEqual(DEFAULT_AI_SETUP);
    }
  });
});

describe('JEV availability', () => {
  it('is playable only once the server has said it has a JEV key', () => {
    expect(isModelAvailable('jev', jevHere)).toBe(true);
    expect(isModelAvailable('jev', noJev)).toBe(false);
  });

  it('stays unavailable while checking and when the check failed', () => {
    expect(isModelAvailable('jev', 'checking')).toBe(false);
    expect(isModelAvailable('jev', null)).toBe(false);
  });

  it('never depends on the server for the AI or the Fruit Fly', () => {
    for (const state of ['checking', null, noJev, jevHere] as AboutState[]) {
      expect(isModelAvailable('ai', state)).toBe(true);
      expect(isModelAvailable('fly', state)).toBe(true);
    }
  });

  it('plays the AI instead of a remembered JEV that cannot be played here', () => {
    expect(playableModel('jev', 'checking')).toBe('ai');
    expect(playableModel('jev', null)).toBe('ai');
    expect(playableModel('jev', noJev)).toBe('ai');
    expect(playableModel('jev', jevHere)).toBe('jev');
    expect(playableModel('fly', noJev)).toBe('fly');
  });
});

describe('isBotSeat', () => {
  it('is true only for a seat the server marked as a computer', () => {
    expect(isBotSeat(player(BOT, { bot: { level: 'easy', model: 'fly' } }))).toBe(true);
    expect(isBotSeat(player(ME))).toBe(false);
  });
});

describe('canAskHint', () => {
  it('is true in a game against the computer, seated, playing, on my turn', () => {
    expect(canAskHint(aiState(), ME)).toBe(true);
  });

  it('is false in any room a person made or matchmaking found', () => {
    expect(canAskHint(aiState({ origin: 'created' }), ME)).toBe(false);
    expect(canAskHint(aiState({ origin: 'matchmaking' }), ME)).toBe(false);
  });

  it('is false while the computer has the turn', () => {
    expect(canAskHint(aiState({ currentPlayerId: BOT }), ME)).toBe(false);
  });

  it('is false before the match starts and after it ends', () => {
    expect(canAskHint(aiState({ status: 'waiting' }), ME)).toBe(false);
    expect(canAskHint(aiState({ status: 'ended' }), ME)).toBe(false);
  });

  it('is false for someone watching, even if the ids lined up', () => {
    expect(canAskHint(aiState({ currentPlayerId: 'watcher' }), 'watcher')).toBe(false);
  });

  it('is false with no room or no identity', () => {
    expect(canAskHint(null, ME)).toBe(false);
    expect(canAskHint(aiState(), null)).toBe(false);
  });
});

describe('hintVisible', () => {
  const hint = { row: 2, col: 3 };

  it('shows a hint on my turn while its cell is covered', () => {
    expect(hintVisible(hint, aiState(), ME)).toBe(true);
    expect(hintVisible(hint, aiState({ revealed: [revealedAt(0, 0)] }), ME)).toBe(true);
  });

  it('drops it once that cell is opened', () => {
    expect(hintVisible(hint, aiState({ revealed: [revealedAt(2, 3)] }), ME)).toBe(false);
  });

  it('drops it once the turn passes', () => {
    expect(hintVisible(hint, aiState({ currentPlayerId: BOT }), ME)).toBe(false);
  });

  it('drops it when the match ends or the room goes', () => {
    expect(hintVisible(hint, aiState({ status: 'ended' }), ME)).toBe(false);
    expect(hintVisible(hint, null, ME)).toBe(false);
  });

  it('shows nothing without a hint', () => {
    expect(hintVisible(null, aiState(), ME)).toBe(false);
  });
});

describe('isNewMatch', () => {
  it('is true for the first playing snapshot of a room', () => {
    expect(isNewMatch(null, aiState())).toBe(true);
  });

  it('is true when the match starts or a rematch begins', () => {
    expect(isNewMatch(aiState({ status: 'waiting' }), aiState())).toBe(true);
    expect(isNewMatch(aiState({ status: 'ended' }), aiState())).toBe(true);
  });

  it('is true in a different room', () => {
    expect(isNewMatch(aiState({ roomId: 'OLD1' }), aiState())).toBe(true);
  });

  it('is true when the board was cleared under a running match', () => {
    const before = aiState({ revealed: [revealedAt(0, 0), revealedAt(0, 1)] });
    expect(isNewMatch(before, aiState({ revealed: [] }))).toBe(true);
  });

  it('is false for the same match moving on', () => {
    const before = aiState();
    expect(isNewMatch(before, aiState({ secondsLeft: 7 }))).toBe(false);
    expect(isNewMatch(before, aiState({ revealed: [revealedAt(1, 1)], currentPlayerId: BOT }))).toBe(
      false,
    );
  });

  it('is false while nothing is being played', () => {
    expect(isNewMatch(null, aiState({ status: 'waiting' }))).toBe(false);
    expect(isNewMatch(aiState(), aiState({ status: 'ended' }))).toBe(false);
  });
});

describe('hintButtonLabel', () => {
  it('counts what is left, and says so when nothing is', () => {
    expect(hintButtonLabel(3)).toBe('Hint (3 left)');
    expect(hintButtonLabel(1)).toBe('Hint (1 left)');
    expect(hintButtonLabel(0)).toBe('No hints left');
    expect(hintButtonLabel(-1)).toBe('No hints left');
  });
});

describe('applyHintWhy', () => {
  const hint = { row: 2, col: 3, text: 'C4 must be a mine', why: 'The plain reason.', id: 4 };

  it('swaps in the reworded explanation for the hint on screen, keeping the rest of it', () => {
    expect(applyHintWhy(hint, { row: 2, col: 3, why: 'A friendlier reason.' })).toEqual({
      ...hint,
      why: 'A friendlier reason.',
    });
  });

  it('also fills in a hint that had no explanation of its own', () => {
    expect(applyHintWhy({ ...hint, why: null }, { row: 2, col: 3, why: 'Here is why.' })?.why).toBe('Here is why.');
  });

  it('ignores one for another cell — an older hint, or one that is gone', () => {
    expect(applyHintWhy(hint, { row: 2, col: 4, why: 'Not this one.' })).toBe(hint);
    expect(applyHintWhy(hint, { row: 0, col: 3, why: 'Not this one.' })).toBe(hint);
  });

  it('ignores it when there is no hint on screen', () => {
    expect(applyHintWhy(null, { row: 2, col: 3, why: 'Too late.' })).toBeNull();
  });

  it('ignores a payload that is not a cell and some text, whatever the server sent', () => {
    for (const why of ['', '   ', 7, null, undefined, {}]) {
      expect(applyHintWhy(hint, { row: 2, col: 3, why })).toBe(hint);
    }
    expect(applyHintWhy(hint, { row: '2', col: 3, why: 'x' })).toBe(hint);
  });
});
