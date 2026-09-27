import type { ForfeitNotice, PublicMatchState } from '@fmm/shared';

interface Props {
  state: PublicMatchState;
  myId: string | null;
  isSpectator: boolean;
  onRematch: () => void;
  onLeave: () => void;
}

/**
 * Spec: "When the match ends, the game clients display the player's status as
 * 'Win' or 'Lost' along with the current scores of both players and a Rematch
 * button."
 *
 * Each player independently picks Rematch or Leave. Leaving shrinks the vote
 * pool, so one person walking away never deadlocks the others.
 */
export function ResultOverlay({ state, myId, isSpectator, onRematch, onLeave }: Props) {
  const iWon = state.winnerId !== null && state.winnerId === myId;
  const draw = state.winnerId === null;
  const alreadyVoted = myId !== null && state.rematchVotes.includes(myId);
  const votes = state.rematchVotes.length;
  const seats = state.players.length;

  const winner = state.players.find((p) => p.id === state.winnerId);
  const ranked = [...state.players].sort((a, b) => b.score - a.score);

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
              <strong>{player.score}</strong>
            </div>
          ))}
        </div>

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

/**
 * The opponent left mid-match, so the player still seated wins. The room is
 * already back to waiting underneath; this is the only record of the result.
 */
export function ForfeitOverlay({
  notice,
  myId,
  onStay,
  onLeave,
}: {
  notice: ForfeitNotice;
  myId: string | null;
  onStay: () => void;
  onLeave: () => void;
}) {
  const iWon = notice.winnerId === myId;

  return (
    <div className="overlay">
      <div className="card result">
        <p className="muted">{notice.leaverNickname} left the match</p>
        <h2 className={`verdict ${iWon ? 'win' : 'draw'}`}>
          {iWon ? 'Win' : `${notice.winnerNickname} wins`}
        </h2>
        <p className="muted">{iWon ? 'You win by forfeit.' : 'Won by forfeit.'}</p>

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
              <strong>{player.score}</strong>
            </div>
          ))}
        </div>

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
