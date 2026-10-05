import type { Rating } from '@fmm/shared';
import { ratingLabel } from '../../data/reviewModel.js';

/** A move's rating as a small coloured label: green, blue, orange or red, with the words as well, never colour alone. */
export function RatingChip({ rating }: { rating: Rating }) {
  return <span className={`rv-chip rate-${rating}`}>{ratingLabel(rating)}</span>;
}
