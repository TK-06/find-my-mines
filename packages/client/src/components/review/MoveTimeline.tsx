import { RATING_LABELS, type MoveReview } from '@fmm/shared';
import { seatWord, stepMove } from '../../data/reviewModel.js';
import type { KeyboardEvent } from 'react';

interface Props {
  moves: readonly MoveReview[];
  /** The move shown, from 1. */
  current: number;
  names: string[];
  you: number | null;
  onSelect: (move: number) => void;
}

/**
 * Every move as a thin tick, coloured by its rating, in one row. A tick is a
 * button that jumps to its move, labelled for a screen reader ("Move 9, Ben,
 * F1, missed a sure mine"). Only the current tick is in the tab order — one
 * stop, not a few hundred — and the arrow keys move along the row.
 */
export function MoveTimeline({ moves, current, names, you, onSelect }: Props) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = stepMove(current, event.key, moves.length);
    if (next === null) return;
    event.preventDefault();
    onSelect(next);
    // Keep the focus on the tick that is now current.
    (event.currentTarget.children[next - 1] as HTMLElement | undefined)?.focus();
  };

  return (
    <div className="rv-timeline" role="group" aria-label="Timeline of moves, coloured by rating" onKeyDown={onKeyDown}>
      {moves.map((move) => (
        <button
          key={move.n}
          type="button"
          className={`rv-tick rate-${move.rating}${move.n === current ? ' current' : ''}`}
          tabIndex={move.n === current ? 0 : -1}
          aria-label={`Move ${move.n}, ${seatWord(move.seat, names, you)}, ${move.label}, ${RATING_LABELS[move.rating].toLowerCase()}`}
          aria-current={move.n === current ? 'step' : undefined}
          onClick={() => onSelect(move.n)}
        />
      ))}
    </div>
  );
}
