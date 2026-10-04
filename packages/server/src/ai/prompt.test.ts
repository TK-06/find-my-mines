import type { HintReason } from '@fmm/shared';
import { describe, expect, it } from 'vitest';
import {
  SAY_MAX_LENGTH,
  boardText,
  buildMessages,
  buildRequestBody,
  buildWhyMessages,
  buildWhyRequestBody,
  checkWhy,
  parseReply,
  parseWhyReply,
  replyContent,
  replySchema,
  supportsStrictSchema,
  whySchema,
  type BoardView,
  type PromptInput,
} from './prompt.js';

const VIEW: BoardView = {
  rows: 3,
  cols: 3,
  bombCount: 2,
  revealed: [
    { row: 0, col: 1, kind: 'empty', adjacent: 1 },
    { row: 0, col: 2, kind: 'bomb', adjacent: 0 },
    { row: 2, col: 0, kind: 'empty', adjacent: 0 },
  ],
};

const INPUT: PromptInput = {
  level: 'hard',
  model: 'ai',
  view: VIEW,
  scores: { you: 1, opponent: 0 },
  candidates: [
    { cell: { row: 1, col: 1 }, probability: 0.72 },
    { cell: { row: 0, col: 0 }, probability: 0.4 },
  ],
};

describe('boardText', () => {
  it('draws the board with the same rulers as the game: letters across, numbers down', () => {
    expect(boardText(VIEW)).toBe(['  A B C', '1 # 1 *', '2 # # #', '3 0 # #'].join('\n'));
  });

  it('keeps columns aligned on a board with two-digit row numbers', () => {
    const lines = boardText({ rows: 10, cols: 2, bombCount: 1, revealed: [] }).split('\n');
    expect(lines[0]).toBe('   A B');
    expect(lines[1]).toBe(' 1 # #');
    expect(lines[10]).toBe('10 # #');
  });
});

describe('buildMessages', () => {
  const [system, user] = buildMessages(INPUT);

  it('casts the model as a friendly opponent at the given level, one short line of banter', () => {
    expect(system?.role).toBe('system');
    expect(system?.content).toMatch(/hard/i);
    expect(system?.content).toMatch(/12 words/);
    expect(system?.content).toMatch(/friendly/i);
  });

  it('gives the Fruit Fly its own voice at any level, and keeps the level’s for the AI and the JEV', () => {
    const fly = buildMessages({ ...INPUT, model: 'fly', level: 'easy' })[0]!.content;
    expect(fly).toMatch(/fruit fly/i);
    expect(fly).toMatch(/easy/i);
    expect(system?.content).not.toMatch(/fruit fly/i);
    expect(buildMessages({ ...INPUT, model: 'jev' })[0]!.content).toBe(system?.content);
  });

  it('gives the board, the scores and the candidates with their mine chance', () => {
    expect(user?.role).toBe('user');
    expect(user?.content).toContain(boardText(VIEW));
    expect(user?.content).toMatch(/you 1.*opponent 0/i);
    expect(user?.content).toContain('B2 (72%)');
    expect(user?.content).toContain('A1 (40%)');
  });

  it('carries nothing a player typed — no nicknames, no chat — so nobody can steer the model', () => {
    const everything = buildMessages(INPUT).map((m) => m.content).join('\n');
    expect(Object.keys(INPUT).sort()).toEqual(['candidates', 'level', 'model', 'scores', 'view']);
    expect(everything).not.toMatch(/nickname/i);
  });
});

describe('replySchema', () => {
  it('allows exactly a candidate label and a line to say, nothing else', () => {
    expect(replySchema(['B2', 'A1'])).toEqual({
      type: 'object',
      properties: {
        cell: { type: 'string', enum: ['B2', 'A1'] },
        say: { type: 'string' },
      },
      required: ['cell', 'say'],
      additionalProperties: false,
    });
  });
});

describe('supportsStrictSchema', () => {
  it('is true for the models Groq decodes strictly', () => {
    expect(supportsStrictSchema('openai/gpt-oss-20b')).toBe(true);
    expect(supportsStrictSchema('openai/gpt-oss-120b')).toBe(true);
  });

  it('is false for everything else, which falls back to JSON object mode', () => {
    expect(supportsStrictSchema('llama-3.1-8b-instant')).toBe(false);
    expect(supportsStrictSchema('openai/gpt-oss-safeguard-20b')).toBe(false);
  });
});

