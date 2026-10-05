import { percentOf, type MoveReview } from '@fmm/shared';
import { useEffect, useRef } from 'react';
import { seatWord, type SeatTone } from '../../data/reviewModel.js';
import { RatingChip } from './RatingChip.js';

interface Props {
  moves: readonly MoveReview[];
  /** The move shown, from 1. */
  current: number;
  names: string[];
  you: number | null;
  tones: SeatTone[];
  onSelect: (move: number) => void;
}

/**
 * Every move as a row: number, who, the cell, what it was, the chance it had
 * against the best one, and its rating. The current row is highlighted and kept
 * in view as the moves are stepped through — by scrolling the list itself, never
 * the page.
 */
export function MoveList({ moves, current, names, you, tones, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = box.current;
    const row = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !row) return;
    // The list is positioned, so a row's offsetTop is measured from the list itself.
    const top = row.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + row.offsetHeight - list.clientHeight;
    }
  }, [current]);

  return (
    <div className="rv-movelist" ref={box} role="region" aria-label="All moves" tabIndex={0}>
      <ol>
        {moves.map((move) => {
          const sure = move.bestOdds >= 1;
          return (
            <li key={move.n}>
              <button
                type="button"
                className={`rv-move${move.n === current ? ' current' : ''}`}
                aria-current={move.n === current ? 'true' : undefined}
                onClick={() => onSelect(move.n)}
              >
                <span className="rv-move-n">{move.n}</span>
                <span className={`rv-move-who tone-${tones[move.seat] ?? 'p0'}`}>
                  <i className="rv-dot" aria-hidden="true" />
                  {seatWord(move.seat, names, you)}
                </span>
                <span className="rv-move-cell">{move.label}</span>
                <span className="rv-move-result">{move.result === 'mine' ? 'mine' : `empty ${move.adjacent}`}</span>
                <span className="rv-move-odds">
                  {percentOf(move.pickedOdds)}% · best {sure ? '100' : percentOf(move.bestOdds)}%
                </span>
                <RatingChip rating={move.rating} />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
