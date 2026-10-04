import type { HintReason } from '@fmm/shared';
import {
  buildRequestBody,
  buildWhyRequestBody,
  parseReply,
  parseWhyReply,
  replyContent,
  type Advice,
  type PromptInput,
} from './prompt.js';

/**
 * The computer opponent's optional second opinion: a language model on Groq
 * picks among the solver's candidate cells and adds a line of banter.
 *
 * Everything here is optional, like Supabase: with no GROQ_API_KEY there is
 * no advisor and the bot plays on the solver alone — the game never depends
 * on a network call. Every failure (slow, rate-limited, nonsense) ends in
 * `null`, and the bot plays the solver's own pick.
 *
 * `fetch` only — no SDK. Groq speaks the OpenAI chat-completions dialect.
 */

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Server-wide ceiling on calls. Groq's free tier allows 30 requests and 8K
 * tokens a minute (and 1K requests a day); staying under both leaves headroom
 * for the model comparison script or a second server on the same key.
 */
export const AI_CALLS_PER_MINUTE = 20;
export const AI_TOKENS_PER_MINUTE = 6_000;

/**
 * A hint's "Why?" is a nicety, the bot's move is the game: a rewording may only
 * spend the first half of the minute's allowance, so a busy server's hints
 * never leave the bot without a call.
 */
export const HINT_WHY_RESERVE = 0.5;

/** How long to stop calling after a 429 that did not say. */
export const DEFAULT_RETRY_AFTER_MS = 30_000;

/** At most one failure line per this long; the rest are counted into the next one. */
const WARN_EVERY_MS = 30_000;

const MINUTE_MS = 60_000;

/**
 * Calls and tokens spent in the last minute, plus any pause Groq asked for.
 * Pure — the caller passes the clock in.
 */
export class RateBudget {
  private calls: number[] = [];
  private tokens: { at: number; count: number }[] = [];
  private pausedUntil = 0;

  constructor(
    private readonly callsPerMinute = AI_CALLS_PER_MINUTE,
    private readonly tokensPerMinute = AI_TOKENS_PER_MINUTE,
  ) {}

  /** 0 when a call may go now, else how long until one may. */
  waitMs(now: number): number {
    this.forgetOld(now);
    let wait = Math.max(0, this.pausedUntil - now);

    if (this.calls.length >= this.callsPerMinute) {
      wait = Math.max(wait, this.calls[this.calls.length - this.callsPerMinute]! + MINUTE_MS - now);
    }

    let spent = this.tokensSpent();
    for (const entry of this.tokens) {
      if (spent < this.tokensPerMinute) break;
      // Once this entry ages out, what is left is under the limit (or the loop carries on).
      spent -= entry.count;
      wait = Math.max(wait, entry.at + MINUTE_MS - now);
    }
    return wait;
  }

  /**
   * Spends a call when the budget allows. False, and nothing spent, otherwise.
   * `reserve` (0–1) is the share of the minute's calls and tokens kept back for
   * someone more important: a caller that passes 0.5 gets nothing once half is spent.
   */
  take(now: number, reserve = 0): boolean {
    if (this.waitMs(now) > 0) return false;
    if (reserve > 0) {
      const share = 1 - Math.min(1, reserve);
      if (this.calls.length >= this.callsPerMinute * share) return false;
      if (this.tokensSpent() >= this.tokensPerMinute * share) return false;
    }
    this.calls.push(now);
    return true;
  }

  private tokensSpent(): number {
    return this.tokens.reduce((sum, entry) => sum + entry.count, 0);
  }

  /** What a finished call cost — only known once the reply is in. */
  noteTokens(now: number, count: number): void {
    if (Number.isFinite(count) && count > 0) this.tokens.push({ at: now, count });
  }

  /** Stop calling until `at`. A shorter pause never cuts a longer one short. */
  pauseUntil(at: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, at);
  }

  private forgetOld(now: number): void {
    this.calls = this.calls.filter((at) => now - at < MINUTE_MS);
    this.tokens = this.tokens.filter((entry) => now - entry.at < MINUTE_MS);
  }
}

