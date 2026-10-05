import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLASSIC_PRESET, type BotSetup, type PublicMatchState, type Rng } from '@fmm/shared';
import { MatchManager, type MatchBroadcaster } from '../match/matchManager.js';
import { BOT_REMATCH_DELAY_MS, BotController, flyThoughtHoldMs, type BotAdvisor, type BotJev } from './botController.js';
import type { FlyBrain } from './fly/brain.js';

const BOT = 'bot:test0001';
const FLY: BotSetup = { level: 'hard', model: 'fly' };
const JEV: BotSetup = { level: 'hard', model: 'jev' };
const HUMAN = 'human';

interface TestFlyThought {
  roomId: string;
  botId: string;
  move: number;
  pick: { row: number; col: number };
  steps: number;
  neurons: number;
  rates: string;
  candidates: { row: number; col: number; score: number }[];
}

interface RecordedFlyThought {
  roomId: string;
  payload: TestFlyThought;
  revealed: { row: number; col: number }[];
  at: number;
}

/**
 * A real room with one person and one bot, driven by fake timers. The room's
 * broadcaster pings the controller the way index.ts does.
 */
function setup(
  options: {
    advisor?: BotAdvisor | null;
    jev?: BotJev | null;
    onTurn?: (id: string, controller: BotController) => void;
    bot?: BotSetup;
    /** Random numbers for the controller; 0 forces every deliberate mistake the level allows. */
    rng?: Rng;
    /** The Fruit Fly's brain; omitted, the controller loads the real one. */
    fly?: FlyBrain | null;
    onFlyThought?: (roomId: string, payload: TestFlyThought, room: MatchManager) => void;
  } = {},
) {
  const said: string[] = [];
  const errors: unknown[] = [];
  const thoughts: RecordedFlyThought[] = [];
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
    ...(options.jev !== undefined ? { jev: options.jev } : {}),
    say: (_roomId, bot, text) => said.push(`${bot.nickname}: ${text}`),
    report: (error) => errors.push(error),
    ...(options.rng ? { rng: options.rng } : {}),
    ...(options.fly !== undefined ? { fly: options.fly } : {}),
    ...(options.onFlyThought
      ? {
          flyThought: (roomId: string, payload: TestFlyThought) => {
            const state = room.publicState();
            thoughts.push({
              roomId,
              payload,
              revealed: state.revealed.map(({ row, col }) => ({ row, col })),
              at: Date.now(),
            });
            options.onFlyThought?.(roomId, payload, room);
          },
        }
      : {}),
  });
  holder.controller = controller;

  room.addPlayer(HUMAN, { profileId: null, nickname: 'Ann', elo: 800, gamesPlayed: 0, isGuest: true });
  expect(room.addBot(BOT, options.bot ?? { level: 'medium', model: 'ai' })).toBe(true);
  controller.adopt('R1');
  room.start(HUMAN);
  return { room, controller, said, errors, thoughts };
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

async function untilThought(thoughts: readonly RecordedFlyThought[]): Promise<void> {
  for (let i = 0; i < 200 && thoughts.length === 0; i++) await vi.advanceTimersByTimeAsync(25);
  expect(thoughts.length).toBeGreaterThan(0);
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'Date'],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fly thought timing', () => {
  it('holds for 1.2 seconds only when the advisor margin remains afterwards', () => {
    expect(flyThoughtHoldMs(2_699)).toBe(0);
    expect(flyThoughtHoldMs(2_700)).toBe(1_200);
    expect(flyThoughtHoldMs(Number.NaN)).toBe(0);
  });
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

  it('hands the model the bot’s level and model, and seats it as a setup', async () => {
    const seen: { level: string; model: string }[] = [];
    const advisor: BotAdvisor = {
      choose: async (input) => {
        seen.push({ level: input.level, model: input.model });
        return null;
      },
    };
    const { room } = setup({ advisor, bot: { level: 'easy', model: 'ai' } });
    expect(room.publicState().players.find((p) => p.id === BOT)?.bot).toEqual({ level: 'easy', model: 'ai' });
    await untilBotTurn(room);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(seen[0]).toEqual({ level: 'easy', model: 'ai' });
  });

  it('ignores rooms it was never given', () => {
    const { controller } = setup();
    expect(() => controller.update('NOPE')).not.toThrow();
    expect(controller.size).toBe(1);
  });
});

