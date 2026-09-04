import { CLASSIC_PRESET } from '@fmm/shared';
import { useState } from 'react';
import { Board } from './components/Board.js';
import { Leaderboard } from './components/Leaderboard.js';
import { ResultOverlay } from './components/ResultOverlay.js';
import { LobbyScreen } from './screens/LobbyScreen.js';
import { useGame } from './useGame.js';

export function App() {
  const {
    connected,
    state,
    rooms,
    clientCount,
    playerId,
    welcome,
    error,
    join,
    createRoom,
    joinRoom,
    spectateRoom,
    leaveRoom,
    startMatch,
    reveal,
    rematch,
  } = useGame();

  const [nickname, setNickname] = useState('');

  const named = playerId !== null;

  // Screen is derived, not stored: no room state means the lobby.
  if (!named) {
    return (
      <Shell connected={connected} error={error}>
        <div className="center-screen">
          <form
            className="card join-card"
            onSubmit={(e) => {
              e.preventDefault();
              if (nickname.trim()) join(nickname.trim());
            }}
          >
            <h2>Enter your nickname</h2>
            <p>
              Find hidden mines before your opponents. Default game is{' '}
              {CLASSIC_PRESET.rows}×{CLASSIC_PRESET.cols} with {CLASSIC_PRESET.mineCount} mines.
            </p>
            <input
              type="text"
              value={nickname}
              maxLength={20}
              autoFocus
              placeholder="e.g. Alice"
              onChange={(e) => setNickname(e.target.value)}
            />
            <button className="wide" type="submit" disabled={!nickname.trim() || !connected}>
              {connected ? 'Continue' : 'Connecting…'}
            </button>
          </form>
        </div>
      </Shell>
    );
  }

  if (!state) {
    return (
      <Shell connected={connected} error={error} welcome={welcome}>
        <LobbyScreen
          rooms={rooms}
          clientCount={clientCount}
          onCreate={createRoom}
          onJoin={joinRoom}
          onSpectate={spectateRoom}
        />
      </Shell>
    );
  }

  const isSeated = state.players.some((p) => p.id === playerId);
  const isSpectator = !isSeated;
  const isHost = state.hostId === playerId;
  const myTurn = state.currentPlayerId === playerId;
  const canStart = isHost && state.status !== 'playing' && state.players.length >= 2;

  return (
    <Shell connected={connected} error={error}>
      <div className="stack">
        <div className="room-bar card">
          <div>
            <span className="room-code">{state.roomId}</span>
            <strong style={{ marginLeft: 8 }}>{state.roomName}</strong>
            <div className="muted room-meta">
              {state.rows}×{state.cols} · {state.bombCount} mines ·{' '}
              {state.players.length}/{state.config.maxPlayers ?? '∞'} players
              {isSpectator && ' · you are spectating'}
            </div>
          </div>
          <button className="ghost" onClick={leaveRoom}>
            Leave room
          </button>
        </div>

        {state.status === 'waiting' && (
          <div className="banner wait">
            {state.players.length < 2
              ? 'Waiting for another player to join…'
              : isHost
                ? 'Ready when you are.'
                : `Waiting for ${state.players.find((p) => p.id === state.hostId)?.nickname ?? 'the host'} to start…`}
            {canStart && (
              <button style={{ marginLeft: 14 }} onClick={startMatch}>
                Start match
              </button>
            )}
          </div>
        )}

        {state.status === 'playing' && !isSpectator && (
          <div className={`banner ${myTurn ? 'you-turn' : 'wait'}`}>
            {myTurn ? 'Your turn — find a mine!' : 'Waiting for the other player…'}
          </div>
        )}

        <Leaderboard state={state} myId={playerId} />

        {state.status !== 'waiting' && (
          <Board state={state} myTurn={myTurn && !isSpectator} onReveal={reveal} />
        )}
      </div>

      {state.status === 'ended' && (
        <ResultOverlay
          state={state}
          myId={playerId}
          isSpectator={isSpectator}
          onRematch={rematch}
          onLeave={leaveRoom}
        />
      )}
    </Shell>
  );
}

function Shell({
  connected,
  error,
  welcome,
  children,
}: {
  connected: boolean;
  error: string | null;
  welcome?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="app">
      <header className="header">
        <div>
          <h1 className="title">Find My Mines</h1>
          <p className="subtitle">Net-Centric · client–server over Socket.IO</p>
        </div>
        <span className={`conn ${connected ? 'online' : 'offline'}`}>
          {connected ? '● connected' : '● disconnected'}
        </span>
      </header>

      {/* Spec: "a welcome message with their nickname will appear" */}
      {welcome && <div className="banner">{welcome}</div>}

      {children}

      {error && <div className="toast">{error}</div>}
    </div>
  );
}
