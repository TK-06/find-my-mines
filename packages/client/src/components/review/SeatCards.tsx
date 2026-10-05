import type { Review } from '@fmm/shared';
import { accuracyLabel, ratingSummary, type SeatTone } from '../../data/reviewModel.js';

interface Props {
  review: Review;
  you: number | null;
  tones: SeatTone[];
}

/**
 * One card per seat: who they are, how many mines they found, how accurate
 * their picks were, and how many were the best available or passed over a sure
 * mine. The winner (when the game was played out and nobody tied) wears a Win tag.
 */
export function SeatCards({ review, you, tones }: Props) {
  return (
    <ul className="rv-seats">
      {review.seats.map((seat) => (
        <li key={seat.seat} className={`card rv-seat${seat.seat === you ? ' is-you' : ''}`}>
          <div className="rv-seat-name">
            <i className={`rv-dot tone-${tones[seat.seat] ?? 'p0'}`} aria-hidden="true" />
            <strong>{seat.name}</strong>
            {seat.seat === you && <span className="tag me">you</span>}
            {seat.bot && <span className="tag bot">computer</span>}
            {review.winner === seat.seat && <span className="tag winner">Win</span>}
          </div>
          <div className="rv-seat-figures">
            <span className="rv-accuracy" aria-label={`Accuracy ${accuracyLabel(seat.accuracy)}`}>
              {accuracyLabel(seat.accuracy)}
            </span>
            <span className="muted">accuracy</span>
            <span className="rv-seat-score">
              {seat.score} mine{seat.score === 1 ? '' : 's'}
            </span>
          </div>
          <p className="muted rv-seat-note">{ratingSummary(seat)}</p>
        </li>
      ))}
    </ul>
  );
}