describe('BotController · Fruit Fly', () => {
  it('broadcasts the picked public-board thought, then reveals that cell after the animation hold', async () => {
    const { room, thoughts, errors } = setup({
      bot: FLY,
      rng: () => 0,
      onFlyThought: () => undefined,
    });
    await untilBotTurn(room);
    await untilThought(thoughts);

    expect(thoughts).toHaveLength(1);
    const { payload } = thoughts[0]!;
    expect(thoughts[0]!.roomId).toBe('R1');
    expect(payload.roomId).toBe('R1');
    expect(payload.botId).toBe(BOT);
    expect(payload.move).toBe(thoughts[0]!.revealed.length);
    expect(payload.steps).toBe(16);
    expect(payload.neurons).toBe(244);
    expect(Buffer.from(payload.rates, 'base64')).toHaveLength(16 * 244);
    expect(payload.candidates.length).toBeLessThanOrEqual(40);
    expect(payload.candidates.some(({ row, col }) => row === payload.pick.row && col === payload.pick.col)).toBe(true);
    const open = new Set(thoughts[0]!.revealed.map(({ row, col }) => `${row}:${col}`));
    for (const cell of payload.candidates) expect(open.has(`${cell.row}:${cell.col}`)).toBe(false);
    expect(botCells(room.publicState())).toEqual([]);

    const elapsed = Date.now() - thoughts[0]!.at;
    await vi.advanceTimersByTimeAsync(Math.max(0, 1_199 - elapsed));
    expect(botCells(room.publicState())).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    const revealed = room.publicState().revealed[payload.move];
    expect({ row: revealed?.row, col: revealed?.col, byPlayerId: revealed?.byPlayerId }).toEqual({
      ...payload.pick,
      byPlayerId: BOT,
    });
    expect(errors).toEqual([]);
  });

  it('does not reveal after the thought hold when the room was reset', async () => {
    const { room, errors, thoughts } = setup({
      bot: FLY,
      rng: () => 0,
      onFlyThought: (_roomId, _payload, current) => {
        setTimeout(() => current.resetAll(), 600);
      },
    });
    await untilBotTurn(room);
    await untilThought(thoughts);
    for (let i = 0; i < 100 && room.publicState().status === 'playing'; i++) {
      await vi.advanceTimersByTimeAsync(25);
    }
    await vi.advanceTimersByTimeAsync(700);

    expect(room.publicState().status).toBe('waiting');
    expect(botCells(room.publicState())).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('plays its own turn through the fly circuit, under its own name', async () => {
    const { room, said, errors } = setup({ bot: FLY });
    expect(room.publicState().players.find((p) => p.id === BOT)?.nickname).toBe('Fruit Fly · Hard');
    await untilBotTurn(room);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(botCells(room.publicState()).length).toBeGreaterThan(0);
    for (const line of said) expect(line.startsWith('Fruit Fly · Hard: ')).toBe(true);
    expect(errors).toEqual([]);
  });

  it('keeps its own pick whatever the model says; the model only adds a line', async () => {
    const asked: { cell: { row: number; col: number } }[][] = [];
    const advisor: BotAdvisor = {
      choose: async (input) => {
        asked.push([...input.candidates]);
        const offered = input.candidates[0]!.cell;
        // Name some other cell: it must be ignored.
        return { cell: { row: offered.row === 0 ? 1 : 0, col: offered.col }, say: 'bzz?' };
      },
    };
    const { room, said, errors } = setup({ bot: FLY, advisor });
    await untilBotTurn(room);
    await vi.advanceTimersByTimeAsync(9_000);

    expect(asked.length).toBeGreaterThan(0);
    // The model is shown one cell — the fly's — so it has nothing to overrule.
    expect(asked[0]).toHaveLength(1);
    const first = botCells(room.publicState())[0];
    expect({ row: first?.row, col: first?.col }).toEqual(asked[0]![0]!.cell);
    expect(said[0]).toBe('Fruit Fly · Hard: bzz?');
    expect(errors).toEqual([]);
  });

  it('on Easy, handed a mistake plan, still opens only covered cells', async () => {
    // A zero from the generator makes every chance roll succeed: the level's
    // mistakes come as often as they can, and the circuit picks among them.
    const { room, errors } = setup({ bot: { level: 'easy', model: 'fly' }, rng: () => 0 });
    expect(room.publicState().players.find((p) => p.id === BOT)?.nickname).toBe('Fruit Fly · Easy');
    await untilBotTurn(room);
    const before = room.publicState().revealed.length;
    await vi.advanceTimersByTimeAsync(9_000);

    const state = room.publicState();
    const cells = state.revealed.map((c) => `${c.row}:${c.col}`);
    expect(new Set(cells).size).toBe(cells.length);
    expect(state.revealed.slice(before).some((c) => c.byPlayerId === BOT)).toBe(true);
    for (const c of botCells(state)) {
      expect(c.row).toBeGreaterThanOrEqual(0);
      expect(c.row).toBeLessThan(state.rows);
      expect(c.col).toBeLessThan(state.cols);
    }
    expect(errors).toEqual([]);
  });

  it('still moves with no brain — on the solver’s pick', async () => {
    const quiet = setup({ bot: FLY, fly: null });
    await untilBotTurn(quiet.room);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(botCells(quiet.room.publicState()).length).toBeGreaterThan(0);
    expect(quiet.errors).toEqual([]);
  });

  it('reports a broken brain and plays the solver’s pick instead', async () => {
    const broken = { score: () => { throw new Error('neuron on fire'); } } as unknown as FlyBrain;
    const { room, errors } = setup({ bot: FLY, fly: broken });
    await untilBotTurn(room);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(botCells(room.publicState()).length).toBeGreaterThan(0);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('BotController · JEV', () => {
  it('plays the cell JEV chose among the solver’s candidates, under its own name', async () => {
    const asked: { cells: { row: number; col: number }[]; probabilities: number[]; timeoutMs: number }[] = [];
    const jev: BotJev = {
      choose: async (input, timeoutMs) => {
        asked.push({
          cells: input.candidates.map((c) => c.cell),
          probabilities: input.candidates.map((c) => c.probability),
          timeoutMs,
        });
        return { cell: input.candidates.at(-1)!.cell, probability: 0.5, confidence: 0.4 };
      },
    };
    const { room, errors } = setup({ bot: JEV, jev });
    expect(room.publicState().players.find((p) => p.id === BOT)?.nickname).toBe('JEV · Hard');
    await untilBotTurn(room);
    await vi.advanceTimersByTimeAsync(9_000);

    expect(asked.length).toBeGreaterThan(0);
    expect(asked[0]!.probabilities.every((p) => p >= 0 && p <= 1)).toBe(true);
    expect(asked[0]!.timeoutMs).toBeGreaterThan(0);
    expect(asked[0]!.timeoutMs).toBeLessThanOrEqual(4_000);
    const first = botCells(room.publicState())[0];
    expect({ row: first?.row, col: first?.col }).toEqual(asked[0]!.cells.at(-1));
    expect(errors).toEqual([]);
  });

  it('plays the solver’s pick when JEV does not answer, and says nothing', async () => {
    const jev: BotJev = { choose: async () => null };
    const { room, said, errors } = setup({ bot: JEV, jev, rng: () => 0 });
    await untilBotTurn(room);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(botCells(room.publicState()).length).toBeGreaterThan(0);
    expect(said).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('plays the solver’s pick when no picker is configured', async () => {
    const { room, said, errors } = setup({ bot: JEV, jev: null });
    await untilBotTurn(room);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(botCells(room.publicState()).length).toBeGreaterThan(0);
    expect(said).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('still moves in time when JEV never answers', async () => {
    const jev: BotJev = { choose: () => new Promise(() => undefined) };
    const { room } = setup({ bot: JEV, jev });
    await untilBotTurn(room);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(botCells(room.publicState()).length).toBeGreaterThan(0);
  });

  it('never moves to an open cell, even if JEV names one', async () => {
    const jev: BotJev = {
      choose: async (input) => {
        const open = input.view.revealed[0];
        return { cell: open ? { row: open.row, col: open.col } : input.candidates[0]!.cell, probability: 0.5, confidence: 0.4 };
      },
    };
    const { room, errors } = setup({ bot: JEV, jev });
    // Give the board an open cell before the bot's first move.
    const cell = firstCovered(room.publicState());
    if (room.publicState().currentPlayerId === HUMAN && cell) room.reveal(HUMAN, cell.row, cell.col);
    await untilBotTurn(room);
    const before = new Set(room.publicState().revealed.map((c) => `${c.row}:${c.col}`));
    await vi.advanceTimersByTimeAsync(9_000);
    const mine = botCells(room.publicState());
    expect(mine.length).toBeGreaterThan(0);
    for (const c of mine) expect(before.has(`${c.row}:${c.col}`)).toBe(false);
    expect(errors).toEqual([]);
  });

  it('does not use the Groq advisor for JEV', async () => {
    let asked = 0;
    const advisor: BotAdvisor = {
      choose: async () => {
        asked++;
        return null;
      },
    };
    const { room } = setup({ bot: JEV, advisor, jev: null });
    await untilBotTurn(room);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(asked).toBe(0);
  });

  it('sometimes quotes its own odds in the chat after a move it chose', async () => {
    const jev: BotJev = {
      choose: async (input) => ({ cell: input.candidates[0]!.cell, probability: 0.64, confidence: 0.4 }),
    };
    const { room, said } = setup({ bot: JEV, jev, rng: () => 0 });
    await untilBotTurn(room);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(said.length).toBeGreaterThan(0);
    expect(said[0]).toMatch(/^JEV · Hard: JEV: [A-P]\d+ .*64%/);
  });
});