describe('buildRequestBody', () => {
  it('asks gpt-oss for strict JSON with short, hidden reasoning and a small output cap', () => {
    const body = buildRequestBody('openai/gpt-oss-20b', INPUT);
    expect(body.model).toBe('openai/gpt-oss-20b');
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'bot_move', strict: true, schema: replySchema(['B2', 'A1']) },
    });
    expect(body.reasoning_effort).toBe('low');
    expect(body.include_reasoning).toBe(false);
    expect(body.max_completion_tokens).toBeGreaterThan(0);
    expect(body.max_completion_tokens).toBeLessThanOrEqual(600);
    expect(body.stream).toBe(false);
  });

  it('uses JSON object mode, and no reasoning settings, for a model without strict decoding', () => {
    const body = buildRequestBody('llama-3.1-8b-instant', INPUT);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body).not.toHaveProperty('include_reasoning');
    // JSON mode needs the shape spelled out in the prompt instead.
    const messages = body.messages as { content: string }[];
    expect(messages.map((m) => m.content).join('\n')).toMatch(/"cell".*"say"/s);
  });
});

describe('replyContent', () => {
  it('reads the first choice of a chat completion', () => {
    expect(replyContent({ choices: [{ message: { content: '{"a":1}' } }] })).toBe('{"a":1}');
  });

  it('is null for anything shaped differently', () => {
    for (const body of [null, 'x', {}, { choices: [] }, { choices: [{ message: { content: 5 } }] }]) {
      expect(replyContent(body)).toBeNull();
    }
  });
});

describe('parseReply', () => {
  const candidates = INPUT.candidates.map((c) => c.cell);

  it('turns a valid reply into a candidate cell and a line to say', () => {
    expect(parseReply('{"cell":"B2","say":"Here goes nothing!"}', candidates)).toEqual({
      cell: { row: 1, col: 1 },
      say: 'Here goes nothing!',
    });
  });

  it('refuses a cell that is not one of the candidates', () => {
    expect(parseReply('{"cell":"C3","say":"hi"}', candidates)).toBeNull();
  });

  it('forgives case and stray spaces in the label', () => {
    expect(parseReply('{"cell":" a1 ","say":"hi"}', candidates)?.cell).toEqual({ row: 0, col: 0 });
  });

  it('refuses anything that is not a JSON object with a string cell', () => {
    for (const raw of ['nope', '[]', '{"say":"hi"}', '{"cell":2,"say":"hi"}', null, 7]) {
      expect(parseReply(raw, candidates)).toBeNull();
    }
  });

  it('finds the object inside chatter or a code fence, as JSON object mode sometimes sends', () => {
    const fenced = 'Sure!\n```json\n{"cell":"A1","say":"Watch this"}\n```';
    expect(parseReply(fenced, candidates)).toEqual({ cell: { row: 0, col: 0 }, say: 'Watch this' });
  });

  it('keeps the move but drops a missing or empty line', () => {
    expect(parseReply('{"cell":"B2","say":"   "}', candidates)).toEqual({ cell: { row: 1, col: 1 }, say: null });
    expect(parseReply('{"cell":"B2","say":3}', candidates)).toEqual({ cell: { row: 1, col: 1 }, say: null });
  });

  it('keeps the line to one short line', () => {
    const reply = parseReply(JSON.stringify({ cell: 'B2', say: `Nice\n\nmove ${'a'.repeat(300)}` }), candidates);
    expect(reply?.say?.startsWith('Nice move ')).toBe(true);
    expect(reply?.say?.length).toBeLessThanOrEqual(SAY_MAX_LENGTH);
  });

  it('hands back a copy, never the caller’s own cell object', () => {
    const reply = parseReply('{"cell":"B2","say":"x"}', candidates);
    expect(reply?.cell).not.toBe(candidates[0]);
  });
});

/* ── the "Why?" under a hint ───────────────────────────────────────────── */

