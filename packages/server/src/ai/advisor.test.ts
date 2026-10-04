import type { HintReason } from '@fmm/shared';
import { describe, expect, it } from 'vitest';
import {
  Advisor,
  DEFAULT_RETRY_AFTER_MS,
  GROQ_URL,
  RateBudget,
  askModel,
  createAdvisor,
  retryAfterMs,
} from './advisor.js';
import type { PromptInput } from './prompt.js';

const KEY = 'gsk_test_secret_value';

const INPUT: PromptInput = {
  level: 'medium',
  model: 'ai',
  view: { rows: 2, cols: 2, bombCount: 1, revealed: [{ row: 0, col: 0, kind: 'empty', adjacent: 1 }] },
  scores: { you: 0, opponent: 0 },
  candidates: [
    { cell: { row: 1, col: 1 }, probability: 0.5 },
    { cell: { row: 0, col: 1 }, probability: 0.25 },
  ],
};

type FakeFetch = (url: string, init: RequestInit) => Promise<Response>;

function completion(content: string, tokens = 100): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: tokens } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** A fake Groq that records every call and answers from `reply`. */
function fakeGroq(reply: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: FakeFetch = async (url, init) => {
    calls.push({ url, init });
    return reply();
  };
  return { calls, fetch };
}

/** An advisor on a hand-driven clock, with its log lines collected. */
function advisorWith(fetch: FakeFetch, budget = new RateBudget()) {
  const clock = { now: 0 };
  const warnings: string[] = [];
  const advisor = new Advisor({
    apiKey: KEY,
    model: 'openai/gpt-oss-20b',
    budget,
    fetch: fetch as typeof globalThis.fetch,
    now: () => clock.now,
    warn: (line) => warnings.push(line),
  });
  return { advisor, clock, warnings };
}

describe('RateBudget', () => {
  it('allows twenty calls a minute across the server, then refuses', () => {
    const budget = new RateBudget();
    for (let i = 0; i < 20; i++) expect(budget.take(i)).toBe(true);
    expect(budget.take(100)).toBe(false);
    expect(budget.waitMs(100)).toBe(60_000 - 100);
  });

  it('frees a slot a minute after each call — a sliding window', () => {
    const budget = new RateBudget(2);
    budget.take(0);
    budget.take(30_000);
    expect(budget.take(59_999)).toBe(false);
    expect(budget.take(60_000)).toBe(true);
  });

  it('also stops once the minute’s tokens are spent, until they age out', () => {
    const budget = new RateBudget(20, 1_000);
    budget.take(0);
    budget.noteTokens(0, 1_000);
    expect(budget.take(10)).toBe(false);
    expect(budget.waitMs(10)).toBe(60_000 - 10);
    expect(budget.take(60_000)).toBe(true);
  });

  it('refuses everything while paused', () => {
    const budget = new RateBudget();
    budget.pauseUntil(5_000);
    expect(budget.take(4_999)).toBe(false);
    expect(budget.waitMs(1_000)).toBe(4_000);
    expect(budget.take(5_000)).toBe(true);
  });

  it('never shortens a longer pause already in force', () => {
    const budget = new RateBudget();
    budget.pauseUntil(10_000);
    budget.pauseUntil(2_000);
    expect(budget.take(5_000)).toBe(false);
  });
});

describe('retryAfterMs', () => {
  it('reads seconds, including fractions', () => {
    expect(retryAfterMs('7', 0)).toBe(7_000);
    expect(retryAfterMs('2.5', 0)).toBe(2_500);
  });

  it('reads an HTTP date', () => {
    const now = Date.parse('2026-09-29T10:00:00Z');
    expect(retryAfterMs('Tue, 29 Sep 2026 10:00:20 GMT', now)).toBe(20_000);
  });

  it('waits thirty seconds when the header is missing or makes no sense', () => {
    expect(DEFAULT_RETRY_AFTER_MS).toBe(30_000);
    for (const header of [null, '', 'soon', '-4']) expect(retryAfterMs(header, 0)).toBe(30_000);
  });

  it('waits at least a second, whatever the header says', () => {
    expect(retryAfterMs('0', 0)).toBe(1_000);
  });
});

