/**
 * Pure numbers behind the profile page: the activity heatmap, the day streak,
 * the rating chart and the stat tiles.
 *
 * No I/O and no clock — `today` is always passed in — so every rule here is
 * unit-tested with fixed dates. Days are *local* calendar days: a match played
 * at 23:30 belongs to the day the player saw on their own clock.
 */

/** The fields of one of your seats that these helpers read. */
export interface HistorySeat {
  created_at: string;
  mode: 'casual' | 'ranked';
  score: number;
  elo_before: number;
  elo_after: number;
  elo_delta: number;
  outcome: 'win' | 'loss' | 'draw';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** GitHub's layout: 53 week columns, so the grid always spans a full year. */
export const HEATMAP_WEEKS = 53;

/** Shades above "none". Level 0 is an empty day; 4 is the busiest. */
export const HEATMAP_LEVELS = 4;

/** A local calendar day as "YYYY-MM-DD" — the key matches are grouped by. */
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "4 Sep 2026". Fixed month names, so it reads the same in every locale. */
export function formatDay(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * `date` moved by whole days. Built from the calendar fields rather than by
 * adding milliseconds, so a daylight-saving change never skips or repeats a day.
 */
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** How many matches were played on each local day. Unreadable timestamps are skipped. */
function countByDay(seats: readonly Pick<HistorySeat, 'created_at'>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const seat of seats) {
    const played = new Date(seat.created_at);
    if (Number.isNaN(played.getTime())) continue;
    const key = dayKey(played);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Which shade a day gets. Counts are spread over the four shades up to the
 * busiest day, but that scale never tops out below four matches: with a
 * busiest day of one, a single match would otherwise look like a marathon.
 */
export function activityLevel(count: number, max: number): number {
  if (count <= 0) return 0;
  const top = Math.max(max, HEATMAP_LEVELS);
  return Math.min(HEATMAP_LEVELS, Math.ceil((count / top) * HEATMAP_LEVELS));
}

export interface ActivityDay {
  key: string;
  date: Date;
  count: number;
  level: number;
}

export interface ActivityGrid {
  /** Columns of 7 days, Sunday first. Days after today are null. */
  weeks: (ActivityDay | null)[][];
  /** Matches inside the grid. */
  total: number;
  /** The busiest day's count. */
  max: number;
  /** Month names over the column where each month's first week starts. */
  months: { column: number; label: string }[];
}

/**
 * The heatmap: 53 weeks ending with the week that holds `today`, rows Sunday
 * to Saturday, so today always sits in the last column.
 */
export function activityGrid(
  seats: readonly Pick<HistorySeat, 'created_at'>[],
  today: Date,
): ActivityGrid {
  const counts = countByDay(seats);
  const todayKey = dayKey(today);
  const lastSunday = addDays(today, -today.getDay());
  const firstSunday = addDays(lastSunday, -7 * (HEATMAP_WEEKS - 1));

  const weeks: (ActivityDay | null)[][] = [];
  let total = 0;
  let max = 0;
  // Everything after today in the last column is still to come.
  let future = false;

  for (let week = 0; week < HEATMAP_WEEKS; week += 1) {
    const column: (ActivityDay | null)[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      if (future) {
        column.push(null);
        continue;
      }
      const date = addDays(firstSunday, week * 7 + weekday);
      const key = dayKey(date);
      const count = counts.get(key) ?? 0;
      column.push({ key, date, count, level: 0 });
      total += count;
      max = Math.max(max, count);
      if (key === todayKey) future = true;
    }
    weeks.push(column);
  }

  // Shades need the busiest day, so they are filled in once every day is counted.
  for (const column of weeks) {
    for (const day of column) if (day) day.level = activityLevel(day.count, max);
  }

  return { weeks, total, max, months: monthLabels(firstSunday) };
}

/** Columns a month label spans, so "Sep" fits without running into the next one. */
export const LABEL_COLUMNS = 3;

/**
 * A month is labelled over the first column whose Sunday falls in it. Either
 * end of the grid can hold a sliver of a month too short for its name: the
 * first label is dropped when the next starts less than three columns later,
 * and the last when fewer than three columns are left for it.
 */
function monthLabels(firstSunday: Date): { column: number; label: string }[] {
  const labels: { column: number; label: string }[] = [];
  let previous: number | null = null;
  for (let column = 0; column < HEATMAP_WEEKS; column += 1) {
    const month = addDays(firstSunday, column * 7).getMonth();
    if (month !== previous) labels.push({ column, label: MONTHS[month]! });
    previous = month;
  }
  if (labels.length > 1 && labels[1]!.column - labels[0]!.column < LABEL_COLUMNS) labels.shift();
  if (labels.length > 0 && HEATMAP_WEEKS - labels.at(-1)!.column < LABEL_COLUMNS) labels.pop();
  return labels;
}

/**
 * Consecutive days with at least one match, ending today — or yesterday, since
 * a streak is not broken until today is over without a game.
 */
export function dayStreak(seats: readonly Pick<HistorySeat, 'created_at'>[], today: Date): number {
  const counts = countByDay(seats);
  let day = counts.has(dayKey(today)) ? today : addDays(today, -1);
  let streak = 0;
  while (counts.has(dayKey(day))) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}

export interface RatingPoint {
  /** Rating after the match. */
  elo: number;
  delta: number;
  at: string;
}

export interface RatingSeries {
  /** Rating before the oldest match shown — where the line starts. */
  start: number;
  /** Oldest first. */
  results: RatingPoint[];
  /** Every ranked match in the history, not just the ones shown. */
  total: number;
}

/**
 * The rating chart's line: the last `limit` ranked results, oldest first.
 * Casual matches are left out — they never move a rating.
 */
export function ratingSeries(seats: readonly HistorySeat[], limit = 30): RatingSeries {
  const rated = seats
    .filter((seat) => seat.mode === 'ranked')
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const shown = rated.slice(-limit);

  return {
    start: shown[0]?.elo_before ?? 0,
    results: shown.map((seat) => ({ elo: seat.elo_after, delta: seat.elo_delta, at: seat.created_at })),
    total: rated.length,
  };
}

/**
 * The chart's vertical range, rounded out to whole-number gridlines (steps of
 * 1, 2 or 5 × a power of ten) that enclose every point. Spans under 20 Elo are
 * widened first, so a +3 does not fill the whole chart like a +300 would.
 */
export function ratingDomain(points: readonly number[]): { lo: number; hi: number; ticks: number[] } {
  let min = Math.min(...points);
  let max = Math.max(...points);
  const minSpan = 20;
  if (max - min < minSpan) {
    const middle = (min + max) / 2;
    min = middle - minSpan / 2;
    max = middle + minSpan / 2;
  }

  const raw = (max - min) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const nice = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  const step = Math.max(1, nice * magnitude);

  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let tick = lo; tick <= hi; tick += step) ticks.push(tick);
  return { lo, hi, ticks };
}

/** Highest rating reached after a ranked match, or the current one if that is higher. */
export function bestElo(seats: readonly HistorySeat[], current: number): number {
  return seats.reduce(
    (best, seat) => (seat.mode === 'ranked' ? Math.max(best, seat.elo_after) : best),
    current,
  );
}

/** Every mine you found, across every match. */
export function minesFound(seats: readonly Pick<HistorySeat, 'score'>[]): number {
  return seats.reduce((sum, seat) => sum + seat.score, 0);
}

export interface MatchRecord {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  ranked: number;
  casual: number;
}

/**
 * Results over every recorded match, casual included. The profile row's own
 * wins and losses count ranked matches only (they are the rating's record).
 */
export function record(seats: readonly Pick<HistorySeat, 'mode' | 'outcome'>[]): MatchRecord {
  const tally: MatchRecord = { matches: 0, wins: 0, losses: 0, draws: 0, ranked: 0, casual: 0 };
  for (const seat of seats) {
    tally.matches += 1;
    if (seat.outcome === 'win') tally.wins += 1;
    else if (seat.outcome === 'loss') tally.losses += 1;
    else tally.draws += 1;
    if (seat.mode === 'ranked') tally.ranked += 1;
    else tally.casual += 1;
  }
  return tally;
}

/**
 * "Top N%" for a leaderboard rank, rounded up so first place is never "top 0%".
 * Null when there is no field to compare against.
 */
export function topPercent(rank: number, total: number | null): number | null {
  if (!total || total <= 0 || rank <= 0) return null;
  return Math.min(100, Math.ceil((rank / total) * 100));
}

/** "+224", "−40" (a real minus sign, which screen readers say as "minus"), or "0". */
export function signed(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return '0';
}

/** "Classic 6×6" for the graded board, otherwise just its size. */
export function boardLabel(
  config: { rows?: number; cols?: number; mineCount?: number } | null | undefined,
): string {
  if (!config?.rows || !config?.cols) return '—';
  if (config.rows === 6 && config.cols === 6 && config.mineCount === 11) return 'Classic 6×6';
  return `${config.rows}×${config.cols}`;
}

/** Who you played against, short enough for one table cell. */
export function opponentsLabel(names: readonly string[]): string {
  if (names.length === 0) return '—';
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

/** The avatar letter. Array.from keeps an emoji whole instead of half a surrogate pair. */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : '?';
}
