import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { heatmapStart } from '../../data/layout.js';
import {
  activityGrid,
  formatDay,
  HEATMAP_LEVELS,
  HEATMAP_WEEKS,
  LABEL_COLUMNS,
  type ActivityDay,
} from '../../data/profileStats.js';
import { useElementWidth } from '../../useMediaQuery.js';

/** Narrower than this, a year of squares is too small to see: the card shows six months. */
const NARROW_PX = 480;

interface Props {
  /** Your seats; only when each match was played is read. */
  seats: readonly { created_at: string }[];
  today: Date;
}

/** Only every other weekday is named, as on GitHub, so the column stays narrow. */
const ROW_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

function describe(day: ActivityDay): string {
  const count = day.count === 0 ? 'No' : String(day.count);
  return `${count} match${day.count === 1 ? '' : 'es'} on ${formatDay(day.date)}`;
}

/**
 * Matches played per day over the last year, GitHub style: one column per week,
 * Sunday at the top, today in the last column.
 *
 * It is an ARIA grid with one tab stop — arrow keys walk the days, each day
 * announces its own count — so the 371 squares never become 371 tab stops.
 * The readout under the grid repeats whatever day is hovered or focused.
 */
export function ActivityHeatmap({ seats, today }: Props) {
  const grid = useMemo(() => activityGrid(seats, today), [seats, today]);
  const lastWeek = HEATMAP_WEEKS - 1;

  /** The one day in the tab order: today until the player moves it. */
  const [cursor, setCursor] = useState<[number, number]>([lastWeek, today.getDay()]);
  const [inspected, setInspected] = useState<ActivityDay | null>(null);
  const cells = useRef(new Map<string, HTMLDivElement>());
  const scroller = useRef<HTMLDivElement>(null);

  // A phone shows the last 26 weeks with squares big enough to see; "Full year"
  // brings back all 53, scrolling sideways. Wider cards always show the year.
  const card = useRef<HTMLElement>(null);
  const width = useElementWidth(card);
  const narrow = width > 0 && width < NARROW_PX;
  const [fullYear, setFullYear] = useState(false);
  const start = heatmapStart(HEATMAP_WEEKS, narrow, fullYear);
  const scrolls = narrow && fullYear;
  // The one day in the tab order must be on show: a cursor left in a hidden
  // week (the card just narrowed) goes back to today.
  const tabStop: [number, number] = cursor[0] < start ? [lastWeek, today.getDay()] : cursor;

  // When the year scrolls sideways, start at today, not a year ago.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (box) box.scrollLeft = box.scrollWidth;
  }, [scrolls]);

  const busiest = useMemo(() => {
    let top: ActivityDay | null = null;
    for (const week of grid.weeks) {
      for (const day of week) if (day && day.count > (top?.count ?? 0)) top = day;
    }
    return top;
  }, [grid]);

  function moveTo(week: number, weekday: number) {
    if (week < start) return; // before the weeks on show
    const target = grid.weeks[week]?.[weekday];
    if (!target) return; // off the grid, or a day still to come
    setCursor([week, weekday]);
    cells.current.get(target.key)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const [week, weekday] = tabStop;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [week - 1, weekday],
      ArrowRight: [week + 1, weekday],
      ArrowUp: [week, weekday - 1],
      ArrowDown: [week, weekday + 1],
      Home: [start, 0],
      End: [lastWeek, today.getDay()],
    };
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    moveTo(next[0], next[1]);
  }

  const total = `${grid.total} match${grid.total === 1 ? '' : 'es'} in the last year`;

  return (
    <section className="card" ref={card}>
      <div className="profile-card-head">
        <h3>Activity</h3>
        <span className="muted">{total}</span>
      </div>

      <div className="heat-scroll" ref={scroller}>
        <div
          className={`heatmap${scrolls ? ' full-year' : ''}`}
          style={{ '--weeks': HEATMAP_WEEKS - start } as CSSProperties}
        >
          <div className="heat-months" aria-hidden="true">
            {grid.months
              .filter((month) => month.column >= start)
              .map((month) => (
                // +2: grid lines count from 1, and the first column holds the day names.
                <span
                  key={month.column}
                  style={{ gridColumn: `${month.column - start + 2} / span ${LABEL_COLUMNS}` }}
                >
                  {month.label}
                </span>
              ))}
          </div>

          <div
            role="grid"
            aria-label={`Matches per day. ${total}.`}
            aria-readonly="true"
            className="heat-grid"
            onKeyDown={onKeyDown}
          >
            {ROW_LABELS.map((label, weekday) => (
              <div role="row" className="heat-row" key={weekday}>
                <span className="heat-day" aria-hidden="true">
                  {label}
                </span>
                {grid.weeks.map((week, index) => {
                  if (index < start) return null;
                  const day = week[weekday];
                  if (!day) return <span key={index} className="heat-cell is-future" aria-hidden="true" />;
                  const text = describe(day);
                  const isCursor = tabStop[0] === index && tabStop[1] === weekday;
                  return (
                    <div
                      key={day.key}
                      ref={(node) => {
                        if (node) cells.current.set(day.key, node);
                        else cells.current.delete(day.key);
                      }}
                      role="gridcell"
                      tabIndex={isCursor ? 0 : -1}
                      aria-label={text}
                      title={text}
                      className={`heat-cell level-${day.level}`}
                      onFocus={() => {
                        setCursor([index, weekday]);
                        setInspected(day);
                      }}
                      onBlur={() => setInspected(null)}
                      onPointerEnter={() => setInspected(day)}
                      onPointerLeave={() => setInspected(null)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="heat-foot">
        <p className="muted heat-readout">
          {inspected
            ? describe(inspected)
            : busiest
              ? `Busiest day: ${describe(busiest)}`
              : 'No matches in the last year yet.'}
        </p>
        {narrow && (
          <button type="button" className="ghost small heat-range" onClick={() => setFullYear((full) => !full)}>
            {fullYear ? 'Last 6 months' : 'Full year'}
          </button>
        )}
        <div className="heat-legend" aria-hidden="true">
          Less
          {Array.from({ length: HEATMAP_LEVELS + 1 }, (_, level) => (
            <span key={level} className={`heat-cell level-${level}`} />
          ))}
          More
        </div>
      </div>
    </section>
  );
}