describe('createAdvisor', () => {
  it('is null without a key, so bots play on the solver alone', () => {
    expect(createAdvisor({ apiKey: '', model: 'openai/gpt-oss-20b' })).toBeNull();
    expect(createAdvisor({ apiKey: '   ', model: 'openai/gpt-oss-20b' })).toBeNull();
  });

  it('exists with a key', () => {
    expect(createAdvisor({ apiKey: KEY, model: 'openai/gpt-oss-20b' })).toBeInstanceOf(Advisor);
  });
});

describe('askModel', () => {
  it('posts the chat completion to Groq with the key as a bearer token', async () => {
    const groq = fakeGroq(() => completion('{"cell":"B2","say":"Mine, all mine!"}', 321));
    const outcome = await askModel({
      apiKey: KEY,
      model: 'openai/gpt-oss-20b',
      input: INPUT,
      timeoutMs: 1_000,
      fetch: groq.fetch as typeof globalThis.fetch,
    });

    expect(outcome).toMatchObject({
      kind: 'ok',
      advice: { cell: { row: 1, col: 1 }, say: 'Mine, all mine!' },
      tokens: 321,
    });
    const [call] = groq.calls;
    expect(call?.url).toBe(GROQ_URL);
    expect(call?.init.method).toBe('POST');
    expect((call?.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(call?.init.body)).model).toBe('openai/gpt-oss-20b');
  });

  it('reports a reply it cannot use as invalid, with the tokens it cost', async () => {
    const groq = fakeGroq(() => completion('{"cell":"Z9","say":"x"}', 50));
    const outcome = await askModel({
      apiKey: KEY,
      model: 'openai/gpt-oss-20b',
      input: INPUT,
      timeoutMs: 1_000,
      fetch: groq.fetch as typeof globalThis.fetch,
    });
    expect(outcome).toMatchObject({ kind: 'invalid', tokens: 50 });
  });

  it('reports an HTTP failure with its status and retry-after', async () => {
    const groq = fakeGroq(() => new Response('{}', { status: 429, headers: { 'retry-after': '12' } }));
    const outcome = await askModel({
      apiKey: KEY,
      model: 'openai/gpt-oss-20b',
      input: INPUT,
      timeoutMs: 1_000,
      fetch: groq.fetch as typeof globalThis.fetch,
    });
    expect(outcome).toMatchObject({ kind: 'http', status: 429, retryAfter: '12' });
  });
});

