import { puzzleCellLabel, puzzleColumnName, percentOf, type Replay, type Review } from '@fmm/shared';
import { useMemo, type CSSProperties, type KeyboardEvent } from 'react';
import { oddsTint, stepMove, type SeatTone } from '../../data/reviewModel.js';
import { MineSprite } from '../MineSprite.js';

/** The three switches over the board. */
export interface ReviewFilters {
  /** Each covered slot's chance of being a mine, as a tint and a percentage. */
  odds: boolean;
  /** Where every mine was. */
  mines: boolean;
  /** A star on the likeliest slot. */
  best: boolean;
}

interface Props {
  replay: Replay;
  review: Review;
  /** The move shown, from 1. The board is drawn as it was just BEFORE that move. */
  move: number;
  filters: ReviewFilters;
  /** The colour class of each seat's found mines. */
  tones: SeatTone[];
  /** Everyone's name, for the cell descriptions. */
  names: string[];
  /** Arrow keys on the focused board step through the moves. */
  onStep: (move: number) => void;
}

interface OpenCell {
  mine: boolean;
  adjacent: number;
  seat: number;
}

function StarIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="m8 1.6 1.9 4.1 4.5.5-3.3 3.1.9 4.4L8 11.5l-4 2.2.9-4.4L1.6 6.2l4.5-.5z" fill="currentColor" />
    </svg>
  );
}

/**
 * The board as it was just before the selected move, drawn from the replay and
 * its review: the numbers and mines already opened, every covered slot tinted by
 * its chance of being a mine, and rings, stars and mine marks on request.
 *
 * The cells are pictures with labels, not buttons: the board is one focusable
 * area, and the arrow keys on it step through the moves (no key handler is
 * attached to the page itself).
 */
export function ReviewBoard({ replay, review, move, filters, tones, names, onStep }: Props) {
  const { rows, cols } = replay;
  const total = review.moves.length;
  const current = review.moves[move - 1];
  const grid = review.odds[move - 1];

  const isMine = useMemo(() => new Set(replay.mines), [replay]);
  /** Cells already open when the selected move is about to be made. */
  const open = useMemo(() => {
    const cells = new Map<number, OpenCell>();
    for (let i = 0; i < move - 1; i++) {
      const played = review.moves[i]!;
      cells.set(played.cell, { mine: played.result === 'mine', adjacent: played.adjacent, seat: played.seat });
    }
    return cells;
  }, [review, move]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Never take a key meant for something else (a browser shortcut).
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = stepMove(move, event.key, total);
    if (next === null) return;
    event.preventDefault();
    onStep(next);
  };

  const style = { '--cols': cols, '--rows': rows } as CSSProperties;
  // How much a cell has room to say: the % sign goes first, then the number itself on a phone.
  const size = cols <= 10 ? 's' : cols <= 13 ? 'm' : 'l';

  return (
    <div
      className={`rv-board size-${size}${filters.odds ? ' with-odds' : ''}`}
      style={style}
      tabIndex={0}
      role="group"
      aria-label={`Board just before move ${move} of ${total}. The arrow keys step through the moves.`}
      onKeyDown={onKeyDown}
    >
      <div className="rv-grid">
        <span className="ruler corner" aria-hidden="true" />
        {Array.from({ length: cols }, (_, col) => (
          <span key={`c${col}`} className="ruler" aria-hidden="true">
            {puzzleColumnName(col)}
          </span>
        ))}

        {Array.from({ length: rows }).flatMap((_, row) => [
          <span key={`r${row}`} className="ruler" aria-hidden="true">
            {row + 1}
          </span>,
          ...Array.from({ length: cols }, (__, col) => {
            const index = row * cols + col;
            const label = puzzleCellLabel({ row, col });
            const opened = open.get(index);

            if (opened) {
              if (opened.mine) {
                const finder = names[opened.seat] ?? 'someone';
                return (
                  <div
                    key={index}
                    className={`rv-cell found tone-${tones[opened.seat] ?? 'p0'}`}
                    role="img"
                    aria-label={`${label}, mine found by ${finder}`}
                  >
                    <MineSprite />
                  </div>
                );
              }
              return (
                <div
                  key={index}
                  className="rv-cell open"
                  data-n={opened.adjacent > 0 ? opened.adjacent : undefined}
                  role="img"
                  aria-label={`${label}, open, ${opened.adjacent} mines around`}
                >
                  {opened.adjacent > 0 ? opened.adjacent : ''}
                </div>
              );
            }

            // Covered: tinted by its chance of being a mine when odds are on.
            const chance = grid?.[row]?.[col] ?? null;
            const isBest = filters.best && current?.bestCell === index;
            const isOpenedNow = current?.cell === index;
            const showMine = filters.mines && isMine.has(index);
            const classes = ['rv-cell', 'covered'];
            if (filters.odds) classes.push('tinted');
            if (isOpenedNow) classes.push('now');
            if (showMine) classes.push('is-mine');
            const said = [
              `${label}, covered`,
              filters.odds && chance !== null ? `${percentOf(chance)}% chance of a mine` : null,
              isBest ? 'best pick' : null,
              showMine ? 'a mine' : null,
              isOpenedNow ? 'opened on this move' : null,
            ];

            return (
              <div
                key={index}
                className={classes.join(' ')}
                style={filters.odds ? ({ '--odds': oddsTint(chance) } as CSSProperties) : undefined}
                // A strong tint is orange enough to need dark text.
                data-hot={filters.odds && oddsTint(chance) >= 60 ? '' : undefined}
                role="img"
                aria-label={said.filter(Boolean).join(', ')}
              >
                {filters.odds && chance !== null && (
                  <span className="rv-odds">
                    {percentOf(chance)}
                    <i>%</i>
                  </span>
                )}
                {showMine && (
                  <span className="rv-mine">
                    <MineSprite />
                  </span>
                )}
                {isBest && (
                  <span className="rv-star" aria-hidden="true">
                    <StarIcon />
                  </span>
                )}
              </div>
            );
          }),
        ])}
      </div>
    </div>
  );
}
