import {
  createRng,
  mineProbabilities,
  planMove,
  thinkDelayMs,
  type AiLevel,
  type PublicMatchState,
  type Rng,
} from '@fmm/shared';
import { contain, settleWithin } from '../safety.js';
import type { Advice, PromptInput } from './prompt.js';

/** A model call needs this much of the turn left; otherwise the bot plays the solver's pick. */
export const ADVISOR_MIN_TURN_MS = 3_500;

/** The model's answer must be in at least this long before the turn would end. */
const ADVISOR_TURN_MARGIN_MS = 1_500;

/** And the bot never waits on it longer than this, however much of the turn is left. */
const ADVISOR_MAX_WAIT_MS = 4_000;

/** Thinking never eats the whole turn: this much is always left to actually move. */
const THINK_TURN_MARGIN_MS = 1_000;
const MIN_THINK_MS = 300;

/** How long after a match ends the bot votes for a rematch — time to read the result. */
export const BOT_REMATCH_DELAY_MS = 2_500;

/** What the controller needs from a room. `MatchManager` fits this shape. */
export interface BotRoom {
  publicState(): PublicMatchState;
  reveal(playerId: string, row: number, col: number): void;
  voteRematch(playerId: string): void;
}

/** What the controller needs from the model. `Advisor` fits this shape. */
export interface BotAdvisor {
  choose(input: PromptInput, timeoutMs: number): Promise<Advice | null>;
}

export interface BotControllerDeps {
  room(roomId: string): BotRoom | undefined;
  /** Null without a Groq key: the bot plays on the solver alone. */
  advisor: BotAdvisor | null;
  /** Posts the bot's line to the room chat. */
  say(roomId: string, bot: { id: string; nickname: string }, text: string): void;
  rng?: Rng;
  report?(error: unknown): void;
}

interface RoomTask {
  /** The one pending action for this room — a move or a rematch vote. */
  timer: ReturnType<typeof setTimeout> | null;
  /** What that action is for. Kept after it runs, so a move that failed is not retried in a loop. */
  key: string | null;
  /** A move is being worked out (the model may be thinking). Events wait for it. */
  busy: boolean;
  /** A look at the room is already scheduled for this tick. */
  queued: boolean;
}

/**
 * The computer opponents' hands: reads each AI room's public state after
 * every change and, when it is a bot's turn, thinks, moves, and loops while
 * it keeps the turn. One pending action per room; closing the room cancels it.
 *
 * Plays from `publicState()` only — exactly what a person at the table sees.
 * Mine positions are never read here.
 *
 * Every timer callback is contained: a bot bug must end, at worst, with the
 * bot missing its turn — never with the server down.
 */
export class BotController {
  private readonly tasks = new Map<string, RoomTask>();
  private readonly rng: Rng;
  private readonly report: (error: unknown) => void;

  constructor(private readonly deps: BotControllerDeps) {
    this.rng = deps.rng ?? createRng();
    this.report = deps.report ?? ((error) => console.error('[bot] a computer move failed:', error));
  }

  /** Start driving the bots in this room. */
  adopt(roomId: string): void {
    if (!this.tasks.has(roomId)) {
      this.tasks.set(roomId, { timer: null, key: null, busy: false, queued: false });
    }
    this.update(roomId);
  }

  /**
   * Something changed in a room. Called from the room's broadcaster, often
   * several times for one change and mid-way through it, so the look happens
   * once, on the next tick, when the room's state has settled.
   */
  update(roomId: string): void {
    const task = this.tasks.get(roomId);
    if (!task || task.queued) return;
    task.queued = true;
    setImmediate(contain(() => this.evaluate(roomId), this.report));
  }

  /** The room is gone: cancel whatever the bot was about to do there. */
  forget(roomId: string): void {
    const task = this.tasks.get(roomId);
    if (!task) return;
    this.cancel(task);
    this.tasks.delete(roomId);
  }

  /** Rooms being driven. For the console and tests. */
  get size(): number {
    return this.tasks.size;
  }

  private cancel(task: RoomTask): void {
    if (task.timer) clearTimeout(task.timer);
    task.timer = null;
    task.key = null;
  }

  private schedule(roomId: string, task: RoomTask, key: string, delayMs: number, action: () => unknown): void {
    this.cancel(task);
    task.key = key;
    task.timer = setTimeout(
      contain(() => {
        task.timer = null;
        if (this.tasks.get(roomId) !== task) return;
        return action();
      }, this.report),
      Math.max(0, delayMs),
    );
  }