const FORCED: HintReason = {
  goal: 'mine',
  cell: 'C3',
  flagged: false,
  kind: 'forced',
  number: { at: 'B3', value: 2, found: 0, need: 2, covered: 2 },
  cells: ['C3', 'C4'],
  sureMines: [],
  knownSafe: [],
};

const LIKELY: HintReason = {
  goal: 'mine',
  cell: 'C3',
  flagged: false,
  kind: 'likely',
  percent: 64,
  number: { at: 'D4', value: 3, found: 0, need: 2, covered: 3 },
  shifted: false,
  extreme: true,
};

const PLAIN = 'The 2 at B3 still needs 2 mines and touches only C3 and C4, so both are mines.';

describe('buildWhyMessages', () => {
  const [system, user] = buildWhyMessages(FORCED, PLAIN);

  it('asks for a friendly rewording that sticks to the facts, as plain text, in JSON', () => {
    expect(system?.role).toBe('system');
    expect(system?.content).toMatch(/friendly/i);
    expect(system?.content).toMatch(/only the facts/i);
    expect(system?.content).toMatch(/no markdown/i);
    expect(system?.content).toMatch(/\{"why": /);
  });

  it('hands over the facts and their plain wording, and nothing else', () => {
    expect(user?.role).toBe('user');
    expect(user?.content).toContain(JSON.stringify(FORCED));
    expect(user?.content).toContain(PLAIN);
  });

  it('names no cell the facts do not, and carries no board, mine position or player-typed text', () => {
    const everything = buildWhyMessages(LIKELY, 'x').map((m) => m.content).join('\n');
    const labels = new Set(everything.match(/\b[A-Z]{1,2}[1-9]\d?\b/g));
    // Only the hinted cell and the number's own spot — nothing from the rest of the board.
    expect([...labels].sort()).toEqual(['C3', 'D4']);
    expect(everything).not.toMatch(/nickname|revealed|board \(|bombs/i);
  });
});

describe('buildWhyRequestBody', () => {
  it('asks gpt-oss for strict JSON of one string, with short hidden reasoning and a small cap', () => {
    const body = buildWhyRequestBody('openai/gpt-oss-20b', FORCED, PLAIN);
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'hint_why', strict: true, schema: whySchema() },
    });
    expect(whySchema().properties).toEqual({ why: { type: 'string' } });
    expect(body.reasoning_effort).toBe('low');
    expect(body.include_reasoning).toBe(false);
    expect(body.max_completion_tokens).toBeLessThanOrEqual(600);
    expect(body.stream).toBe(false);
  });

  it('uses JSON object mode, and no reasoning settings, for any other model', () => {
    const body = buildWhyRequestBody('llama-3.1-8b-instant', FORCED, PLAIN);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body).not.toHaveProperty('reasoning_effort');
  });
});

