import { useEffect, useState } from 'react';
import { authEnabled, currentAccessToken, supabase } from './auth/supabase.js';
import { Board } from './components/Board.js';
import { Leaderboard } from './components/Leaderboard.js';
import { QueuePanel } from './components/QueuePanel.js';
import { ResultOverlay } from './components/ResultOverlay.js';
import { NavBar, useRoute, type Route } from './router.js';
import { AuthScreen } from './screens/AuthScreen.js';
import { GameLogScreen } from './screens/GameLogScreen.js';
import { LeaderboardScreen } from './screens/LeaderboardScreen.js';
import { LobbyScreen } from './screens/LobbyScreen.js';
import { ProfileScreen } from './screens/ProfileScreen.js';
import { setAccessToken } from './socket.js';
import { useTheme } from './theme.js';
import { useGame } from './useGame.js';

export function App() {
  const {
    connected,
    state,
    rooms,
    clientCount,
    playerId,
    welcome,
    isGuest,
    elo,
    queue,
    error,
    join,
    createRoom,
    joinRoom,
    spectateRoom,
    leaveRoom,
    joinQueue,
    leaveQueue,
    startMatch,
    reveal,
    rematch,
  } = useGame();

  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(!authEnabled);
  const [route, navigate] = useRoute();
  const [theme, toggleTheme] = useTheme();

  // Pick up an existing session and keep the handshake token current. The
  // socket reads socket.auth at connect time, so the token must be set before
  // useGame connects.
  useEffect(() => {
    if (!supabase) {
      setAccessToken(undefined);
      return;
    }

    void currentAccessToken().then((token) => {
      setAccessToken(token);
      setSignedIn(Boolean(token));
      setReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token);
      setSignedIn(Boolean(session));
      // A changed identity needs a fresh handshake to be re-verified.
      if (socketNeedsReconnect()) window.location.reload();
    });

    return () => data.subscription.unsubscribe();
  }, []);

  const named = playerId !== null;

  // Screen is derived, not stored: no room state means the lobby.
  // A signed-in user does not need to type anything; join with their profile.
  useEffect(() => {
    if (ready && signedIn && !named && connected) join('');
  }, [ready, signedIn, named, connected, join]);

  // Profile, rankings and the game log read public data, so they work before a
  // nickname is chosen. Only the game itself needs an identity.
  if (route === 'profile') {
    return (
      <Shell connected={connected} error={error} route={route} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme}>
        <ProfileScreen />
      </Shell>
    );
  }

  if (route === 'ranks') {
    return (
      <Shell connected={connected} error={error} route={route} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme}>
        <LeaderboardScreen />
      </Shell>
    );
  }

  if (route === 'games') {
    return (
      <Shell connected={connected} error={error} route={route} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme}>
        <GameLogScreen />
      </Shell>
    );
  }

  if (!named) {
    return (
      <Shell connected={connected} error={error} route={route} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme}>
        {ready ? (
          <AuthScreen connected={connected} onGuest={join} />
        ) : (
          <div className="center-screen">
            <p className="muted">Checking your session…</p>
          </div>
        )}
      </Shell>
    );
  }

  if (!state) {
    return (
      <Shell connected={connected} error={error} welcome={welcome} route={route} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme}>
        <div className="stack">
        <QueuePanel queue={queue} onJoin={joinQueue} onLeave={leaveQueue} />
        <LobbyScreen
          rooms={rooms}
          clientCount={clientCount}
          onCreate={createRoom}
          onJoin={joinRoom}
          onSpectate={spectateRoom}
        />
        </div>
      </Shell>
    );
  }

  const isSeated = state.players.some((p) => p.id === playerId);
  const isSpectator = !isSeated;
  const isHost = state.hostId === playerId;
  const myTurn = state.currentPlayerId === playerId;
  const canStart = isHost && state.status !== 'playing' && state.players.length >= 2;

  return (
    <Shell connected={connected} error={error} route={route} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme}>
      <div className="stack">
        <IdentityBar isGuest={isGuest} elo={elo} />
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

/** True once a socket already exists, so an identity change needs a clean handshake. */
function socketNeedsReconnect(): boolean {
  return document.readyState === 'complete';
}

function IdentityBar({ isGuest, elo }: { isGuest: boolean; elo: number }) {
  const client = supabase;
  return (
    <div className="identity-bar">
      <span className={`tag ${isGuest ? 'spectator' : 'player'}`}>
        {isGuest ? 'guest' : 'signed in'}
      </span>
      <span className="muted">
        {elo} Elo{isGuest && ' · not saved between visits'}
      </span>
      {!isGuest && client && (
        <button
          className="ghost small"
          onClick={() => void client.auth.signOut().then(() => window.location.reload())}
        >
          Sign out
        </button>
      )}
    </div>
  );
}

function Shell({
  connected,
  error,
  welcome,
  route,
  onNavigate,
  theme,
  onToggleTheme,
  children,
}: {
  connected: boolean;
  error: string | null;
  welcome?: string | null;
  route: Route;
  onNavigate: (next: Route) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="app">
      <header className="header">
        <div>
          <h1 className="title">Find My Mines</h1>
          <p className="subtitle">Net-Centric · client–server over Socket.IO</p>
        </div>
        <div className="header-right">
          <NavBar route={route} onNavigate={onNavigate} />
          <button
            className="theme-toggle"
            onClick={onToggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '☀ Light' : '☾ Dark'}
          </button>
          <span className={`conn ${connected ? 'online' : 'offline'}`}>
            {connected ? '● connected' : '● disconnected'}
          </span>
        </div>
      </header>

      {/* Spec: "a welcome message with their nickname will appear" */}
      {welcome && <div className="banner">{welcome}</div>}

      {children}

      {error && <div className="toast">{error}</div>}
    </div>
  );
}
