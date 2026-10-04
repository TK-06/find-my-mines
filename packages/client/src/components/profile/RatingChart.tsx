import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { deltaTone } from '../../data/format.js';
import { formatDay, ratingDomain, signed, type RatingSeries } from '../../data/profileStats.js';

interface Props {
  series: RatingSeries;
  /** Current rating minus the starting rating. */
  sinceJoining: number;
  /** False on someone else's profile page, where "your" would be wrong. */
  own?: boolean;
}

/**
 * Your rating over recent ranked matches, one step per match.
 *
 * The line is SVG stretched to the card (viewBox + width 100%, aspect ratio
 * free, strokes that don't scale), while the labels and dots are HTML laid over
 * it by percentage — so text stays crisp and readable at any width instead of
 * shrinking with the drawing on a phone.
 *
 * Hover or arrow keys move a crosshair between matches; the readout under the
 * chart says the value, so nothing is only reachable by pointing.
 */
export function RatingChart({ series, sinceJoining, own = true }: Props) {
  /** Index into `points`: 0 is where the line starts, n is after the nth match. */
  const [active, setActive] = useState<number | null>(null);

  const shown = series.results.length;
  const scope =
    series.total > shown
      ? `last ${shown} ranked matches`
      : shown === 1
        ? own
          ? 'your first ranked match'
          : 'their first ranked match'
        : `all ${shown} ranked matches`;

  const head = (
    <div className="profile-card-head">
      <h3>
        Rating {shown > 0 && <span className="muted">· {scope}</span>}
      </h3>
      {shown > 0 && (
        <span className={`profile-since ${deltaTone(sinceJoining)}`}>
          {signed(sinceJoining)} since joining
        </span>
      )}
    </div>
  );

  if (shown === 0) {
    return (
      <section className="card">
        {head}
        {own ? (
          <p className="muted">
            No ranked matches yet. Play a <strong>Ranked</strong> room while signed in and your
            rating line starts here.
          </p>
        ) : (
          <p className="muted">No ranked matches yet.</p>
        )}
      </section>
    );
  }

  const points = [series.start, ...series.results.map((result) => result.elo)];
  const last = points.length - 1;
  const { lo, hi, ticks } = ratingDomain(points);
  const x = (index: number) => (index / last) * 100;
  const y = (value: number) => ((hi - value) / (hi - lo)) * 100;

  const summary = `Rating went from ${series.start} to ${points[last]} over ${
    series.total > shown ? `the last ${shown}` : shown
  } ranked match${shown === 1 ? '' : 'es'}`;

  const focus = active ?? last;
  const result = focus > 0 ? series.results[focus - 1]! : null;

  function pick(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setActive(Math.round(fraction * last));
  }

  function step(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = {
      ArrowLeft: Math.max(0, focus - 1),
      ArrowRight: Math.min(last, focus + 1),
      Home: 0,
      End: last,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    setActive(moves[event.key]!);
  }

  return (
    <section className="card">
      {head}

      <div className="rating-chart">
        <div className="rating-axis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ top: `${y(tick)}%` }}>
              {tick}
            </span>
          ))}
        </div>

        <div
          className="rating-plot"
          role="img"
          aria-label={summary}
          tabIndex={0}
          onPointerMove={pick}
          onPointerLeave={() => setActive(null)}
          onKeyDown={step}
          onBlur={() => setActive(null)}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            {ticks.map((tick) => (
              <line
                key={tick}
                className="rating-grid"
                x1={0}
                x2={100}
                y1={y(tick)}
                y2={y(tick)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <polyline
              className="rating-line"
              points={points.map((value, index) => `${x(index)},${y(value)}`).join(' ')}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {active !== null && <span className="rating-crosshair" style={{ left: `${x(focus)}%` }} />}
          <span className="rating-dot" style={{ left: `${x(focus)}%`, top: `${y(points[focus]!)}%` }} />
        </div>

        <div className="rating-x" aria-hidden="true">
          <span>{formatDay(new Date(series.results[0]!.at))}</span>
          {shown > 1 && <span>{formatDay(new Date(series.results[shown - 1]!.at))}</span>}
        </div>
      </div>

      <p className="rating-readout" aria-live="polite">
        <strong>{points[focus]}</strong>{' '}
        {result ? (
          <>
            <span className={`profile-since ${deltaTone(result.delta)}`}>{signed(result.delta)}</span>
            {' · '}
            {focus === last && active === null ? 'latest' : `match ${focus} of ${shown}`}
            {' · '}
            {formatDay(new Date(result.at))}
          </>
        ) : (
          'before the first match shown'
        )}
      </p>
    </section>
  );
}
