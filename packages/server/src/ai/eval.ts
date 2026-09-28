/**
 * Which Groq model should advise the bot? Asks each one the same questions and
 * scores the answers.
 *
 *   npm run ai:eval --workspace @fmm/server
 *
 * Env (the repo-root .env is read if present):
 *   GROQ_API_KEY  required — never printed
 *   AI_MODELS     comma list, default "openai/gpt-oss-20b,llama-3.1-8b-instant"
 *   EVAL_BOARDS   how many boards, default 20
 *
 * The boards are seeded mid-game Classic boards built with the real engine, so
 * this script — unlike the bot — knows where the mines are and can tell
 * whether a chosen cell really is one. Each board offers the solver's five
 * likeliest covered cells, so every model has a real choice to make; the
 * solver's own top pick is the baseline to beat.
 *
 * Calls go one at a time, spaced to stay under the free tier's 30 requests
 * and 8K tokens a minute; a 429 waits out its retry-after and tries again.
 */
import {
  CLASSIC_PRESET,
  cellLabel,
  createBoard,
  createRng,
  mineProbabilities,
  revealCell,
  type CellRef,
  type RevealedCell,
} from '@fmm/shared';
import { GROQ_API_KEY } from '../config.js';
import { RateBudget, askModel, retryAfterMs, type AskOutcome } from './advisor.js';
import type { Candidate, PromptInput } from './prompt.js';

const DEFAULT_MODELS = 'openai/gpt-oss-20b,llama-3.1-8b-instant';
const CANDIDATE_COUNT = 5;
/** Generous on purpose: this measures latency. The game itself cuts a call off at ~4 s. */
const TIMEOUT_MS = 8_000;
const MAX_RETRIES = 3;

interface EvalBoard {
  input: PromptInput;
  isMine: (cell: CellRef) => boolean;
  solverPick: CellRef;
}

interface Result {
  outcome: AskOutcome;
  board: EvalBoard;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A Classic board part-way through a match: 30–55% of the cells open, at least one mine still hidden. */
function buildBoard(seed: number): EvalBoard {
  const rng = createRng(seed);
  const { rows, cols, mineCount } = CLASSIC_PRESET;
  const board = createBoard({ rows, cols, bombCount: mineCount }, rng);

  const cells: CellRef[] = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) cells.push({ row, col });
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cells[i], cells[j]] = [cells[j]!, cells[i]!];
  }

  const target = Math.floor(rows * cols * (0.3 + rng() * 0.25));
  const revealed: RevealedCell[] = [];
  let found = 0;
  const score = { you: 0, opponent: 0 };
  for (const { row, col } of cells) {
    if (revealed.length >= target) break;
    if (board.bombs[row]![col] && found === mineCount - 1) continue;
    const outcome = revealCell(board, row, col);
    if (!outcome.ok) continue;
    // Share the found mines between the two sides, so the scores look like a real match.
    const by = found % 2 === 0 ? 'you' : 'opponent';
    if (outcome.kind === 'bomb') {
      found++;
      score[by]++;
    }
    revealed.push({ row, col, kind: outcome.kind, adjacent: outcome.adjacent, byPlayerId: by });
  }

  const grid = mineProbabilities({ rows, cols, mineCount, revealed });
  const covered: Candidate[] = [];
  grid.forEach((line, row) =>
    line.forEach((probability, col) => {
      if (probability !== null) covered.push({ cell: { row, col }, probability });
    }),
  );
  // Likeliest first; a stable sort keeps board order among equals.
  const candidates = covered.sort((a, b) => b.probability - a.probability).slice(0, CANDIDATE_COUNT);

  return {
    input: { level: 'hard', view: { rows, cols, bombCount: mineCount, revealed }, scores: score, candidates },
    isMine: (cell) => board.bombs[cell.row]![cell.col]!,
    solverPick: candidates[0]!.cell,
  };
}