/**
 * How long a 429's `retry-after` asks us to wait: seconds, or an HTTP date.
 * Missing or unreadable means thirty seconds; never less than one.
 */
export function retryAfterMs(header: string | null, now: number): number {
  const value = header?.trim() ?? '';
  if (/^\d+(\.\d+)?$/.test(value)) return Math.max(1_000, Math.round(Number(value) * 1_000));
  // A date has a weekday or month name in it; a bare "-4" is not a date.
  if (/[a-z]/i.test(value)) {
    const at = Date.parse(value);
    if (Number.isFinite(at)) return Math.max(1_000, at - now);
  }
  return DEFAULT_RETRY_AFTER_MS;
}

/** What one call to Groq came to, whatever it asked: the usable answer, or why there is none. */
type Settled<T> =
  | { kind: 'ok'; value: T; tokens: number; ms: number }
  | { kind: 'invalid'; tokens: number; ms: number }
  | { kind: 'http'; status: number; retryAfter: string | null; ms: number }
  | { kind: 'timeout'; ms: number }
  | { kind: 'network'; ms: number };

/** What one call to the model came to. The eval script reports these as they are. */
export type AskOutcome =
  | { kind: 'ok'; advice: Advice; tokens: number; ms: number }
  | Exclude<Settled<never>, { kind: 'ok' }>;

export interface AskOptions {
  apiKey: string;
  model: string;
  input: PromptInput;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
}

function totalTokens(body: unknown): number {
  const count = (body as { usage?: { total_tokens?: unknown } } | null)?.usage?.total_tokens;
  return typeof count === 'number' && Number.isFinite(count) ? count : 0;
}

interface CallOptions<T> {
  apiKey: string;
  /** The chat completion request, already built. */
  body: Record<string, unknown>;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
  /** Turns the reply's text into the answer, or null when it will not do. */
  read(content: string | null): T | null;
}

/**
 * One chat completion, raced against a timer. Never throws, and never takes
 * longer than `timeoutMs` — even if the request ignores its abort signal.
 */
