import { cellLabel, type CellRef } from '@fmm/shared';
import { RateBudget, retryAfterMs } from './advisor.js';
import { boardText, type BoardView, type Candidate } from './prompt.js';

/**
 * TypeSafe AI's JEV as a computer opponent: given the solver's shortlist and
 * the odds it worked out, JEV picks the cell it likes best.
 *
 * Like the Groq advisor this is optional and never load-bearing. With no
 * JEV_API_KEY there is no picker; every failure (slow, rate-limited, an
 * answer that is not one of the options) ends in `null`, and the bot plays
 * the solver's own pick.
 *
 * JEV does not write text, so it has no banter of its own — `jevLine` gives
 * the bot a stock line instead. `fetch` only, no SDK.
 */

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';

/**
 * Server-wide ceiling on calls. The API is not limited by tokens at this
 * volume, so only calls are counted; thirty a minute keeps a few games going
 * at once without leaning on the service.
 */
export const JEV_CALLS_PER_MINUTE = 30;

/** At most one failure line per this long; the rest are counted into the next one. */
const WARN_EVERY_MS = 30_000;

/** How much of an error body is worth a log line. */
const BODY_SNIPPET = 80;

/** The API accepts at most this many options in one question. */
const MAX_OPTIONS = 255;

export interface JevInput {
  view: BoardView;
  /** The solver's shortlist, each with its chance of hiding a mine, 0-1. */
  candidates: readonly Candidate[];
}

export interface JevChoice {
  cell: CellRef;
  /** JEV's own probability for the option it chose, 0-1. */
  probability: number;
  /** How sure JEV is of that choice, 0-1. */
  confidence: number;
}

function percent(probability: number): string {
  const value = Number.isFinite(probability) ? Math.min(1, Math.max(0, probability)) : 0;
  return `${Math.round(value * 100)}%`;
}

/**
 * What JEV is told about the game. The board uses the same symbols as the
 * rulers on screen; the rules are short because the options carry the odds.
 */
export function jevState(view: BoardView): string {
  const found = view.revealed.filter((cell) => cell.kind === 'bomb').length;
  return [
    `Find My Mines: a ${view.rows}x${view.cols} grid hiding ${view.bombCount} mines, ${view.bombCount - found} still hidden.`,
    'Players take turns uncovering a cell; uncovering a mine scores a point and keeps the turn, so the aim is to find mines.',
    'On the board # is a covered cell, * a mine already found, and a digit is how many mines touch that open cell.',
    boardText(view),
  ].join('\n');
}

