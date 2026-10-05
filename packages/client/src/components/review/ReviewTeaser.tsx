import type { LatestReplay } from '../../data/latestReplay.js';
import { teaserOf } from '../../data/reviewModel.js';
import { useReview } from '../../data/useReview.js';
import { ReviewIcon } from './ReviewIcon.js';

/**
 * The dark card on the end-of-game popup: your accuracy in big orange numbers
 * next to your opponent's, one line about the first key moment, and a full-width
 * Review game button. A spectator gets the button alone, with no accuracy of
 * their own to show. While the review is still being worked out the button is
 * already there, with a quiet "analysing…" where the numbers will be.
 *
 * It asks for the same review the review screen does, so by the time the button
 * is pressed the page usually opens with everything done.
 */
export function ReviewTeaser({
  latest,
  spectator,
  onReview,
}: {
  latest: LatestReplay;
  spectator: boolean;
  onReview: () => void;
}) {
  const status = useReview(latest.replay);
  const teaser = status.phase === 'ready' ? teaserOf(status.review, spectator ? null : latest.you) : null;
  // Only a player has an accuracy of their own; a spectator's card is the button.
  const showFigures = !spectator && (status.phase === 'running' || status.phase === 'idle' || teaser?.yours != null);

  return (
    <div className="rv-teaser">
      {showFigures &&
        (teaser?.yours ? (
          <div className="rv-teaser-figures">
            <span className="rv-teaser-accuracy">{teaser.yours}</span>
            <span className="rv-teaser-caption">
              your accuracy
              {teaser.opponent && (
                <>
                  {' · '}
                  {teaser.opponent.name} {teaser.opponent.accuracy}
                </>
              )}
            </span>
          </div>
        ) : (
          <p className="rv-teaser-wait" role="status">
            analysing…
          </p>
        ))}
      {!spectator && teaser?.moment && <p className="rv-teaser-moment">{teaser.moment}</p>}
      <button type="button" className="rv-teaser-button" onClick={onReview}>
        <ReviewIcon />
        Review game
      </button>
    </div>
  );
}
