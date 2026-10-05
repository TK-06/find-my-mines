import { describe, expect, it } from 'vitest';
import {
  COACH_ENTRIES_MAX,
  COACH_NO_ANSWER,
  askedQuestion,
  canAsk,
  coachRef,
  emptyChat,
  questionsLeftText,
  receivedAnswer,
  withLeft,
} from './coachChat.js';

describe('the conversation', () => {
  it('starts empty, with no count yet', () => {
    expect(emptyChat()).toEqual({ entries: [], left: null, nextId: 1 });
  });

  it('draws your question at once, and the answer after it, each with its own id', () => {
    let chat = withLeft(emptyChat(), 10);
    chat = askedQuestion(chat, 'Where did the game turn?');
    chat = receivedAnswer(chat, { ok: true, answer: 'On move 9.', questionsLeft: 9 });

    expect(chat.entries).toEqual([
      { id: 1, from: 'you', text: 'Where did the game turn?' },
      { id: 2, from: 'coach', text: 'On move 9.' },
    ]);
    expect(chat.left).toBe(9);
  });

  it('draws a failure as a quiet bubble with the server’s reason, and leaves the count alone', () => {
    let chat = withLeft(emptyChat(), 7);
    chat = askedQuestion(chat, 'Why?');
    chat = receivedAnswer(chat, { ok: false, error: 'The coach is busy — try again in a minute.' });

    expect(chat.entries.at(-1)).toEqual({
      id: 2,
      from: 'coach',
      text: 'The coach is busy — try again in a minute.',
      failed: true,
    });
    expect(chat.left).toBe(7);
  });

  it('takes the count a refusal reports: out of questions', () => {
    const chat = receivedAnswer(withLeft(emptyChat(), 1), { ok: false, error: 'You have asked all 10 questions.', questionsLeft: 0 });
    expect(chat.left).toBe(0);
  });

  it('says so when there was no reply at all', () => {
    const chat = receivedAnswer(withLeft(emptyChat(), 5), null);
    expect(chat.entries[0]).toMatchObject({ from: 'coach', text: COACH_NO_ANSWER, failed: true });
    expect(chat.left).toBe(5);
  });

  it('does not show an empty answer as one', () => {
    const chat = receivedAnswer(emptyChat(), { ok: true, answer: '', questionsLeft: 4 });
    expect(chat.entries[0]).toMatchObject({ failed: true });
  });

  it('keeps only the latest bubbles', () => {
    let chat = emptyChat();
    for (let i = 0; i < COACH_ENTRIES_MAX + 5; i++) chat = askedQuestion(chat, `q${i}`);
    expect(chat.entries).toHaveLength(COACH_ENTRIES_MAX);
    expect(chat.entries.at(-1)!.text).toBe(`q${COACH_ENTRIES_MAX + 4}`);
    expect(new Set(chat.entries.map((e) => e.id)).size).toBe(COACH_ENTRIES_MAX);
  });

  it('keeps the count when the server has not given one', () => {
    expect(withLeft(withLeft(emptyChat(), 3), undefined).left).toBe(3);
  });
});

describe('canAsk', () => {
  const chat = withLeft(emptyChat(), 3);

  it('needs a connection, a question, and a question left', () => {
    expect(canAsk(chat, 'Why?', false, true)).toBe(true);
    expect(canAsk(chat, '   ', false, true)).toBe(false);
    expect(canAsk(chat, 'Why?', false, false)).toBe(false);
    expect(canAsk(withLeft(chat, 0), 'Why?', false, true)).toBe(false);
  });

  it('waits for the answer to the last question', () => {
    expect(canAsk(chat, 'Why?', true, true)).toBe(false);
  });

  it('lets the first question go before the server has said how many are left', () => {
    expect(canAsk(emptyChat(), 'Why?', false, true)).toBe(true);
  });
});

describe('questionsLeftText', () => {
  it('says how many are left', () => {
    expect(questionsLeftText(10)).toBe('10 questions left for this game');
    expect(questionsLeftText(1)).toBe('1 question left for this game');
    expect(questionsLeftText(0)).toBe('No questions left for this game');
    expect(questionsLeftText(null)).toBe('Questions are limited for each game');
  });
});

describe('coachRef', () => {
  it('names a game just played by its replay id, and its match id too once saved', () => {
    expect(coachRef({ replayId: 'r-1', matchId: null })).toEqual({ replayId: 'r-1' });
    expect(coachRef({ replayId: 'r-1', matchId: 'm-1' })).toEqual({ replayId: 'r-1', matchId: 'm-1' });
  });

  it('names a game from the log by its match id', () => {
    expect(coachRef({ matchId: 'm-1' })).toEqual({ matchId: 'm-1' });
  });

  it('names nothing without either', () => {
    expect(coachRef({})).toBeNull();
    expect(coachRef({ replayId: null, matchId: null })).toBeNull();
  });
});
