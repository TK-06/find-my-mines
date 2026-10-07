import { deltaTone, relativeTime } from '../../data/format.js';
import { boardLabel, formatDay, opponentsLabel, signed } from '../../data/profileStats.js';
import type { MatchRow } from '../../data/queries.js';
import { ReviewLink } from '../review/ReviewLink.js';

interface Props {
  /** Newest first, each with every seat. */
  matches: MatchRow[];
  userId: string;
  /** The card's heading; someone else's profile says "Recent matches". */
  title?: string;
  /** Opens a match's review without a page reload. */
  onOpenReview?: (matchId: string) => void;
}

const RESULT = { win: 'Win', loss: 'Loss', draw: 'Draw' } as const;

/**
 * Your last few matches as one compact table — a row each, read from your own
 * seat. Only the latest few are listed: the full game log is an admin tool.
 */
export function RecentMatches({ matches, userId, title = 'Your recent matches', onOpenReview }: Props) {
  return (
    <section className="card">
      <div className="profile-card-head">
        <h3>{title}</h3>
      </div>

      {matches.length === 0 ? (
        <p className="muted">No matches yet. Play a game and it will show up here.</p>
      ) : (
        <div className="recent-scroll">
          <table className="recent-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Mode</th>
                <th scope="col">Board</th>
                <th scope="col">Opponents</th>
                <th scope="col" className="num">Mines</th>
                <th scope="col">Result</th>
                <th scope="col" className="num">Elo</th>
                <th scope="col">Replay</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((match) => {
                const me = match.players.find((seat) => seat.profile_id === userId);
                const opponents = match.players
                  .filter((seat) => seat !== me)
                  .map((seat) => seat.display_name);
                const rated = match.mode === 'ranked' && me !== undefined;

                return (
                  <tr key={match.id}>
                    <td className="when">
                      <time dateTime={match.created_at} title={formatDay(new Date(match.created_at))}>
                        {relativeTime(match.created_at)}
                      </time>
                    </td>
                    <td>
                      <span className={`tag mode-${match.mode}`}>{match.mode}</span>
                    </td>
                    <td>{boardLabel(match.config)}</td>
                    <td className="opponents">{opponentsLabel(opponents)}</td>
                    <td className="num">
                      {me ? me.score : '—'} / {match.config?.mineCount ?? '?'}
                    </td>
                    <td>
                      {me ? <span className={`recent-result ${me.outcome}`}>{RESULT[me.outcome]}</span> : '—'}
                    </td>
                    <td className="num">
                      {rated ? (
                        <span className={`profile-since ${deltaTone(me.elo_delta)}`}>{signed(me.elo_delta)}</span>
                      ) : (
                        // Casual matches never move a rating.
                        <span className="muted" title="Casual — no rating change">
                          —
                        </span>
                      )}
                    </td>
                    <td className="review-cell">
                      <ReviewLink matchId={match.id} hasReplay={match.has_replay} onOpen={onOpenReview} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