async function callGroq<T>(options: CallOptions<T>): Promise<Settled<T>> {
  const { apiKey, body: request, timeoutMs, read } = options;
  const doFetch = options.fetch ?? globalThis.fetch;
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const controller = new AbortController();

  const work = async (): Promise<Settled<T>> => {
    let response: Response;
    try {
      response = await doFetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch {
      return controller.signal.aborted ? { kind: 'timeout', ms: elapsed() } : { kind: 'network', ms: elapsed() };
    }

    if (!response.ok) {
      // The error body is not needed (and may echo the request); free the connection.
      void response.body?.cancel().catch(() => undefined);
      return {
        kind: 'http',
        status: response.status,
        retryAfter: response.headers.get('retry-after'),
        ms: elapsed(),
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return controller.signal.aborted
        ? { kind: 'timeout', ms: elapsed() }
        : { kind: 'invalid', tokens: 0, ms: elapsed() };
    }

    const tokens = totalTokens(body);
    const value = read(replyContent(body));
    return value !== null
      ? { kind: 'ok', value, tokens, ms: elapsed() }
      : { kind: 'invalid', tokens, ms: elapsed() };
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<Settled<T>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: 'timeout', ms: elapsed() });
    }, Math.max(1, timeoutMs));
  });

  try {
    return await Promise.race([work(), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** One bot-move question to the model; see `callGroq`. Never throws. */
export async function askModel(options: AskOptions): Promise<AskOutcome> {
  const { apiKey, model, input, timeoutMs } = options;
  const candidates = input.candidates.map((c) => c.cell);
  const outcome = await callGroq({
    apiKey,
    body: buildRequestBody(model, input),
    timeoutMs,
    fetch: options.fetch,
    read: (content) => parseReply(content, candidates),
  });
  return outcome.kind === 'ok'
    ? { kind: 'ok', advice: outcome.value, tokens: outcome.tokens, ms: outcome.ms }
    : outcome;
}

export interface AdvisorOptions {
  apiKey: string;
  model: string;
  budget?: RateBudget;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  /** Where brief failure lines go. Never given the key, a prompt or a reply body. */
  warn?: (line: string) => void;
}

/** What a failed call costs the bot, for the log line. */
const BOT_FALLBACK = "the bot plays the solver's pick";

/** What a failed call costs a hint, for the log line. */
const HINT_FALLBACK = 'the hint keeps its plain explanation';

/** The game's advisor: budgeted, backing off on 429, quiet about its failures. */
export class Advisor {
  readonly model: string;
  private readonly budget: RateBudget;
  private readonly now: () => number;
  private readonly warn: (line: string) => void;
  private lastWarnAt = Number.NEGATIVE_INFINITY;
  private quietFailures = 0;

  constructor(private readonly options: AdvisorOptions) {
    this.model = options.model;
    this.budget = options.budget ?? new RateBudget();
    this.now = options.now ?? Date.now;
    this.warn = options.warn ?? ((line) => console.warn(`[ai] ${line}`));
  }

  /**
   * The model's pick among the candidates, or null — straight away when the
   * budget is spent or Groq asked us to wait, otherwise within `timeoutMs`.
   */
  async choose(input: PromptInput, timeoutMs: number): Promise<Advice | null> {
    if (input.candidates.length === 0 || timeoutMs <= 0) return null;
    if (!this.budget.take(this.now())) return null;

    const candidates = input.candidates.map((c) => c.cell);
    const outcome = await callGroq({
      apiKey: this.options.apiKey,
      body: buildRequestBody(this.model, input),
      timeoutMs,
      fetch: this.options.fetch,
      read: (content) => parseReply(content, candidates),
    });
    return this.settle(outcome, timeoutMs, BOT_FALLBACK);
  }

  /**
   * A friendlier wording of a hint's explanation, or null — straight away when
   * the budget (or the half of it a hint may use) is spent or Groq asked us to
   * wait, otherwise within `timeoutMs`. The model sees only the facts and the
   * plain draft; what comes back is checked against the facts before it is
   * returned (see `checkWhy`), so a non-null answer is safe to show.
   */
  async explain(reason: HintReason, plain: string, timeoutMs: number): Promise<string | null> {
    if (timeoutMs <= 0) return null;
    if (!this.budget.take(this.now(), HINT_WHY_RESERVE)) return null;

    const outcome = await callGroq({
      apiKey: this.options.apiKey,
      body: buildWhyRequestBody(this.model, reason, plain),
      timeoutMs,
      fetch: this.options.fetch,
      read: (content) => parseWhyReply(content, reason),
    });
    return this.settle(outcome, timeoutMs, HINT_FALLBACK);
  }

  /** Books what a call cost, backs off when asked to, and hands back the answer if there was one. */
  private settle<T>(outcome: Settled<T>, timeoutMs: number, fallback: string): T | null {
    const now = this.now();
    switch (outcome.kind) {
      case 'ok':
        this.budget.noteTokens(now, outcome.tokens);
        return outcome.value;
      case 'invalid':
        this.budget.noteTokens(now, outcome.tokens);
        this.failed('an unusable reply', now, fallback);
        return null;
      case 'http':
        if (outcome.status === 429) {
          this.budget.pauseUntil(now + retryAfterMs(outcome.retryAfter, Date.now()));
        }
        this.failed(`HTTP ${outcome.status}`, now, fallback);
        return null;
      case 'timeout':
        this.failed(`no answer within ${timeoutMs} ms`, now, fallback);
        return null;
      case 'network':
        this.failed('a network error', now, fallback);
        return null;
    }
  }

  /** One line now and then — a 429 storm must not flood the console. */
  private failed(what: string, now: number, fallback: string): void {
    if (now - this.lastWarnAt < WARN_EVERY_MS) {
      this.quietFailures += 1;
      return;
    }
    const more = this.quietFailures > 0 ? ` (${this.quietFailures} more since the last report)` : '';
    this.warn(`advisor call failed — ${what}; ${fallback}${more}`);
    this.lastWarnAt = now;
    this.quietFailures = 0;
  }
}

/** The advisor, or null when there is no key — then bots play on the solver alone. */
export function createAdvisor(options: AdvisorOptions): Advisor | null {
  const apiKey = options.apiKey.trim();
  return apiKey ? new Advisor({ ...options, apiKey }) : null;
}