  private evaluate(roomId: string): void {
    const task = this.tasks.get(roomId);
    if (!task) return;
    task.queued = false;
    if (task.busy) return;

    const room = this.deps.room(roomId);
    if (!room) {
      this.forget(roomId);
      return;
    }
    const state = room.publicState();
    const bots = state.players.filter((p) => p.bot);

    if (state.status === 'playing') {
      const bot = bots.find((p) => p.id === state.currentPlayerId);
      if (!bot?.bot) {
        this.cancel(task);
        return;
      }
      // A found mine keeps the turn and adds a cell, so the key changes and the bot goes again.
      const key = `move|${bot.id}|${state.revealed.length}`;
      if (task.key === key) return;

      const level = bot.bot;
      const think = Math.min(
        thinkDelayMs(level, this.rng),
        Math.max(MIN_THINK_MS, turnMsLeft(state) - THINK_TURN_MARGIN_MS),
      );
      this.schedule(roomId, task, key, think, () => this.move(roomId, task, bot.id, level, key));
      return;
    }

    if (state.status === 'ended') {
      const voter = bots.find((p) => !state.rematchVotes.includes(p.id));
      if (!voter) {
        this.cancel(task);
        return;
      }
      const key = `rematch|${voter.id}`;
      if (task.key === key) return;
      this.schedule(roomId, task, key, BOT_REMATCH_DELAY_MS, () => {
        const current = this.deps.room(roomId);
        if (current?.publicState().status === 'ended') current.voteRematch(voter.id);
      });
      return;
    }

    this.cancel(task);
  }

  /** Whether the bot may still play the move it was scheduled for. */
  private stillItsMove(roomId: string, task: RoomTask, botId: string, key: string): BotRoom | null {
    if (this.tasks.get(roomId) !== task) return null;
    const room = this.deps.room(roomId);
    const state = room?.publicState();
    if (!room || !state || state.status !== 'playing' || state.currentPlayerId !== botId) return null;
    return key === `move|${botId}|${state.revealed.length}` ? room : null;
  }

  private async move(roomId: string, task: RoomTask, botId: string, level: AiLevel, key: string): Promise<void> {
    task.busy = true;
    try {
      const room = this.stillItsMove(roomId, task, botId, key);
      if (!room) return;

      const state = room.publicState();
      const grid = mineProbabilities({
        rows: state.rows,
        cols: state.cols,
        mineCount: state.bombCount,
        revealed: state.revealed,
      });
      const plan = planMove(grid, level, this.rng);
      if (!plan) return;

      let pick = plan.pick;
      let say: string | null = null;
      const leftMs = turnMsLeft(state);

      if (this.deps.advisor && plan.candidates.length > 0 && leftMs >= ADVISOR_MIN_TURN_MS) {
        const me = state.players.find((p) => p.id === botId);
        const others = state.players.filter((p) => p.id !== botId).map((p) => p.score);
        const input: PromptInput = {
          level,
          view: state,
          scores: { you: me?.score ?? 0, opponent: Math.max(0, ...others) },
          candidates: plan.candidates.map((cell) => ({
            cell,
            probability: grid[cell.row]?.[cell.col] ?? 0,
          })),
        };
        // The advisor keeps to its own timeout; this one is in case it ever does not.
        const waitMs = Math.min(ADVISOR_MAX_WAIT_MS, leftMs - ADVISOR_TURN_MARGIN_MS);
        const advice = await settleWithin(this.deps.advisor.choose(input, waitMs), waitMs + 250, null);

        // The world may have moved on while the model thought: the turn ran
        // out, the player left, an admin reset the room.
        if (!this.stillItsMove(roomId, task, botId, key)) return;
        if (advice) {
          pick = advice.cell;
          say = advice.say;
        }
      }

      const nickname = state.players.find((p) => p.id === botId)?.nickname ?? 'AI';
      room.reveal(botId, pick.row, pick.col);
      if (say) this.deps.say(roomId, { id: botId, nickname }, say);
    } finally {
      task.busy = false;
      // Whatever happened meanwhile — a kept turn, a finished match — look again.
      if (this.tasks.get(roomId) === task) this.update(roomId);
    }
  }
}

/**
 * A safe guess at how much of the turn is left. The room counts down in whole
 * seconds, and the next tick may be up to a second away, so one is taken off.
 */
function turnMsLeft(state: PublicMatchState): number {
  return Math.max(0, (state.secondsLeft - 1) * 1_000);
}
