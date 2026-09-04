import { deltaTone, describeBoard, formatDelta, orderSeats, relativeTime } from '../data/format.js';
import type { MatchRow } from '../data/queries.js';

interface Props {
  match: MatchRow;
  /** When set, that seat is highlighted as "you". */
  highlightProfileId?: string | null;
}

/** One finished match: board, mode, and every seat with its result. */
export function MatchCard({ match, highlightProfileId }: Props) {
  const seats = orderSeats(match.players);

  return (
    <li className="match-card card">
      <div className="match-head">
        <span className="room-code">{match.room_id}</span>
        <span className={`tag mode-${match.mode}`}>{match.mode}</span>
        <span className="muted">{describeBoard(match.config)}</span>
        <span className="muted match-when">{relativeTime(match.created_at)}</span>
      </div>

      {seats.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No seat data recorded.
        </p>
      ) : (
        <ul className="seat-list">
          {seats.map((seat) => {
            const isMe = highlightProfileId != null && seat.profile_id === highlightProfileId;
            const won = seat.outcome === 'win';

            return (
              <li key={seat.id} className={`seat ${isMe ? 'is-me' : ''}`}>
                <span className="seat-place">{seat.placement}</span>
                <span className="seat-name">
                  {seat.display_name}
                  {won && ' 👑'}
                  {seat.is_guest && <span className="tag spectator">guest</span>}
                  {isMe && <span className="tag me">you</span>}
                </span>
                <span className="seat-score">
                  {seat.score} mines
                  {/* Casual matches record a zero delta; don't imply a change. */}
                  {match.mode === 'ranked' && !seat.is_guest && (
                    <span className={`elo-delta ${deltaTone(seat.elo_delta)}`}>
                      {formatDelta(seat.elo_delta)}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
