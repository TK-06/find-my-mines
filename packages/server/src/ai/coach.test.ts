import { parseCellLabel, parseReplay, reviewMatch } from '@fmm/shared';
import { describe, expect, it } from 'vitest';
import { COACH_RESERVE, COACH_TIMEOUT_MS, askCoach, reviewForCoach, type CoachModel } from './coach.js';
import type { ChatTurn } from './prompt.js';

/** 1 x 5, mines A1 and C1: Ann opens B1, Ben passes over both sure mines by opening D1, Ann takes them. */
function game() {
  const at = (label: string) => parseCellLabel(label, 1, 5)!;
  const replay = parseReplay({
    v: 1,
    rows: 1,
    cols: 5,
    mineCount: 2,
    mines: [at('A1'), at('C1')],
    seats: [
      { name: 'Ann', bot: false },
      { name: 'Ben', bot: false },
    ],
    moves: [
      { i: at('B1'), s: 0 },
      { i: at('D1'), s: 1 },
      { i: at('A1'), s: 0 },
      { i: at('C1'), s: 0 },
    ],
  })!;
  return { replay, review: { ...reviewMatch(replay), odds: [] } };
}

/** A model that gives one fixed answer, and remembers what it was asked. */
function modelSaying(answer: string | null | Error) {
  const asked: { messages: readonly ChatTurn[]; timeoutMs: number; reserve: number }[] = [];
  const model: CoachModel = {
    async coach(messages, timeoutMs, reserve) {
      asked.push({ messages, timeoutMs, reserve });
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { model, asked };
}

const QUESTION = 'Where did the game turn?';

describe('askCoach', () => {
  it('asks the model with the facts and the question, and passes a good answer on', async () => {
    const { model, asked } = modelSaying('It turned on move 2, when Ben opened D1 although A1 was a sure mine.');
    const outcome = await askCoach(model, { game: game(), question: QUESTION, history: [] }, COACH_RESERVE);

    expect(outcome).toEqual({
      kind: 'answer',
      answer: 'It turned on move 2, when Ben opened D1 although A1 was a sure mine.',
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.timeoutMs).toBe(COACH_TIMEOUT_MS);
    expect(asked[0]!.reserve).toBe(0.5);
    const last = asked[0]!.messages.at(-1)!;
    expect(last.content).toContain('"Ben"');
    expect(last.content).toContain(JSON.stringify(QUESTION));
  });

  it('waits about eight seconds, and keeps half the main key for the AI opponents', () => {
    expect(COACH_TIMEOUT_MS).toBe(8_000);
    expect(COACH_RESERVE).toBe(0.5);
  });

  it('passes the reserve it is given: none, for a coach with a key of its own', async () => {
    const { model, asked } = modelSaying('Move 2 missed a sure mine.');
    await askCoach(model, { game: game(), question: QUESTION, history: [] }, 0);
    expect(asked[0]!.reserve).toBe(0);
  });

  it('carries the earlier exchanges to the model', async () => {
    const { model, asked } = modelSaying('Move 2 is the one.');
    await askCoach(
      model,
      { game: game(), question: 'And why?', history: [{ question: 'Explain move 2', answer: 'Move 2 passed over a sure mine.' }] },
      0,
    );
    expect(asked[0]!.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('is busy when the model gives nothing: out of budget, timed out, or failed', async () => {
    const { model } = modelSaying(null);
    expect(await askCoach(model, { game: game(), question: QUESTION, history: [] }, 0)).toEqual({ kind: 'busy' });
  });

  it('is busy, not an error, when the model throws', async () => {
    const { model } = modelSaying(new Error('boom'));
    expect(await askCoach(model, { game: game(), question: QUESTION, history: [] }, 0)).toEqual({ kind: 'busy' });
  });

  it('is unhelpful when the answer names a move that is not there', async () => {
    const { model } = modelSaying('It all changed on move 17.');
    expect(await askCoach(model, { game: game(), question: QUESTION, history: [] }, 0)).toEqual({ kind: 'unhelpful' });
  });

  it('is unhelpful when the answer names a cell that is not on the board', async () => {
    const { model } = modelSaying('Ben should have opened H4.');
    expect(await askCoach(model, { game: game(), question: QUESTION, history: [] }, 0)).toEqual({ kind: 'unhelpful' });
  });

  it('is unhelpful when the answer is too long', async () => {
    const { model } = modelSaying('Move 2 was a miss. '.repeat(60));
    expect(await askCoach(model, { game: game(), question: QUESTION, history: [] }, 0)).toEqual({ kind: 'unhelpful' });
  });

  it('names the players in an answer that says Player 1 and Player 2', async () => {
    const { model } = modelSaying('Player 2 passed over a sure mine on move 2, and Player 1 took both.');
    expect(await askCoach(model, { game: game(), question: QUESTION, history: [] }, 0)).toEqual({
      kind: 'answer',
      answer: 'Ben passed over a sure mine on move 2, and Ann took both.',
    });
  });

  it('strips markdown from an answer it passes on', async () => {
    const { model } = modelSaying('**Move 2** was the miss.');
    expect(await askCoach(model, { game: game(), question: QUESTION, history: [] }, 0)).toEqual({
      kind: 'answer',
      answer: 'Move 2 was the miss.',
    });
  });
});

describe('reviewForCoach', () => {
  it('works out the review, without the odds grids the coach never needs', async () => {
    const { replay } = game();
    const review = await reviewForCoach(replay);
    expect(review).not.toBeNull();
    expect(review!.moves).toHaveLength(4);
    expect(review!.odds).toEqual([]);
    expect(review!.seats.map((seat) => seat.score)).toEqual([2, 0]);
    expect(review!.moves.map((move) => move.rating)).toEqual(reviewMatch(replay).moves.map((move) => move.rating));
  });

  it('does the work once per replay, however many questions follow', async () => {
    const { replay } = game();
    const first = reviewForCoach(replay);
    const second = reviewForCoach(replay);
    expect(second).toBe(first);
    expect(await first).toBe(await second);
  });

  it('keeps each replay’s own analysis', async () => {
    const a = game().replay;
    const b = game().replay;
    expect(reviewForCoach(a)).not.toBe(reviewForCoach(b));
  });
});
