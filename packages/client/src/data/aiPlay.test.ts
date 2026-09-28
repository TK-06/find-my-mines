import { describe, expect, it } from 'vitest';
import { AI_LEVELS, type PlayerPublic, type PublicMatchState, type RevealedCell } from '@fmm/shared';
import {
  AI_LEVEL_COPY,
  canAskHint,
  hintButtonLabel,
  hintVisible,
  isNewMatch,
  isBotSeat,
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
  players: [player(ME), player(BOT, { nickname: 'AI · Hard', bot: 'hard' })],
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

describe('AI_LEVEL_COPY', () => {
  it('names and describes every level, easiest first', () => {
    expect(AI_LEVELS.map((level) => AI_LEVEL_COPY[level].label)).toEqual(['Easy', 'Medium', 'Hard']);
    for (const level of AI_LEVELS) expect(AI_LEVEL_COPY[level].note.length).toBeGreaterThan(0);
  });
});

describe('isBotSeat', () => {
  it('is true only for a seat the server marked as a computer', () => {
    expect(isBotSeat(player(BOT, { bot: 'easy' }))).toBe(true);
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