async function ask(model: string, board: EvalBoard, budget: RateBudget): Promise<AskOutcome> {
  for (let attempt = 0; ; attempt++) {
    const wait = budget.waitMs(Date.now());
    if (wait > 0) await sleep(wait);
    budget.take(Date.now());

    const outcome = await askModel({ apiKey: GROQ_API_KEY, model, input: board.input, timeoutMs: TIMEOUT_MS });
    if (outcome.kind === 'ok' || outcome.kind === 'invalid') budget.noteTokens(Date.now(), outcome.tokens);

    if (outcome.kind === 'http' && outcome.status === 429 && attempt < MAX_RETRIES) {
      const pause = retryAfterMs(outcome.retryAfter, Date.now());
      process.stdout.write(`  (429 — waiting ${Math.ceil(pause / 1000)} s)\n`);
      budget.pauseUntil(Date.now() + pause);
      continue;
    }
    return outcome;
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

const pct = (part: number, whole: number) => (whole === 0 ? '—' : `${Math.round((100 * part) / whole)}%`);
const ms = (value: number) => (Number.isFinite(value) ? `${Math.round(value)} ms` : '—');

function failureSummary(results: Result[]): string {
  const counts = new Map<string, number>();
  for (const { outcome } of results) {
    if (outcome.kind === 'ok') continue;
    const label = outcome.kind === 'http' ? `HTTP ${outcome.status}` : outcome.kind;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => `${count}× ${label}`).join(', ') || '—';
}

function report(model: string, results: Result[]): string[] {
  const valid = results.filter((r) => r.outcome.kind === 'ok');
  const answered = results
    .filter((r) => r.outcome.kind === 'ok' || r.outcome.kind === 'invalid')
    .map((r) => r.outcome.ms)
    .sort((a, b) => a - b);
  const tokens = results
    .map((r) => (r.outcome.kind === 'ok' || r.outcome.kind === 'invalid' ? r.outcome.tokens : 0))
    .filter((t) => t > 0);
  let hits = 0;
  let agrees = 0;
  const lines: string[] = [];
  for (const { outcome, board } of valid) {
    if (outcome.kind !== 'ok') continue;
    const cell = outcome.advice.cell;
    if (board.isMine(cell)) hits++;
    if (cellLabel(cell) === cellLabel(board.solverPick)) agrees++;
    if (outcome.advice.say && lines.length < 3) lines.push(outcome.advice.say);
  }

  return [
    `${model}`,
    `  valid answers   ${pct(valid.length, results.length)}  (${valid.length}/${results.length})`,
    `  latency         median ${ms(percentile(answered, 50))}, p95 ${ms(percentile(answered, 95))}`,
    `  hit             ${pct(hits, valid.length)}  (chose a real mine)`,
    `  agreement       ${pct(agrees, valid.length)}  (same cell as the solver's top pick)`,
    `  tokens / call   ${tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : '—'}`,
    `  failures        ${failureSummary(results)}`,
    ...lines.map((line) => `  says            "${line}"`),
  ];
}

async function main(): Promise<void> {
  if (!GROQ_API_KEY.trim()) {
    console.error('GROQ_API_KEY is not set (put it in the repo-root .env). Nothing to compare.');
    process.exit(1);
  }

  const models = (process.env.AI_MODELS ?? DEFAULT_MODELS)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const count = Math.min(200, Math.max(1, Number.parseInt(process.env.EVAL_BOARDS ?? '20', 10) || 20));
  const boards = Array.from({ length: count }, (_, i) => buildBoard(1_000 + i));
  const solverHits = boards.filter((b) => b.isMine(b.solverPick)).length;

  console.log(`\nFind My Mines — advisor model comparison`);
  console.log(
    `${count} seeded mid-game Classic boards, ${CANDIDATE_COUNT} candidates each, ` +
      `timeout ${TIMEOUT_MS} ms, ${models.length} model(s)\n`,
  );

  // Under the free tier's 30 requests / 8K tokens a minute, shared by every model here.
  const budget = new RateBudget(28, 7_000);
  const sections: string[][] = [];
  for (const model of models) {
    const results: Result[] = [];
    for (const [index, board] of boards.entries()) {
      const outcome = await ask(model, board, budget);
      results.push({ outcome, board });
      process.stdout.write(`  ${model}  ${index + 1}/${count}  ${outcome.kind}${outcome.kind === 'http' ? ` ${outcome.status}` : ''}\n`);
    }
    sections.push(report(model, results));
  }

  console.log('');
  for (const section of sections) console.log(`${section.join('\n')}\n`);
  console.log(`solver alone (top pick)`);
  console.log(`  hit             ${pct(solverHits, count)}  (${solverHits}/${count}) — the baseline\n`);
}

main().catch((error: unknown) => {
  // Never the request itself — it carries the key in its headers.
  console.error('ai:eval failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
