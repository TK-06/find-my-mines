import { TURN_SECONDS, type PublicMatchState } from '@fmm/shared';

interface Props {
  state: PublicMatchState;
  myId: string | null;
}

/**
 * Live in-match ranking.
 *
 * Spec: "The player's name and score are displayed on the game client." This
 * covers that for two players and stays readable for a free-for-all room.
 * Ties keep the same rank, so three players on 2 points all read "1".
 */
export function Leaderboard({ state, myId }: Props) {
  const ranked = [...state.players].sort(
    (a, b) => b.score - a.score || b.totalScore - a.totalScore,
  );

  let lastScore: number | null = null;
  let lastRank = 0;

  const urgent = state.status === 'playing' && state.secondsLeft <= 3;

  return (
    <div className="stack">
      <div className={`timer wide-timer ${urgent ? 'urgent' : ''}`}>
        <div className="label">
          {state.status === 'playing' ? 'TIME LEFT THIS TURN' : 'TURN TIMER'}
        </div>
        <div className="value">{state.status === 'playing' ? state.secondsLeft : '–'}</div>
        <div className="bar">
          <i
            style={{
              width: `${
                state.status === 'playing' ? (state.secondsLeft / TURN_SECONDS) * 100 : 0
              }%`,
            }}
          />
        </div>
      </div>

      <div className="card">
        <div className="lobby-head" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Leaderboard</h3>
          <span className="muted">
            {state.bombsFound}/{state.bombCount} mines found
            {state.spectatorCount > 0 && ` · ${state.spectatorCount} watching`}
          </span>
        </div>

        <ul className="list leaderboard">
          {ranked.map((player, index) => {
            const rank = player.score === lastScore ? lastRank : index + 1;
            lastScore = player.score;
            lastRank = rank;

            const onTurn = state.currentPlayerId === player.id;
            const isMe = player.id === myId;
            const isHost = state.hostId === player.id;
            const readyForRematch = state.rematchVotes.includes(player.id);

            return (
              <li
                key={player.id}
                className={`leader-row ${onTurn ? 'on-turn' : ''} ${isMe ? 'is-me' : ''}`}
              >
                <span className="rank">{rank}</span>
                <span className="who">
                  {player.nickname}
                  {isMe && <span className="tag me">you</span>}
                  {isHost && <span className="tag host">host</span>}
                  {onTurn && state.status === 'playing' && (
                    <span className="tag turn">on turn</span>
                  )}
                  {state.status === 'ended' && readyForRematch && (
                    <span className="tag ready">ready</span>
                  )}
                </span>
                <span className="points">
                  <strong>{player.score}</strong>
                  <span className="muted"> / {player.totalScore}</span>
                  <span className="muted"> · {player.elo}</span>
                  {/* Only set after a ranked match, and only for real accounts. */}
                  {player.eloDelta !== undefined && player.eloDelta !== 0 && (
                    <span className={`elo-delta ${player.eloDelta > 0 ? 'up' : 'down'}`}>
                      {player.eloDelta > 0 ? `+${player.eloDelta}` : player.eloDelta}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
