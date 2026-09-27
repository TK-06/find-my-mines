import { hostCanModerate, type RoomSummary } from '@fmm/shared';
import { useEffect, useRef, useState } from 'react';
import { identityChanged } from './auth/session.js';
import { authEnabled, supabase } from './auth/supabase.js';
import { signOutAfterRemoval } from './data/format.js';
import { Board } from './components/Board.js';
import { JoinRequestDialog } from './components/JoinRequestDialog.js';
import { JoinRequestToasts } from './components/JoinRequestToasts.js';
import { Leaderboard } from './components/Leaderboard.js';
import { OnlinePanel } from './components/OnlinePanel.js';
import { QueuePanel } from './components/QueuePanel.js';
import { ReasonDialog } from './components/ReasonDialog.js';
import { ResultOverlay } from './components/ResultOverlay.js';
import { NavBar, useRoute, type Route } from './router.js';
import { AuthScreen } from './screens/AuthScreen.js';
import { GameLogScreen } from './screens/GameLogScreen.js';
import { LeaderboardScreen } from './screens/LeaderboardScreen.js';
import { LobbyScreen } from './screens/LobbyScreen.js';
import { ProfileScreen } from './screens/ProfileScreen.js';
import { RemovedScreen } from './screens/RemovedScreen.js';
import { useTheme } from './theme.js';
import { useGame } from './useGame.js';

export function App() {
  const {
    connected,
    state,
    rooms,
    clientCount,
    online,
    removed,
    dismissRemoved,
    kickMember,
    requestJoin,
    cancelJoinRequest,
    answerJoinRequest,
    requestResolution,
    clearRequestResolution,
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
  /** The host's kick/ban dialog, when open. */
  const [pendingRemoval, setPendingRemoval] = useState<
    { id: string; nickname: string; ban: boolean } | null
  >(null);
  /** The ask-to-join room whose request dialog is open. */
  const [joinTarget, setJoinTarget] = useState<RoomSummary | null>(null);

  // Being seated (for instance, the host accepted) replaces the lobby, so the
  // request dialog has done its job.
  const inRoom = state !== null;
  useEffect(() => {
    if (inRoom) setJoinTarget(null);
  }, [inRoom]);

  /** Join from the game list or the online list: ask first where the room requires it. */
  const handleJoin = (roomId: string) => {
    const room = rooms.find((r) => r.id === roomId);
    if (room?.config.joinByRequest) {
      clearRequestResolution();
      setJoinTarget(room);
    } else {
      void joinRoom(roomId);
    }
  };

  // After a ban the page must stay on the ban notice, even though signing out
  // below fires the auth listener that normally reloads the page.
  const bannedRef = useRef(false);
  useEffect(() => {
    if (removed?.kind !== 'banned' || bannedRef.current) return;
    bannedRef.current = true;
    // "Log in again" means it: a banned account is signed out in this browser.
    if (signOutAfterRemoval(removed, isGuest)) void supabase?.auth.signOut();
  }, [removed, isGuest]);

  /**
   * Who this page is signed in as: undefined until known, null for a guest.
   * The socket handshake already carried this identity (it reads the token
   * itself), so only a *different* identity needs a reload.
   */
  const knownUserRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;

    void client.auth.getSession().then(({ data: { session } }) => {
      if (knownUserRef.current === undefined) knownUserRef.current = session?.user.id ?? null;
      setSignedIn(Boolean(session));
      setReady(true);
    });

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      const changed = identityChanged(knownUserRef.current, next);
      if (knownUserRef.current === undefined) knownUserRef.current = next;
      setSignedIn(Boolean(session));

      if (bannedRef.current) return;
      // Signing in, out, or as someone else needs a fresh, re-verified
      // handshake. The same user — another tab loading, or the hourly token
      // refresh, both broadcast to every tab — does not. Reloading on those
      // made two open tabs reload each other forever.
      if (changed) window.location.reload();
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

  // Kicked, banned, or the room was ended: say so before anything else.
  if (removed) {
    return (
      <Shell connected={connected} error={error} route={route} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme}>
        <RemovedScreen
          notice={removed}
          onContinue={() => {
            // A banned socket was disconnected by the server; start over cleanly.
            if (removed.kind === 'banned') window.location.reload();
            else dismissRemoved();
          }}
        />
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
        <div className="lobby-layout">
          <div className="stack">
            <QueuePanel queue={queue} onJoin={joinQueue} onLeave={leaveQueue} />
            <LobbyScreen
              rooms={rooms}
              clientCount={clientCount}
              onCreate={createRoom}
              onJoin={handleJoin}
              onSpectate={spectateRoom}
            />
          </div>
          <OnlinePanel online={online} myId={playerId} rooms={rooms} onJoin={handleJoin} />
        </div>

        {joinTarget && (
          <JoinRequestDialog
            // Keep the details live (player count, host) while the dialog is open.
            room={rooms.find((r) => r.id === joinTarget.id) ?? joinTarget}
            resolution={requestResolution}
            onRequest={() => requestJoin(joinTarget.id)}
            onWithdraw={cancelJoinRequest}
            onClose={() => {
              setJoinTarget(null);
              clearRequestResolution();
            }}
          />
        )}
      </Shell>
    );
  }

  const isSeated = state.players.some((p) => p.id === playerId);
  const isSpectator = !isSeated;
  const isHost = state.hostId === playerId;
  const myTurn = state.currentPlayerId === playerId;
  const canStart = isHost && state.status !== 'playing' && state.players.length >= 2;
  // Same rule the server enforces: host of a casual Custom room a player created.
  const canModerate = isHost && hostCanModerate(state.origin, state.config);
  const moderation = canModerate
    ? {
        onKick: (id: string, nickname: string) => setPendingRemoval({ id, nickname, ban: false }),
        onBan: (id: string, nickname: string) => setPendingRemoval({ id, nickname, ban: true }),
      }
    : undefined;

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

        <Leaderboard state={state} myId={playerId} moderation={moderation} />

        {state.status !== 'waiting' && (
          <Board state={state} myTurn={myTurn && !isSpectator} onReveal={reveal} />
        )}
      </div>

      {isHost && <JoinRequestToasts requests={state.joinRequests} onAnswer={answerJoinRequest} />}

      {pendingRemoval && (
        <ReasonDialog
          title={`${pendingRemoval.ban ? 'Ban' : 'Kick'} ${pendingRemoval.nickname}?`}
          consequence={
            pendingRemoval.ban
              ? 'They leave the room and cannot come back while it is open.'
              : 'They go back to the menu and can rejoin.'
          }
          confirmLabel={pendingRemoval.ban ? 'Ban from room' : 'Kick'}
          onConfirm={(note) => kickMember(pendingRemoval.id, pendingRemoval.ban, note)}
          onClose={() => setPendingRemoval(null)}
        />
      )}

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
