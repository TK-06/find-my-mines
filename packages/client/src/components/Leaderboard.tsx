import { TURN_SECONDS, nextInTurn, type PublicMatchState } from '@fmm/shared';
import { isBotSeat } from '../data/aiPlay.js';
import { Avatar } from './Avatar.js';

/** Kick and ban buttons, present only when this viewer is allowed to moderate. */
export interface ModerationControls {
  onKick: (id: string, nickname: string) => void;
  onBan: (id: string, nickname: string) => void;
}

interface Props {
  state: PublicMatchState;
  myId: string | null;
  moderation?: ModerationControls;
}

function MemberActions({
  id,
  nickname,
  moderation,
}: {
  id: string;
  nickname: string;
  moderation: ModerationControls;
}) {
  return (
    <span className="row-actions">
      <button className="ghost small" onClick={() => moderation.onKick(id, nickname)}>
        Kick
      </button>
      <button className="danger small" onClick={() => moderation.onBan(id, nickname)}>
        Ban
      </button>
    </span>
  );
}

/**
 * Live in-match ranking.
 *
 * Spec: "The player's name and score are displayed on the game client." This
 * covers that for two players and stays readable for a free-for-all room.
 * Ties keep the same rank, so three players on 2 points all read "1", and
 * keep turn order between them (the sort is stable).
 */
export function Leaderboard({ state, myId, moderation }: Props) {
  const ranked = [...state.players].sort((a, b) => b.score - a.score);

  // `players` arrives in turn order, and the server passes the turn with this
  // same rule. A seat held for a reconnect still gets turns, so it can be next.
  const nextId =
    state.status === 'playing'
      ? nextInTurn(
          state.players.map((p) => p.id),
          state.currentPlayerId,
        )
      : null;

  let lastScore: number | null = null;
  let lastRank = 0;

  const urgent = state.status === 'playing' && state.secondsLeft <= 3;

  return (
    <div className="stack">
      {/* Only meaningful while a turn is running; hidden in the waiting room. */}
      {state.status === 'playing' && (
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
      )}

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
            // The computer is not rated, so its row has no Elo to show.
            const isBot = isBotSeat(player);

            return (
              <li
                key={player.id}
                className={`leader-row ${onTurn ? 'on-turn' : ''} ${isMe ? 'is-me' : ''} ${moderation ? 'moderated' : ''}`}
              >
                <span className="rank">{rank}</span>
                <span className="who">
                  <Avatar name={player.nickname} url={player.avatarUrl} bot={player.bot?.model ?? false} size={24} />
                  {player.nickname}
                  {isBot && <span className="tag bot">bot</span>}
                  {isMe && <span className="tag me">you</span>}
                  {isHost && <span className="tag host">host</span>}
                  {!player.connected && <span className="tag away">reconnecting</span>}
                  {onTurn && state.status === 'playing' && (
                    <span className="tag turn">on turn</span>
                  )}
                  {player.id === nextId && <span className="tag next">next</span>}
                  {state.status === 'ended' && readyForRematch && (
                    <span className="tag ready">ready</span>
                  )}
                </span>
                <span className="points">
                  {/* This match only. totalScore (earlier matches) is not shown. */}
                  <strong>{player.score}</strong>
                  <span className="muted"> {player.score === 1 ? 'mine' : 'mines'}</span>
                  {!isBot && <span className="muted"> · {player.elo}</span>}
                  {/* Only set after a ranked match, and only for real accounts. */}
                  {player.eloDelta !== undefined && player.eloDelta !== 0 && (
                    <span className={`elo-delta ${player.eloDelta > 0 ? 'up' : 'down'}`}>
                      {player.eloDelta > 0 ? `+${player.eloDelta}` : player.eloDelta}
                    </span>
                  )}
                </span>
                {moderation &&
                  // Nothing to kick: the computer comes and goes with the room.
                  (isMe || isBot ? (
                    <span />
                  ) : (
                    <MemberActions id={player.id} nickname={player.nickname} moderation={moderation} />
                  ))}
              </li>
            );
          })}
        </ul>

        {state.spectators.length > 0 && (
          <div className="spectator-block">
            <div className="field-label">Watching</div>
            <ul className="list spectator-list">
              {state.spectators.map((spectator) => (
                <li key={spectator.id}>
                  <span>
                    {spectator.nickname}
                    {spectator.id === myId && <span className="tag me" style={{ marginLeft: 8 }}>you</span>}
                  </span>
                  {moderation && spectator.id !== myId && (
                    <MemberActions
                      id={spectator.id}
                      nickname={spectator.nickname}
                      moderation={moderation}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The phone's scoreboard: one line under the turn banner with every seat's
 * mines found, whoever is on turn edged in orange, and how many of the board's
 * mines are found so far. The full leaderboard (and its kick and ban buttons)
 * is still there below the board; this is what you can see while playing.
 */
export function ScoreStrip({ state, myId }: { state: PublicMatchState; myId: string | null }) {
  return (
    <div className="score-strip" aria-label="Score">
      <ul className="score-strip-seats">
        {state.players.map((player) => {
          const onTurn = state.status === 'playing' && state.currentPlayerId === player.id;
          const isMe = player.id === myId;
          return (
            <li key={player.id} className={`score-seat${onTurn ? ' on-turn' : ''}`}>
              <Avatar name={player.nickname} url={player.avatarUrl} bot={player.bot?.model ?? false} size={22} />
              <span className="score-seat-name">
                {isMe ? 'You' : player.nickname}
                {onTurn && <span className="chat-sr"> (on turn)</span>}
              </span>
              <strong className="score-seat-points">{player.score}</strong>
            </li>
          );
        })}
      </ul>
      <span className="score-strip-found" title="Mines found">
        {state.bombsFound}/{state.bombCount}
      </span>
    </div>
  );
}
