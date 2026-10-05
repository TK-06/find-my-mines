import type { ForfeitNotice, PlayerPublic, PublicMatchState } from '@fmm/shared';
import { eloChangeText, eloChangeTone } from '../data/format.js';
import type { UnofficialChange } from '../data/guestCookie.js';
import type { LatestReplay } from '../data/latestReplay.js';
import { ReviewTeaser } from './review/ReviewTeaser.js';

interface Props {
  state: PublicMatchState;
  myId: string | null;
  isSpectator: boolean;
  onRematch: () => void;
  onLeave: () => void;
  /** A guest's own, unofficial change for this match, once the browser has worked it out. */
  guestChange?: UnofficialChange | null;
  /** The replay of the match that just ended, once it has arrived: it earns the popup its Review game card. */
  replay?: LatestReplay | null;
  /** Opens the game's review. The popup comes back when you return to the game. */
  onReview?: () => void;
}

/**
 * Your rating change, worded for the result screen. `after` is the new rating,
 * so the old one is worked back from the delta. Plain text throughout: a screen
 * reader says "plus 14 Elo, 812 to 826" without any help.
 */
function EloChange({ delta, after }: { delta: number; after: number }) {
  return (
    <p className={`elo-change ${eloChangeTone(delta)}`}>
      <span className="amount">{eloChangeText(delta)} Elo</span>
      <span className="range">
        {after - delta} → {after}
      </span>
    </p>
  );
}

/**
 * What a guest sees instead of a rating change. The server rates a guest as a
 * fixed 800 and keeps nothing, so the figure is the browser's own, and is
 * called unofficial every time it is shown. Without one (this browser did not
 * see the match played) there is only the pointer to signing in.
 */
function GuestEloNote({ change }: { change: UnofficialChange | null | undefined }) {
  if (!change) return <p className="elo-change guest">Guests have no official rating. Sign in to earn Elo.</p>;
  return (
    <>
      <p className={`elo-change ${eloChangeTone(change.delta)}`}>
        <span className="amount">{eloChangeText(change.delta)} Elo</span>
        <span className="unofficial"> (unofficial)</span>
        <span className="range">
          {change.before} → {change.after}
        </span>
      </p>
      <p className="elo-change guest">Sign in to make it count.</p>
    </>
  );
}

/** The per-row tag beside a score. A draw between equals shows as flat ±0. */
function EloTag({ delta }: { delta: number }) {
  return <span className={`elo-delta ${eloChangeTone(delta)}`}>{eloChangeText(delta)}</span>;
}

/**
 * Spec: "When the match ends, the game clients display the player's status as
 * 'Win' or 'Lost' along with the current scores of both players and a Rematch
 * button."
 *
 * Each player independently picks Rematch or Leave. Leaving shrinks the vote
 * pool, so one person walking away never deadlocks the others.
 */
