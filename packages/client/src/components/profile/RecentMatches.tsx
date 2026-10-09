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
    // The table reflows to the card's own width (container queries in
    // styles.css): every column on a desktop, the key five on a tablet, and on a
    // phone a two-line row with the rest folded into a line under the opponent.
    <section className="card recent-card">
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
                <th scope="col" className="col-when">When</th>
                <th scope="col" className="col-mode">Mode</th>
                <th scope="col" className="col-board">Board</th>
                <th scope="col" className="col-opp">Opponents</th>
                <th scope="col" className="num col-mines">Mines</th>
                <th scope="col" className="col-result">Result</th>
                <th scope="col" className="num col-elo">Elo</th>
                <th scope="col" className="col-review">Replay</th>
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
                    <td className="when col-when">
                      <time dateTime={match.created_at} title={formatDay(new Date(match.created_at))}>
                        {relativeTime(match.created_at)}
                      </time>
                    </td>
                    <td className="col-mode">
                      <span className={`tag mode-${match.mode}`}>{match.mode}</span>
                    </td>
                    <td className="col-board">{boardLabel(match.config)}</td>
                    <td className="opponents col-opp">
                      <span className="recent-opp">{opponentsLabel(opponents)}</span>
                      {/* Only shown on a narrow card, where those columns are hidden. */}
                      <span className="recent-meta">
                        {relativeTime(match.created_at)} · {match.mode} · {boardLabel(match.config)} ·{' '}
                        {me ? me.score : '—'}/{match.config?.mineCount ?? '?'} mines
                      </span>
                    </td>
                    <td className="num col-mines">
                      {me ? me.score : '—'} / {match.config?.mineCount ?? '?'}
                    </td>
                    <td className="col-result">
                      {me ? <span className={`recent-result ${me.outcome}`}>{RESULT[me.outcome]}</span> : '—'}
                    </td>
                    <td className="num col-elo">
                      {rated ? (
                        <span className={`profile-since ${deltaTone(me.elo_delta)}`}>{signed(me.elo_delta)}</span>
                      ) : (
                        // Casual matches never move a rating.
                        <span className="muted" title="Casual — no rating change">
                          —
                        </span>
                      )}
                    </td>
                    <td className="review-cell col-review">
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
