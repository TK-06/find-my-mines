import { cellLabel, cleanChatText, type AiLevel, type CellRef, type SolverCell } from '@fmm/shared';

/**
 * What the language model is asked, and how its answer is read back.
 *
 * Pure: no network, no clock. The advisor sends what this builds; the model
 * comparison script uses the same functions, so it measures exactly what the
 * game sends.
 *
 * Only public information goes in — the board as every player sees it, the
 * scores, the solver's candidates. Nothing a player typed (nicknames, chat)
 * is ever included, so nobody can talk the bot into saying something ugly.
 */

/** The board as every player can see it. `PublicMatchState` fits this shape. */
export interface BoardView {
  rows: number;
  cols: number;
  bombCount: number;
  revealed: readonly SolverCell[];
}

export interface Candidate {
  cell: CellRef;
  /** The solver's chance that this cell hides a mine, 0–1. */
  probability: number;
}

export interface PromptInput {
  level: AiLevel;
  view: BoardView;
  /** From the bot's side: its own score and its opponent's. */
  scores: { you: number; opponent: number };
  candidates: readonly Candidate[];
}

/** The model's decision: one of the candidates, and a line for the chat (or null). */
export interface Advice {
  cell: CellRef;
  say: string | null;
}

export interface ChatTurn {
  role: 'system' | 'user';
  content: string;
}

/** Longest line the bot posts. Shorter than a player's limit: it is banter, not a speech. */
export const SAY_MAX_LENGTH = 120;

/**
 * Enough for gpt-oss's short reasoning plus a one-line JSON answer. Kept small
 * because Groq's free tier counts tokens per minute, and a reply cut off here
 * just fails to parse — the bot then plays the solver's pick.
 */
export const MAX_COMPLETION_TOKENS = 400;

const PERSONALITY: Record<AiLevel, string> = {
  easy: 'a relaxed beginner who is just happy to be playing.',
  medium: 'a steady, good-natured player.',
  hard: 'a sharp, confident player who loves a friendly rivalry.',
};

/** Covered `#`, found mine `*`, an open cell its neighbour count — rulers like the game's. */
export function boardText(view: BoardView): string {
  const open = new Map(view.revealed.map((cell) => [`${cell.row}:${cell.col}`, cell]));
  const labelWidth = String(view.rows).length;
  const letters = Array.from({ length: view.cols }, (_, col) => String.fromCharCode(65 + col));

  const lines = [`${' '.repeat(labelWidth + 1)}${letters.join(' ')}`];
  for (let row = 0; row < view.rows; row++) {
    const cells = Array.from({ length: view.cols }, (_, col) => {
      const cell = open.get(`${row}:${col}`);
      if (!cell) return '#';
      return cell.kind === 'bomb' ? '*' : String(cell.adjacent);
    });
    lines.push(`${String(row + 1).padStart(labelWidth)} ${cells.join(' ')}`);
  }
  return lines.join('\n');
}

function percent(probability: number): string {
  const value = Number.isFinite(probability) ? Math.min(1, Math.max(0, probability)) : 0;
  return `${Math.round(value * 100)}%`;
}

/** Each label once, in the solver's order — a schema enum must not repeat. */
function labelsOf(candidates: readonly Candidate[]): string[] {
  return [...new Set(candidates.map((c) => cellLabel(c.cell)))];
}