describe('checkWhy', () => {
  const GOOD = 'C3 has to be a mine: the 2 at B3 needs 2 mines and only C3 and C4 are left to hold them.';

  it('accepts friendly wording that names the cell and keeps to the facts', () => {
    expect(checkWhy(GOOD, FORCED)).toBe(GOOD);
    expect(checkWhy('Good news about C3! The 3 at D4 needs 2 mines among 3 slots, so C3 is a mine about 64% of the time.', LIKELY)).toMatch(/^Good news/);
  });

  it('strips markdown and wrapping quotes rather than showing them', () => {
    expect(checkWhy(`"**C3** is a mine: the 2 at B3 needs 2 mines in C3 and C4."`, FORCED)).toBe(
      'C3 is a mine: the 2 at B3 needs 2 mines in C3 and C4.',
    );
    expect(checkWhy('- `C3` is a mine, as the 2 at B3 needs 2.', FORCED)).toBe('C3 is a mine, as the 2 at B3 needs 2.');
    expect(checkWhy('“C3 is a mine, as the 2 at B3 needs 2.”', FORCED)).toBe('C3 is a mine, as the 2 at B3 needs 2.');
  });

  it('refuses wording that never names the hinted cell', () => {
    expect(checkWhy('It is a mine, because the 2 at B3 needs 2 mines.', FORCED)).toBeNull();
    // Case matters: a label is how the board writes it.
    expect(checkWhy('c3 is a mine, as the 2 at B3 needs 2.', FORCED)).toBeNull();
  });

  it('refuses a cell the facts do not name', () => {
    expect(checkWhy('C3 is a mine, and so is D9, as the 2 at B3 needs 2.', FORCED)).toBeNull();
    expect(checkWhy('C3 is a mine: the 2 at B4 needs 2 mines.', FORCED)).toBeNull();
  });

  it('allows a percent only when the facts have one, and only that one', () => {
    expect(checkWhy('C3 is a mine about 64% of the time, since the 3 at D4 needs 2.', LIKELY)).not.toBeNull();
    expect(checkWhy('C3 is a mine about 64 percent of the time, since the 3 at D4 needs 2.', LIKELY)).not.toBeNull();
    expect(checkWhy('C3 is a mine about 65% of the time, since the 3 at D4 needs 2.', LIKELY)).toBeNull();
    expect(checkWhy('C3 is a mine, 100% sure: the 2 at B3 needs 2 mines.', FORCED)).toBeNull();
    // A forced cell has no percent at all, and wording that invents one is thrown away.
    expect(checkWhy('C3 is a mine about 64% of the time; the 2 at B3 needs 2.', FORCED)).toBeNull();
  });

  it('refuses a number the facts do not contain', () => {
    expect(checkWhy('C3 is a mine: the 2 at B3 needs 3 mines.', FORCED)).toBeNull();
    expect(checkWhy('C3 is a mine: the 2 at B3 needs 2 mines among 9 cells.', FORCED)).toBeNull();
  });

  it('refuses line breaks, anything over 240 characters, links and brackets', () => {
    expect(checkWhy('C3 is a mine.\nThe 2 at B3 needs 2 mines.', FORCED)).toBeNull();
    expect(checkWhy(`C3 is a mine: the 2 at B3 needs 2 mines ${'and so on '.repeat(30)}`, FORCED)).toBeNull();
    expect(checkWhy('C3 is a mine, see https://example.com — the 2 at B3 needs 2.', FORCED)).toBeNull();
    expect(checkWhy('C3 is a [mine](x): the 2 at B3 needs 2.', FORCED)).toBeNull();
    expect(checkWhy('C3 is a <b>mine</b>: the 2 at B3 needs 2.', FORCED)).toBeNull();
  });

  it('accepts exactly 240 characters and no more', () => {
    const filler = (n: number) => 'x'.repeat(n);
    const base = 'C3 is a mine, the 2 at B3 needs 2 mines. ';
    expect(checkWhy(base + filler(240 - base.length), FORCED)).not.toBeNull();
    expect(checkWhy(base + filler(241 - base.length), FORCED)).toBeNull();
  });

  it('refuses empty and non-string answers', () => {
    for (const raw of ['', '   ', '""', null, undefined, 7, {}, ['C3']]) expect(checkWhy(raw, FORCED)).toBeNull();
  });
});

describe('parseWhyReply', () => {
  it('reads the wording out of the model’s JSON and checks it', () => {
    const reply = JSON.stringify({ why: 'C3 is a mine: the 2 at B3 needs 2 mines, and only C3 and C4 can hold them.' });
    expect(parseWhyReply(reply, FORCED)).toBe('C3 is a mine: the 2 at B3 needs 2 mines, and only C3 and C4 can hold them.');
  });

  it('finds the object inside a code fence, as JSON object mode sometimes sends', () => {
    const fenced = 'Sure!\n```json\n{"why": "C3 is a mine, the 2 at B3 needs 2 mines in C3 and C4."}\n```';
    expect(parseWhyReply(fenced, FORCED)).toBe('C3 is a mine, the 2 at B3 needs 2 mines in C3 and C4.');
  });

  it('is null for a reply that is not that, or whose wording fails the checks', () => {
    for (const raw of ['nope', '[]', '{"say":"hi"}', '{"why":7}', '{"why":"Nothing about the cell."}', null, 7]) {
      expect(parseWhyReply(raw, FORCED)).toBeNull();
    }
  });
});