/** The request body: one choice question, an option per candidate cell. */
export function jevRequestBody(model: string, input: JevInput): Record<string, unknown> {
  const criteria: Record<string, string> = {};
  for (const { cell, probability } of input.candidates) {
    criteria[cellLabel(cell)] = `covered cell; a solver puts its chance of being a mine at ${percent(probability)}`;
  }
  return {
    state: jevState(input.view),
    model,
    questions: {
      q: {
        type: 'choice',
        instructions: 'Which covered cell is most likely to hide a mine?',
        criteria,
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function unit(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/** JEV's answer read back; null unless `choice` is one of the offered cells. */
export function parseJevReply(body: unknown, candidates: readonly Candidate[]): JevChoice | null {
  const answer = isRecord(body) && isRecord(body.answers) ? body.answers.q : null;
  if (!isRecord(answer) || typeof answer.choice !== 'string') return null;
  const choice = answer.choice;
  const offered = candidates.find((c) => cellLabel(c.cell) === choice);
  if (!offered) return null;

  const probabilities = isRecord(answer.probabilities) ? answer.probabilities : {};
  return {
    cell: offered.cell,
    probability: unit(probabilities[choice]) ?? offered.probability,
    confidence: unit(answer.confidence) ?? 0,
  };
}

export interface JevPickerOptions {
  apiKey: string;
  model: string;
  budget?: RateBudget;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  /** Where brief failure lines go. Never given the key or a prompt. */
  warn?: (line: string) => void;
}

/** The game's JEV: budgeted, backing off on 429 and 529, quiet about its failures. */
export class JevPicker {
  readonly model: string;
  private readonly budget: RateBudget;
  private readonly now: () => number;
  private readonly warn: (line: string) => void;
  private lastWarnAt = Number.NEGATIVE_INFINITY;
  private quietFailures = 0;

  constructor(private readonly options: JevPickerOptions) {
    this.model = options.model;
    this.budget = options.budget ?? new RateBudget(JEV_CALLS_PER_MINUTE, Number.POSITIVE_INFINITY);
    this.now = options.now ?? Date.now;
    this.warn = options.warn ?? ((line) => console.warn(`[jev] ${line}`));
  }

  /**
   * JEV's pick among the candidates, or null — straight away when the budget
   * is spent or the service asked us to wait, otherwise within `timeoutMs`.
   * Never throws, and never takes longer than `timeoutMs` even if the request
   * ignores its abort signal.
   */
  async choose(input: JevInput, timeoutMs: number): Promise<JevChoice | null> {
    if (input.candidates.length === 0 || input.candidates.length > MAX_OPTIONS || timeoutMs <= 0) return null;
    if (!this.budget.take(this.now())) return null;

    const doFetch = this.options.fetch ?? globalThis.fetch;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve('timeout');
      }, Math.max(1, timeoutMs));
    });

    const work = async (): Promise<JevChoice | null> => {
      let response: Response;
      try {
        response = await doFetch(JEV_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(jevRequestBody(this.model, input)),
          signal: controller.signal,
        });
      } catch {
        if (!controller.signal.aborted) this.failed('a network error');
        return null;
      }

      if (!response.ok) {
        const status = response.status;
        let snippet = '';
        try {
          snippet = (await response.text()).replace(/\s+/g, ' ').slice(0, BODY_SNIPPET);
        } catch {
          // The status says enough.
        }
        // 429: rate limited. 529: overloaded. Either way, leave it alone for a while.
        if (status === 429 || status === 529) {
          this.budget.pauseUntil(this.now() + retryAfterMs(response.headers.get('retry-after'), Date.now()));
        }
        this.failed(`HTTP ${status}${snippet ? ` ${snippet}` : ''}`);
        return null;
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        if (!controller.signal.aborted) this.failed('an unreadable reply');
        return null;
      }
      const choice = parseJevReply(body, input.candidates);
      if (!choice) this.failed('an unusable reply');
      return choice;
    };

    try {
      const result = await Promise.race([work(), timedOut]);
      if (result === 'timeout') {
        this.failed(`no answer within ${timeoutMs} ms`);
        return null;
      }
      return result;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** One line now and then — an outage must not flood the console. */
  private failed(what: string): void {
    const now = this.now();
    if (now - this.lastWarnAt < WARN_EVERY_MS) {
      this.quietFailures += 1;
      return;
    }
    const more = this.quietFailures > 0 ? ` (${this.quietFailures} more since the last report)` : '';
    this.warn(`JEV call failed — ${what}; the bot plays the solver's pick${more}`);
    this.lastWarnAt = now;
    this.quietFailures = 0;
  }
}

/** The picker, or null when there is no key — then JEV cannot be played. */
export function createJevPicker(options: JevPickerOptions): JevPicker | null {
  const apiKey = options.apiKey.trim();
  return apiKey ? new JevPicker({ ...options, apiKey }) : null;
}

/** How often JEV says something after a move it chose itself. */
export const JEV_CHAT_CHANCE = 0.35;

const FOUND = [
  'JEV: {cell} at {pct}. Taking it.',
  'JEV: {cell}, {pct}. That one was a mine.',
  'JEV: {cell} came in at {pct}. Good call.',
  'JEV: {cell} at {pct}, and it paid off.',
];

const MISSED = [
  'JEV: {cell} was {pct}. The other {rest} happened.',
  'JEV: {cell} at {pct}. Not this time.',
  'JEV: {cell} was {pct}. Unlucky.',
  'JEV: I rated {cell} at {pct}. The board disagreed.',
];

/** A stock line about the cell JEV just opened, quoting its own probability. */
export function jevLine(cell: CellRef, probability: number, foundMine: boolean, rng: () => number): string {
  const lines = foundMine ? FOUND : MISSED;
  const value = Number.isFinite(probability) ? Math.min(1, Math.max(0, probability)) : 0;
  const pct = Math.round(value * 100);
  const line = lines[Math.min(lines.length - 1, Math.floor(rng() * lines.length))]!;
  return line
    .replace('{cell}', cellLabel(cell))
    .replace('{pct}', `${pct}%`)
    .replace('{rest}', `${100 - pct}%`);
}