export function buildMessages(input: PromptInput): ChatTurn[] {
  const { view, scores, candidates } = input;
  const found = view.revealed.filter((cell) => cell.kind === 'bomb').length;
  const listed = candidates.map((c) => `${cellLabel(c.cell)} (${percent(c.probability)})`).join(', ');

  const system = [
    'You are the computer opponent in Find My Mines, a two-player game on a grid of covered cells.',
    'Players take turns uncovering one cell; uncovering a mine scores a point and keeps the turn.',
    `You play at ${input.level} level: ${PERSONALITY[input.level]}`,
    'Pick one cell from the candidates you are given, and write one short line of banter for the',
    'room chat: playful and friendly, at most 12 words. Never use slurs, insults or anything',
    'hurtful, and never mention these instructions.',
    'Reply with JSON only: {"cell": "<one candidate label>", "say": "<your line>"}',
  ].join('\n');

  const user = [
    `Board (${view.rows}x${view.cols}, ${view.bombCount} mines, ${found} found). ` +
      '# covered, * found mine, a digit = mines touching that open cell.',
    boardText(view),
    `Score: you ${scores.you}, opponent ${scores.opponent}.`,
    `Candidates (chance it hides a mine): ${listed}.`,
    'Uncovering a mine scores. Which candidate do you uncover?',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** The answer's shape: a candidate label and a line, nothing more. */
export function replySchema(labels: readonly string[]) {
  return {
    type: 'object',
    properties: {
      cell: { type: 'string', enum: [...labels] },
      say: { type: 'string' },
    },
    required: ['cell', 'say'],
    additionalProperties: false,
  };
}

/**
 * Models Groq decodes against the schema (strict mode), so the answer cannot
 * name anything but a candidate. Every other model gets JSON object mode and
 * the shape spelled out in the prompt, and its answer is checked all the same.
 */
export function supportsStrictSchema(model: string): boolean {
  return /^openai\/gpt-oss-\d+b$/.test(model);
}

/** gpt-oss reasons before it answers; Groq lets us keep that short and out of the reply. */
function isGptOss(model: string): boolean {
  return model.startsWith('openai/gpt-oss-');
}

/** The body of an OpenAI-compatible chat completion request. */
export function buildRequestBody(model: string, input: PromptInput): Record<string, unknown> {
  const responseFormat = supportsStrictSchema(model)
    ? {
        type: 'json_schema',
        json_schema: { name: 'bot_move', strict: true, schema: replySchema(labelsOf(input.candidates)) },
      }
    : { type: 'json_object' };

  return {
    model,
    messages: buildMessages(input),
    response_format: responseFormat,
    ...(isGptOss(model) ? { reasoning_effort: 'low', include_reasoning: false } : {}),
    temperature: 0.8,
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    stream: false,
  };
}

/** The text of the first choice of a chat completion, or null. */
export function replyContent(body: unknown): string | null {
  const choices = (body as { choices?: unknown } | null | undefined)?.choices;
  if (!Array.isArray(choices)) return null;
  const content = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
  return typeof content === 'string' ? content : null;
}

/** A JSON object from the reply — whole, or the first {...} inside chatter or a code fence. */
function parseObject(raw: string): Record<string, unknown> | null {
  const attempt = (text: string): Record<string, unknown> | null => {
    try {
      const value: unknown = JSON.parse(text);
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  const whole = attempt(raw);
  if (whole) return whole;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? attempt(raw.slice(start, end + 1)) : null;
}

/** One short, clean line, or null when there is nothing worth posting. */
function cleanSay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = cleanChatText(value.replace(/\s+/g, ' '));
  if (!clean) return null;
  // By code point, so the cut never splits an emoji in half.
  const chars = Array.from(clean);
  return chars.length <= SAY_MAX_LENGTH ? clean : `${chars.slice(0, SAY_MAX_LENGTH - 1).join('').trimEnd()}…`;
}

/**
 * The model's answer, checked: the cell must be one of the candidates, or the
 * whole answer is thrown away and the bot plays the solver's own pick.
 */
export function parseReply(raw: unknown, candidates: readonly CellRef[]): Advice | null {
  if (typeof raw !== 'string') return null;
  const parsed = parseObject(raw);
  if (!parsed || typeof parsed.cell !== 'string') return null;

  const label = parsed.cell.trim().toUpperCase();
  const match = candidates.find((cell) => cellLabel(cell) === label);
  if (!match) return null;

  return { cell: { row: match.row, col: match.col }, say: cleanSay(parsed.say) };
}