describe('Advisor.choose', () => {
  it('returns the model’s pick among the candidates and its line', async () => {
    const { advisor } = advisorWith(fakeGroq(() => completion('{"cell":"B1","say":"Gotcha"}')).fetch);
    expect(await advisor.choose(INPUT, 1_000)).toEqual({ cell: { row: 0, col: 1 }, say: 'Gotcha' });
  });

  it('returns null when the model names a cell that is not a candidate', async () => {
    const { advisor } = advisorWith(fakeGroq(() => completion('{"cell":"A1","say":"hi"}')).fetch);
    expect(await advisor.choose(INPUT, 1_000)).toBeNull();
  });

  it('returns null without calling Groq once the budget is spent', async () => {
    const groq = fakeGroq(() => completion('{"cell":"B2","say":"hi"}'));
    const { advisor } = advisorWith(groq.fetch, new RateBudget(1));
    expect(await advisor.choose(INPUT, 1_000)).not.toBeNull();
    expect(await advisor.choose(INPUT, 1_000)).toBeNull();
    expect(groq.calls).toHaveLength(1);
  });

  it('counts the tokens each reply cost against the budget', async () => {
    const groq = fakeGroq(() => completion('{"cell":"B2","say":"hi"}', 7_000));
    const { advisor } = advisorWith(groq.fetch, new RateBudget(20, 6_000));
    await advisor.choose(INPUT, 1_000);
    expect(await advisor.choose(INPUT, 1_000)).toBeNull();
    expect(groq.calls).toHaveLength(1);
  });

  it('stops calling after a 429 until its retry-after has passed', async () => {
    let status = 429;
    const groq = fakeGroq(() =>
      status === 429
        ? new Response('{}', { status: 429, headers: { 'retry-after': '12' } })
        : completion('{"cell":"B2","say":"back"}'),
    );
    const { advisor, clock } = advisorWith(groq.fetch);

    expect(await advisor.choose(INPUT, 1_000)).toBeNull();
    status = 200;
    clock.now = 11_000;
    expect(await advisor.choose(INPUT, 1_000)).toBeNull();
    expect(groq.calls).toHaveLength(1);

    clock.now = 12_000;
    expect(await advisor.choose(INPUT, 1_000)).toEqual({ cell: { row: 1, col: 1 }, say: 'back' });
  });

  it('backs off thirty seconds after a 429 that gave no retry-after', async () => {
    const groq = fakeGroq(() => new Response('{}', { status: 429 }));
    const { advisor, clock } = advisorWith(groq.fetch);
    await advisor.choose(INPUT, 1_000);
    clock.now = 29_999;
    await advisor.choose(INPUT, 1_000);
    expect(groq.calls).toHaveLength(1);
    clock.now = 30_000;
    await advisor.choose(INPUT, 1_000);
    expect(groq.calls).toHaveLength(2);
  });

  it('gives up at the timeout and aborts the request', async () => {
    let aborted = false;
    const hang: FakeFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const { advisor } = advisorWith(hang);
    const started = Date.now();
    expect(await advisor.choose(INPUT, 30)).toBeNull();
    expect(aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('returns null when the network fails, without throwing', async () => {
    const { advisor } = advisorWith(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await advisor.choose(INPUT, 1_000)).toBeNull();
  });

  it('logs failures briefly — the status only, never the key — and not more than once in a while', async () => {
    const groq = fakeGroq(() => new Response('{"error":"boom"}', { status: 500 }));
    const { advisor, clock, warnings } = advisorWith(groq.fetch);

    await advisor.choose(INPUT, 1_000);
    clock.now = 1_000;
    await advisor.choose(INPUT, 1_000);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/500/);

    clock.now = 60_000;
    await advisor.choose(INPUT, 1_000);
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toMatch(/1 more/);
    expect(warnings.join('\n')).not.toContain(KEY);
    expect(warnings.join('\n')).not.toContain('boom');
  });
});

describe('RateBudget — keeping a share back for the bot', () => {
  it('refuses a caller that asks to leave half alone once half is spent, while the bot may carry on', () => {
    const budget = new RateBudget(4);
    expect(budget.take(0, 0.5)).toBe(true);
    expect(budget.take(1, 0.5)).toBe(true);
    // Half of four calls is gone: a hint stops here…
    expect(budget.take(2, 0.5)).toBe(false);
    // …but the bot, which keeps nothing back, still has the other half.
    expect(budget.take(3)).toBe(true);
    expect(budget.take(4)).toBe(true);
    expect(budget.take(5)).toBe(false);
  });

  it('keeps the same share of the minute’s tokens back', () => {
    const budget = new RateBudget(20, 1_000);
    budget.take(0);
    budget.noteTokens(0, 500);
    expect(budget.take(1, 0.5)).toBe(false);
    expect(budget.take(1)).toBe(true);
  });

  it('frees the share again as calls age out of the minute', () => {
    const budget = new RateBudget(2);
    budget.take(0);
    expect(budget.take(1, 0.5)).toBe(false);
    expect(budget.take(60_000, 0.5)).toBe(true);
  });
});

describe('Advisor.explain', () => {
  const REASON: HintReason = {
    goal: 'mine',
    cell: 'C3',
    flagged: false,
    kind: 'forced',
    number: { at: 'B3', value: 2, found: 0, need: 2, covered: 2 },
    cells: ['C3', 'C4'],
    sureMines: [],
    knownSafe: [],
  };
  const PLAIN = 'The 2 at B3 still needs 2 mines and touches only C3 and C4, so both are mines.';
  const WHY = 'C3 is a mine: the 2 at B3 needs 2 mines and only C3 and C4 are left to hold them.';
  const reply = () => completion(JSON.stringify({ why: WHY }), 120);

  it('returns the model’s wording once it passes the checks', async () => {
    const groq = fakeGroq(reply);
    const { advisor } = advisorWith(groq.fetch);
    expect(await advisor.explain(REASON, PLAIN, 1_000)).toBe(WHY);
    expect(groq.calls).toHaveLength(1);
  });

  it('sends the facts and their plain wording — not the board — with the key as a bearer token', async () => {
    const groq = fakeGroq(reply);
    const { advisor } = advisorWith(groq.fetch);
    await advisor.explain(REASON, PLAIN, 1_000);

    const [call] = groq.calls;
    expect(call?.url).toBe(GROQ_URL);
    expect((call?.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(call?.init.body)) as { messages: { content: string }[] };
    const everything = body.messages.map((m) => m.content).join('\n');
    expect(everything).toContain(JSON.stringify(REASON));
    expect(everything).toContain(PLAIN);
    expect(String(call?.init.body)).not.toMatch(/revealed|bombCount|nickname/);
  });

  it('returns null, and says so once, for wording that fails the checks', async () => {
    const bad = fakeGroq(() => completion(JSON.stringify({ why: 'It is a mine — trust me.' })));
    const { advisor, warnings } = advisorWith(bad.fetch);
    expect(await advisor.explain(REASON, PLAIN, 1_000)).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/hint keeps its plain explanation/);
    expect(warnings[0]).not.toContain(KEY);
  });

  it('shares the bot’s budget: it may spend only the first half, and never calls once the budget is gone', async () => {
    const groq = fakeGroq(reply);
    const { advisor } = advisorWith(groq.fetch, new RateBudget(2));
    expect(await advisor.explain(REASON, PLAIN, 1_000)).toBe(WHY);
    // One call of two used: the other is the bot's.
    expect(await advisor.explain(REASON, PLAIN, 1_000)).toBeNull();
    expect(groq.calls).toHaveLength(1);
    // The bot can still use it.
    expect(await advisor.choose(INPUT, 1_000)).toBeNull(); // the reply is a "why", not a move…
    expect(groq.calls).toHaveLength(2); // …but it was allowed to ask.
  });

  it('backs off together with the bot after a 429', async () => {
    const groq = fakeGroq(() => new Response('{}', { status: 429, headers: { 'retry-after': '20' } }));
    const { advisor, clock } = advisorWith(groq.fetch);
    expect(await advisor.explain(REASON, PLAIN, 1_000)).toBeNull();
    clock.now = 5_000;
    expect(await advisor.choose(INPUT, 1_000)).toBeNull();
    expect(await advisor.explain(REASON, PLAIN, 1_000)).toBeNull();
    expect(groq.calls).toHaveLength(1);
  });

  it('gives up at the timeout and aborts the request', async () => {
    let aborted = false;
    const hang: FakeFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const { advisor } = advisorWith(hang);
    const started = Date.now();
    expect(await advisor.explain(REASON, PLAIN, 30)).toBeNull();
    expect(aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('returns null when the network fails, without throwing', async () => {
    const { advisor } = advisorWith(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await advisor.explain(REASON, PLAIN, 1_000)).toBeNull();
  });
});
