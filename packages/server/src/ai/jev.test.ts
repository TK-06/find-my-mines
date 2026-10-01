import { describe, expect, it } from 'vitest';
import { RateBudget } from './advisor.js';
import { JEV_URL, JevPicker, createJevPicker, jevLine, jevRequestBody, jevState, type JevInput } from './jev.js';

const KEY = 'jev_test_secret_value';

const INPUT: JevInput = {
  view: { rows: 2, cols: 2, bombCount: 1, revealed: [{ row: 0, col: 0, kind: 'empty', adjacent: 1 }] },
  candidates: [
    { cell: { row: 1, col: 1 }, probability: 0.5 },
    { cell: { row: 0, col: 1 }, probability: 0.25 },
  ],
};

type FakeFetch = (url: string, init: RequestInit) => Promise<Response>;

function answer(choice: string, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      model: 'jev-1.13.0',
      answers: {
        q: { type: 'choice', choice, confidence: 0.34, probabilities: { B2: 0.7, B1: 0.3 }, ...extra },
      },
      usage: {},
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** A fake TypeSafe that records every call and answers from `reply`. */
function fakeApi(reply: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: FakeFetch = async (url, init) => {
    calls.push({ url, init });
    return reply();
  };
  return { calls, fetch };
}

function pickerWith(fetch: FakeFetch, budget?: RateBudget) {
  const clock = { now: 0 };
  const warnings: string[] = [];
  const picker = new JevPicker({
    apiKey: KEY,
    model: 'jev-latest',
    ...(budget ? { budget } : {}),
    fetch: fetch as typeof globalThis.fetch,
    now: () => clock.now,
    warn: (line) => warnings.push(line),
  });
  return { picker, clock, warnings };
}

describe('JEV request', () => {
  it('describes the board and offers each candidate with the solver’s odds', () => {
    const body = jevRequestBody('jev-latest', INPUT) as {
      state: string;
      model: string;
      questions: { q: { type: string; criteria: Record<string, string> } };
    };
    expect(body.model).toBe('jev-latest');
    expect(body.state).toContain('2x2');
    expect(body.state).toContain('1 still hidden');
    expect(body.state).toContain('1 #');
    expect(body.questions.q.type).toBe('choice');
    expect(Object.keys(body.questions.q.criteria)).toEqual(['B2', 'B1']);
    expect(body.questions.q.criteria.B2).toContain('50%');
    expect(body.questions.q.criteria.B1).toContain('25%');
  });

  it('counts found mines out of the hidden total', () => {
    const state = jevState({
      rows: 2,
      cols: 2,
      bombCount: 3,
      revealed: [{ row: 0, col: 0, kind: 'bomb', adjacent: 0 }],
    });
    expect(state).toContain('2 still hidden');
    expect(state).toContain('*');
  });
});

describe('JevPicker.choose', () => {
  it('posts to TypeSafe with the bearer key and returns JEV’s cell, probability and confidence', async () => {
    const api = fakeApi(() => answer('B2'));
    const { picker } = pickerWith(api.fetch);
    expect(await picker.choose(INPUT, 1_000)).toEqual({
      cell: { row: 1, col: 1 },
      probability: 0.7,
      confidence: 0.34,
    });

    expect(api.calls).toHaveLength(1);
    const { url, init } = api.calls[0]!;
    expect(url).toBe(JEV_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });
    const sent = JSON.parse(String(init.body)) as { model: string; state: string; questions: { q: { criteria: object } } };
    expect(sent.model).toBe('jev-latest');
    expect(sent.state).toContain('#');
    expect(Object.keys(sent.questions.q.criteria)).toEqual(['B2', 'B1']);
  });

  it('falls back to the solver’s odds when JEV gives none for its choice', async () => {
    const { picker } = pickerWith(fakeApi(() => answer('B1', { probabilities: undefined, confidence: 'high' })).fetch);
    expect(await picker.choose(INPUT, 1_000)).toEqual({ cell: { row: 0, col: 1 }, probability: 0.25, confidence: 0 });
  });

  it('returns null when the choice is not one of the offered cells', async () => {
    const { picker } = pickerWith(fakeApi(() => answer('A1')).fetch);
    expect(await picker.choose(INPUT, 1_000)).toBeNull();
  });

  it('returns null on a non-200 and says so once, without the key', async () => {
    const { picker, warnings } = pickerWith(fakeApi(() => new Response('bad key', { status: 401 })).fetch);
    expect(await picker.choose(INPUT, 1_000)).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('HTTP 401');
    expect(warnings.join(' ')).not.toContain(KEY);
  });

  it.each([429, 529])('stops calling after a %i until its retry-after has passed', async (status) => {
    let code = status;
    const api = fakeApi(() =>
      code === status ? new Response('{}', { status, headers: { 'retry-after': '12' } }) : answer('B2'),
    );
    const { picker, clock } = pickerWith(api.fetch);

    expect(await picker.choose(INPUT, 1_000)).toBeNull();
    code = 200;
    clock.now = 11_000;
    expect(await picker.choose(INPUT, 1_000)).toBeNull();
    expect(api.calls).toHaveLength(1);

    clock.now = 12_000;
    expect(await picker.choose(INPUT, 1_000)).toMatchObject({ cell: { row: 1, col: 1 } });
    expect(api.calls).toHaveLength(2);
  });

  it('returns null when JEV does not answer in time, even if the request ignores its abort', async () => {
    const { picker } = pickerWith(fakeApi(() => new Promise<Response>(() => undefined)).fetch);
    const started = Date.now();
    expect(await picker.choose(INPUT, 30)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('spends thirty calls a minute, then returns null without calling', async () => {
    const api = fakeApi(() => answer('B2'));
    const { picker } = pickerWith(api.fetch);
    for (let i = 0; i < 30; i++) expect(await picker.choose(INPUT, 1_000)).not.toBeNull();
    expect(await picker.choose(INPUT, 1_000)).toBeNull();
    expect(api.calls).toHaveLength(30);
  });

  it('does not call at all with no candidates or no time', async () => {
    const api = fakeApi(() => answer('B2'));
    const { picker } = pickerWith(api.fetch);
    expect(await picker.choose({ ...INPUT, candidates: [] }, 1_000)).toBeNull();
    expect(await picker.choose(INPUT, 0)).toBeNull();
    expect(api.calls).toHaveLength(0);
  });

  it.each([
    ['not JSON', () => new Response('<html>oops</html>', { status: 200 })],
    ['null', () => new Response('null', { status: 200 })],
    ['no answers', () => new Response('{"answers":null}', { status: 200 })],
    ['a numeric choice', () => answer(7 as unknown as string)],
    ['a thrown fetch', () => Promise.reject(new Error('boom'))],
  ])('never throws on garbage (%s)', async (_name, reply) => {
    const { picker } = pickerWith(fakeApi(reply as () => Response).fetch);
    await expect(picker.choose(INPUT, 1_000)).resolves.toBeNull();
  });

  it('keeps failure lines to one per half minute and counts the rest', async () => {
    const { picker, clock, warnings } = pickerWith(fakeApi(() => new Response('{}', { status: 500 })).fetch);
    await picker.choose(INPUT, 1_000);
    await picker.choose(INPUT, 1_000);
    await picker.choose(INPUT, 1_000);
    expect(warnings).toHaveLength(1);
    clock.now = 31_000;
    await picker.choose(INPUT, 1_000);
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain('2 more');
  });
});

describe('createJevPicker', () => {
  it('is null without a key and carries the model with one', () => {
    expect(createJevPicker({ apiKey: '  ', model: 'jev-latest' })).toBeNull();
    expect(createJevPicker({ apiKey: KEY, model: 'jev-latest' })?.model).toBe('jev-latest');
  });
});

describe('jevLine', () => {
  const cell = { row: 2, col: 3 };

  it('quotes its own probability when it finds a mine', () => {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const line = jevLine(cell, 0.64, true, () => r);
      expect(line.startsWith('JEV: ')).toBe(true);
      expect(line).toContain('D3');
      expect(line).toContain('64%');
    }
    expect(jevLine(cell, 0.64, true, () => 0)).toBe('JEV: D3 at 64%. Taking it.');
  });

  it('owns the miss, with the odds it gave', () => {
    expect(jevLine({ row: 2, col: 1 }, 0.38, false, () => 0)).toBe('JEV: B3 was 38%. The other 62% happened.');
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const line = jevLine(cell, 0.38, false, () => r);
      expect(line).toContain('D3');
      expect(line).toContain('38%');
      expect(line).not.toContain('{');
    }
  });

  it('stays sane for odd probabilities', () => {
    expect(jevLine(cell, Number.NaN, true, () => 0)).toContain('0%');
    expect(jevLine(cell, 4, false, () => 0)).toContain('100%');
  });
});