export function ResultOverlay({ state, myId, isSpectator, onRematch, onLeave, guestChange, replay, onReview }: Props) {
  const iWon = state.winnerId !== null && state.winnerId === myId;
  const draw = state.winnerId === null;
  const alreadyVoted = myId !== null && state.rematchVotes.includes(myId);
  const votes = state.rematchVotes.length;
  const seats = state.players.length;

  const winner = state.players.find((p) => p.id === state.winnerId);
  const ranked = [...state.players].sort((a, b) => b.score - a.score);

  // Only a ranked match moves ratings, and a spectator has none of their own to show.
  const showElo = state.config.mode === 'ranked' && !isSpectator;
  const me = state.players.find((p) => p.id === myId);

  const verdict = isSpectator ? (winner?.nickname ?? 'Draw') : draw ? 'Draw' : iWon ? 'Win' : 'Lost';
  const verdictClass = isSpectator || draw ? 'draw' : iWon ? 'win' : 'lost';

  return (
    <div className="overlay">
      <div className="card result">
        <p className="muted" style={{ margin: 0 }}>
          All {state.bombCount} mines found
        </p>
        <h2 className={`verdict ${verdictClass}`}>{verdict}</h2>
        {isSpectator && <p className="muted">You were spectating this match.</p>}
        {showElo && me?.isGuest && <GuestEloNote change={guestChange} />}
        {showElo && me && !me.isGuest && me.eloDelta !== undefined && (
          <EloChange delta={me.eloDelta} after={me.elo} />
        )}

        <div className="final">
          {ranked.map((player) => (
            <div className="line" key={player.id}>
              <span>
                {player.nickname}
                {player.id === myId && <span className="tag me">you</span>}
                {player.id === state.winnerId && <span className="tag winner">winner</span>}
                {state.rematchVotes.includes(player.id) && (
                  <span className="tag ready" style={{ marginLeft: 8 }}>
                    ready
                  </span>
                )}
              </span>
              <span>
                <strong>{player.score}</strong>
                {showElo && isRated(player) && <EloTag delta={player.eloDelta} />}
              </span>
            </div>
          ))}
        </div>

        {replay && onReview && <ReviewTeaser latest={replay} spectator={isSpectator} onReview={onReview} />}

        {isSpectator ? (
          <button className="ghost wide" onClick={onLeave}>
            Back to games
          </button>
        ) : (
          <>
            <div className="result-actions">
              <button onClick={onRematch} disabled={alreadyVoted}>
                {alreadyVoted ? `Waiting… ${votes}/${seats}` : 'Rematch'}
              </button>
              <button className="ghost" onClick={onLeave}>
                Leave room
              </button>
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>
              Everyone still here must choose. The winner of this match starts the next one.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** A seat whose rating actually moved: a registered person with a delta from the server. */
function isRated(player: PlayerPublic): player is PlayerPublic & { eloDelta: number } {
  return !player.isGuest && !player.bot && player.eloDelta !== undefined;
}

/**
 * True for a guest or bot still seated. Someone who already left is not in
 * `seats`, so who they were is unknown: a rated leaver always loses points in
 * a ranked forfeit, so a zero change means a guest, and shows no tag.
 */
function isUnrated(seats: PlayerPublic[], id: string, delta: number | undefined): boolean {
  const seat = seats.find((p) => p.id === id);
  if (!seat) return delta === 0;
  return seat.isGuest || !!seat.bot;
}

/**
 * The opponent left mid-match, so the player still seated wins. The room is
 * already back to waiting underneath; this is the only record of the result.
 */
export function ForfeitOverlay({
  notice,
  myId,
  ranked,
  seats,
  guestChange,
  replay,
  onReview,
  onStay,
  onLeave,
}: {
  notice: ForfeitNotice;
  myId: string | null;
  /** Whether the room is ranked. The notice itself does not say. */
  ranked: boolean;
  /** The room's current seats: their `elo` is already the new rating, and they say who is a guest. */
  seats: PlayerPublic[];
  /** A guest's own, unofficial change for this match, once the browser has worked it out. */
  guestChange?: UnofficialChange | null;
  /** The replay of the match that was cut short, once it has arrived. */
  replay?: LatestReplay | null;
  onReview?: () => void;
  onStay: () => void;
  onLeave: () => void;
}) {
  const iWon = notice.winnerId === myId;
  const me = seats.find((p) => p.id === myId);
  const myDelta = notice.players.find((p) => p.id === myId)?.eloDelta;

  return (
    <div className="overlay">
      <div className="card result">
        <p className="muted">{notice.leaverNickname} left the match</p>
        <h2 className={`verdict ${iWon ? 'win' : 'draw'}`}>
          {iWon ? 'Win' : `${notice.winnerNickname} wins`}
        </h2>
        <p className="muted">{iWon ? 'You win by forfeit.' : 'Won by forfeit.'}</p>
        {ranked && me?.isGuest && <GuestEloNote change={guestChange} />}
        {ranked && me && !me.isGuest && myDelta !== undefined && (
          <EloChange delta={myDelta} after={me.elo} />
        )}

        <div className="final">
          {notice.players.map((player) => (
            <div className="line" key={player.id}>
              <span>
                {player.nickname}
                {player.id === myId && <span className="tag me">you</span>}
                {player.id === notice.winnerId ? (
                  <span className="tag winner">winner</span>
                ) : (
                  <span className="tag">left</span>
                )}
              </span>
              <span>
                <strong>{player.score}</strong>
                {ranked && player.eloDelta !== undefined && !isUnrated(seats, player.id, player.eloDelta) && (
                  <EloTag delta={player.eloDelta} />
                )}
              </span>
            </div>
          ))}
        </div>

        {replay && onReview && (
          <ReviewTeaser
            latest={replay}
            // Someone who was not one of the two players only watched.
            spectator={!notice.players.some((p) => p.id === myId)}
            onReview={onReview}
          />
        )}

        <div className="result-actions">
          <button onClick={onStay}>Stay in room</button>
          <button className="ghost" onClick={onLeave}>
            Leave room
          </button>
        </div>
      </div>
    </div>
  );
}
