import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLASSIC_PRESET, type PublicMatchState } from '@fmm/shared';
import { MatchManager, type MatchBroadcaster } from '../match/matchManager.js';
import { BOT_REMATCH_DELAY_MS, BotController, type BotAdvisor } from './botController.js';

const BOT = 'bot:test0001';
const HUMAN = 'human';

/**
 * A real room with one person and one bot, driven by fake timers. The room's
 * broadcaster pings the controller the way index.ts does.
 */
function setup(
  options: { advisor?: BotAdvisor | null; onTurn?: (id: string, controller: BotController) => void } = {},
) {
  const said: string[] = [];
  const errors: unknown[] = [];
  const holder: { controller?: BotController } = {};
  const ping = () => holder.controller?.update('R1');
  const out: MatchBroadcaster = {
    matchStart: ping,
    cellRevealed: ping,
    turnChanged: (id) => {
      if (holder.controller) options.onTurn?.(id, holder.controller);
      ping();
    },
    turnTick: () => undefined,
    matchEnded: ping,
    matchReset: ping,
    stateSync: ping,
    matchForfeited: ping,
    notice: () => undefined,
    error: () => undefined,
    changed: () => undefined,
  };
  const room = new MatchManager('R1', 'Ann vs AI', { ...CLASSIC_PRESET, maxPlayers: 2, mode: 'casual' }, 'ai', out);
  const controller = new BotController({
    room: (id) => (id === 'R1' ? room : undefined),
    advisor: options.advisor ?? null,
    say: (_roomId, bot, text) => said.push(`${bot.nickname}: ${text}`),
    report: (error) => errors.push(error),
  });
  holder.controller = controller;

  room.addPlayer(HUMAN, { profileId: null, nickname: 'Ann', elo: 800, gamesPlayed: 0, isGuest: true });
  expect(room.addBot(BOT, 'medium')).toBe(true);
  controller.adopt('R1');
  room.start(HUMAN);
  return { room, controller, said, errors };
}

const botCells = (state: PublicMatchState) => state.revealed.filter((c) => c.byPlayerId === BOT);

function firstCovered(state: PublicMatchState) {
  const open = new Set(state.revealed.map((c) => `${c.row}:${c.col}`));
  for (let row = 0; row < state.rows; row++) {
    for (let col = 0; col < state.cols; col++) if (!open.has(`${row}:${col}`)) return { row, col };
  }
  return null;
}

/** Lets the person's turns run out until the bot is on turn. */
async function untilBotTurn(room: MatchManager): Promise<void> {
  for (let i = 0; i < 400 && room.publicState().currentPlayerId !== BOT; i++) {
    await vi.advanceTimersByTimeAsync(50);
  }
  expect(room.publicState().currentPlayerId).toBe(BOT);
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'Date'],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BotController', () => {
  it('plays its own turn from the public board', async () => {
    const { room, errors } = setup();
    await untilBotTurn(room);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(botCells(room.publicState()).length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  it('plays the advisor’s choice among the candidates and posts its line', async () => {
    const asked: { candidates: { cell: { row: number; col: number } }[]; timeoutMs: number; text: string }[] = [];
    const advisor: BotAdvisor = {
      choose: async (input, timeoutMs) => {
        asked.push({ candidates: [...input.candidates], timeoutMs, text: JSON.stringify(input) });
        return { cell: input.candidates.at(-1)!.cell, say: 'Watch this' };
      },
    };
    const { room, said, errors } = setup({ advisor });
    await untilBotTurn(room);
    await vi.advanceTimersByTimeAsync(9_000);

    expect(asked.length).toBeGreaterThan(0);
    const first = botCells(room.publicState())[0];
    expect({ row: first?.row, col: first?.col }).toEqual(asked[0]!.candidates.at(-1)!.cell);
    expect(said[0]).toBe('AI · Medium: Watch this');
    // Enough time to answer, and an answer due well before the turn ends.
    expect(asked[0]!.timeoutMs).toBeGreaterThan(0);
    expect(asked[0]!.timeoutMs).toBeLessThanOrEqual(4_000);
    // Only what every player can see goes to the model.
    expect(asked[0]!.text).not.toMatch(/bombs"|mines"/);
    expect(errors).toEqual([]);
  });

  it('still moves in time when the advisor never answers', async () => {
    const advisor: BotAdvisor = { choose: () => new Promise(() => undefined) };
    const { room } = setup({ advisor });
    await untilBotTurn(room);
    const turnStartedWith = room.publicState().revealed.length;
    await vi.advanceTimersByTimeAsync(9_000);
    const cells = room.publicState().revealed.slice(turnStartedWith);
    expect(cells.some((c) => c.byPlayerId === BOT)).toBe(true);
  });

  it('votes for a rematch a moment after the match ends', async () => {
    const { room, errors } = setup();
    for (let i = 0; i < 1_000 && room.publicState().status === 'playing'; i++) {
      const state = room.publicState();
      if (state.currentPlayerId === HUMAN) {
        const cell = firstCovered(state);
        if (cell) room.reveal(HUMAN, cell.row, cell.col);
      }
      await vi.advanceTimersByTimeAsync(250);
    }
    // A mine can end the match on the person's move; let the bot's look land.
    await vi.advanceTimersByTimeAsync(0);
    expect(room.publicState().status).toBe('ended');
    expect(room.publicState().rematchVotes).not.toContain(BOT);

    await vi.advanceTimersByTimeAsync(BOT_REMATCH_DELAY_MS + 100);
    expect(room.publicState().rematchVotes).toContain(BOT);
    expect(errors).toEqual([]);
  });

  it('cancels its pending move when the room is forgotten', async () => {
    const { room, controller } = setup({
      onTurn: (id, bots) => {
        if (id === BOT) bots.forget('R1');
      },
    });
    await untilBotTurn(room);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(botCells(room.publicState())).toEqual([]);
    expect(controller.size).toBe(0);
  });

  it('ignores rooms it was never given', () => {
    const { controller } = setup();
    expect(() => controller.update('NOPE')).not.toThrow();
    expect(controller.size).toBe(1);
  });
});
