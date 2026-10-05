import { isPlainLeftClick, pathForReview } from '../../router.js';
import { ReviewIcon } from './ReviewIcon.js';

/**
 * The Review button on a saved match: an orange-outlined link to its review page
 * (`/review/<id>`), so a middle click or "open in a new tab" works as on any
 * link, and a plain click opens it without a page reload. A match saved without
 * a replay (an older one, or before the database has the column) gets a dashed,
 * disabled "No replay saved" instead of a link that goes nowhere.
 */
export function ReviewLink({
  matchId,
  hasReplay,
  onOpen,
}: {
  matchId: string;
  hasReplay: boolean;
  onOpen?: (matchId: string) => void;
}) {
  if (!hasReplay) {
    return (
      <span className="rv-review-btn none" aria-disabled="true">
        No replay saved
      </span>
    );
  }

  return (
    <a
      className="rv-review-btn"
      href={pathForReview(matchId)}
      onClick={(event) => {
        if (!onOpen || !isPlainLeftClick(event)) return;
        event.preventDefault();
        onOpen(matchId);
      }}
    >
      <ReviewIcon size={16} />
      Review
    </a>
  );
}
