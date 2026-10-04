import { msUntilNextDaily } from '@fmm/shared';
import { useEffect, useState } from 'react';
import type { DailyResult } from '../../data/dailyStore.js';
import { DailyShare } from './DailyShare.js';
import { countdownText, dailyLabel, dailyResultSummary, dailyShareText, daysText } from './puzzleCopy.js';

interface Props {
  /** The day being played, 'YYYY-MM-DD' — normally today, yesterday's if the page was left open past midnight. */
  day: string;
  today: string;
  /** How the first try of `day` ended, once it has. */
  result: DailyResult | undefined;
  streak: number;
  bestStreak: number;
}

/** "5 h 12 m" until the next Daily. Has its own tick, so the rest of the screen stays still. */
function NextDaily() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Minutes are all it shows; a few seconds of slack keeps it from lagging a whole one.
    const id = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(id);
  }, []);
  return <strong>{countdownText(msUntilNextDaily(now))}</strong>;
}

/**
 * Under the Daily's bar: what the Daily is and when it resets, and — once the
 * day's first try is over — its result, the streak and the Share button. The
 * result stays up through practice games, since it is the day's result still.
 */
export function DailyPanel({ day, today, result, streak, bestStreak }: Props) {
  const label = dailyLabel(day);
  return (
    <div className="puzzle-daily">
      <p className="muted puzzle-daily-note">
        {label} is the same board for everyone. Your first try is your result; games after it are practice.
      </p>
      <p className="muted puzzle-daily-note">
        {day === today ? (
          <>
            Resets at midnight Bangkok time · next Daily in <NextDaily />
          </>
        ) : (
          'A new Daily is out — press the Daily button to play it.'
        )}
      </p>

      {result && (
        <div className={`puzzle-daily-result ${result.won ? 'won' : 'lost'}`}>
          <p className="puzzle-daily-headline">
            Your {label} result:{' '}
            <strong>
              <span className="puzzle-sr">{result.won ? 'cleared ' : 'hit a mine, '}</span>
              <span aria-hidden="true">{result.won ? '✓' : '✗'} </span>
              {dailyResultSummary(result)}
            </strong>
          </p>
          <p className="muted">
            Streak: {daysText(streak)} · best {daysText(bestStreak)}
          </p>
          <DailyShare text={dailyShareText(day, result)} />
        </div>
      )}
    </div>
  );
}
