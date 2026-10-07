import { hostCanModerate, isRoomFull, type RoomConfig, type RoomSummary } from '@fmm/shared';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { identityChanged } from './auth/session.js';
import { authEnabled, supabase } from './auth/supabase.js';
import { signOutAfterRemoval } from './data/format.js';
import type { GuestProfile } from './data/guestCookie.js';
import { AiPanel, HintButton, HintLine, useAiHint } from './components/AiPanel.js';
import { Board } from './components/Board.js';
import { FriendInviteToasts } from './components/FriendInviteToasts.js';
import { JoinRequestDialog } from './components/JoinRequestDialog.js';
import { JoinRequestToasts } from './components/JoinRequestToasts.js';
import { Leaderboard } from './components/Leaderboard.js';
import { LoadBoundary } from './components/LoadBoundary.js';
import { OnlinePanel } from './components/OnlinePanel.js';
import { ProfileButton, type HeaderUser } from './components/ProfileButton.js';
import { QueuePanel } from './components/QueuePanel.js';
import { ReasonDialog } from './components/ReasonDialog.js';
import { ForfeitOverlay, ResultOverlay } from './components/ResultOverlay.js';
import { RoomChat } from './components/RoomChat.js';
import { ShareRoom } from './components/ShareRoom.js';
import { SiteFooter } from './components/SiteFooter.js';
import { SoundControl } from './components/SoundControl.js';
import { PostInviteButton, WorldChat } from './components/WorldChat.js';
import {
  invitePlan,
  pendingInviteNotice,
  type InviteOutcome,
} from './data/friendsModel.js';
import { replayForPopup } from './data/latestReplay.js';
import { isPolicy } from './data/policies.js';
import { useFriendships } from './data/useFriendships.js';
import {
  NavBar,
  joinCodeFromPath,
  pathFor,
  pathForPlayer,
  pathForReview,
  playerNameFromPath,
  reviewTargetFromPath,
  useRoute,
  type Route,
} from './router.js';
import { AuthScreen } from './screens/AuthScreen.js';
import { LeaderboardScreen } from './screens/LeaderboardScreen.js';
import { LobbyScreen } from './screens/LobbyScreen.js';
import { PlayerProfileScreen } from './screens/PlayerProfileScreen.js';
import { PolicyScreen } from './screens/PolicyScreen.js';
import { ProfileScreen } from './screens/ProfileScreen.js';
import { RemovedScreen } from './screens/RemovedScreen.js';
import { useSoundSettings } from './sound/settings.js';
import { useGameSounds } from './sound/useGameSounds.js';
import { useTheme } from './theme.js';
import { forgetStoredGuest, storedGuestName, useGame } from './useGame.js';

// Puzzle mode loads on first visit: most players never open it, and its board
// and solver-backed hint need not weigh on the main game's first load.
const PuzzleScreen = lazy(() => import('./screens/PuzzleScreen.js').then((m) => ({ default: m.PuzzleScreen })));

// The review screen is the same: opened from a result popup or a match in the
// log, never on the way to a first game, so it loads as its own chunk.
const ReviewScreen = lazy(() => import('./screens/ReviewScreen.js').then((m) => ({ default: m.ReviewScreen })));

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
    forfeit,
    error,
    join,
    forgetGuest,
    forgetGuestData,
    guestProfile,
    guestChange,
    createRoom,
    joinRoom,
    spectateRoom,
    lookupRoom,
    leaveRoom,
    joinQueue,
    leaveQueue,
    startMatch,
    reveal,
    rematch,
    dismissForfeit,
    friendInvites,
    inviteFriend,
    dismissInvite,
    declineInvite,
    notify,
    reportPlayer,
    playVsAi,
    aiAbout,
    askHint,
    onHintWhy,
    roomMessages,
    sayInRoom,
    lobbyMessages,
    sayInLobby,
    postInvite,
    latestReplay,
    matchCount,
    coachStatus,
    askCoach,
  } = useGame();

  // Up here with the other hooks, before any early return. Inert outside a
  // game against the computer.
  const hint = useAiHint(state, playerId, askHint, onHintWhy);

  // The game's sounds and the buzz on your turn. They follow the room whatever
  // page is open, so a turn is heard from the profile page too. The admin
  // console never mounts App, so it stays silent.
  useGameSounds(state, playerId, forfeit, useSoundSettings());

  const [signedIn, setSignedIn] = useState(false);
  /**
   * The signed-in account's id, read from the session as soon as it is known —
   * before this tab has joined the server — so the friends list can start loading.
   */
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(!authEnabled);
  const [route, navigate, path] = useRoute();
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

  // A dropped connection loses any pending request on the server, so the
  // dialog would wait forever. Close it; the player can ask again.
  useEffect(() => {
    if (!connected) setJoinTarget(null);
  }, [connected]);

  /**
   * Join from the game list, the online list, an invite, a share link or a
   * typed code: ask first where the room requires it. A private room is not
   * in the game list, so the server is asked about it by its code first.
   */
  const handleJoin = (roomId: string) => {
    const joinOrAsk = (room: RoomSummary) => {
      if (room.config.joinByRequest) {
        clearRequestResolution();
        setJoinTarget(room);
      } else {
        void joinRoom(room.id);
      }
    };
    const listed = rooms.find((r) => r.id === roomId);
    if (listed) joinOrAsk(listed);
    // Not found says so in a toast, the way joining a closed room always has.
    else void lookupRoom(roomId).then((found) => found && joinOrAsk(found));
  };

  // After a ban the page must stay on the ban notice, even though signing out
  // below fires the auth listener that normally reloads the page.
  const bannedRef = useRef(false);
  useEffect(() => {
    if (removed?.kind !== 'banned' || bannedRef.current) return;
    bannedRef.current = true;
    // "Log in again" means it: a banned account is signed out in this browser,
    // and a banned guest's remembered name is forgotten, so neither is let
    // straight back in by a reload.
    if (signOutAfterRemoval(removed, isGuest)) void supabase?.auth.signOut();
    if (isGuest) forgetStoredGuest();
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
      setAccountId(session?.user.id ?? null);
      setReady(true);
    });

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      const changed = identityChanged(knownUserRef.current, next);
      if (knownUserRef.current === undefined) knownUserRef.current = next;
      setSignedIn(Boolean(session));
      setAccountId(next);

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

  /** The Play page, without piling up history entries when it is already showing. */
  const showPlay = () => {
    if (route !== 'game') navigate('game');
  };

  /**
   * The signed-in player's friendships, here rather than in the Friends card so
   * the profile page, the lobby's search and its player cards, and whatever
   * needs the list inside a room all share one — and one change shows in all.
   * A friend's Join, Watch and Invite buttons act through the handlers below.
   */
  const friends = useFriendships(accountId, {
    onJoin: (roomId) => {
      showPlay();
      handleJoin(roomId);
    },
    onWatch: (roomId) => {
      showPlay();
      void spectateRoom(roomId);
    },
    onInvite: inviteFriend,
  });

  /**
   * A friend to invite as soon as the game being set up exists. Pressing Invite
   * on a card while not in a room sends you to Create game first (see
   * `inviteFromCard`); this is who waits for it. Dropped by Cancel on the form,
   * by leaving the Play page, and the moment it has been used.
   */
  const [pendingInvite, setPendingInvite] = useState<{ profileId: string; name: string } | null>(null);
  useEffect(() => {
    // Only the lobby has a Create game form to wait for.
    if (route !== 'game' || state !== null) setPendingInvite(null);
  }, [route, state]);

  const plan = invitePlan({
    connected,
    named,
    inRoom: state !== null,
    vsComputer: state?.origin === 'ai',
  });

  /**
   * Invite from a friend's card (profile page or lobby). In a room, the invite
   * goes out now. In the menu there is no room to invite to yet, so Play opens
   * with the Create game form and the invite follows once the game exists.
   */
  const inviteFromCard = async (friend: { profileId: string; name: string }): Promise<InviteOutcome> => {
    switch (plan) {
      case 'send':
        return inviteFriend(friend.profileId);
      case 'create':
        setPendingInvite(friend);
        showPlay();
        return { ok: true, queued: true };
      case 'leave-computer':
        return { ok: false, error: 'Leave your game against the computer first.' };
      case 'disconnected':
        return { ok: false, error: 'Not connected to the server right now.' };
    }
  };
  const cardInvite = { plan, send: inviteFromCard };

  /**
   * Create game from the lobby's form. With a friend waiting, the invite is sent
   * as soon as the room exists: the server has seated us by the time it answers,
   * which is what it wants to see before it relays an invite. How it went shows
   * in the toast. A refused create says why through its own toast, and the
   * invite is not sent.
   */
  const createGame = async (name: string, config: RoomConfig) => {
    // Taken now: the form closes at once, and the invite must not outlive this attempt.
    const friend = pendingInvite;
    setPendingInvite(null);
    const result = await createRoom(name, config);
    if (!result.ok || !friend) return;
    notify(pendingInviteNotice(friend.name, await inviteFriend(friend.profileId)));
  };

  /**
   * Whose picture the header shows. The online list carries every account's
   * picture, and this tab is in it once it has joined; before that — no name yet,
   * or the first list still on its way — there is nobody to show, and the header
   * draws a generic person.
   */
  const mine = online.find((p) => p.id === playerId);
  const me: HeaderUser | null = mine ? { name: mine.nickname, avatarUrl: mine.avatarUrl ?? null } : null;

  /**
   * A share link (/join/CODE), read once at load. It joins that room as soon
   * as the player has a name — a guest once they pick one, an account once
   * signed in — and only from the game screen, so wandering to the profile
   * first does not pull them into a room from there.
   */
  const [linkCode, setLinkCode] = useState(() => joinCodeFromPath(window.location.pathname));
  useEffect(() => {
    if (!linkCode || route !== 'game' || !named || !connected) return;
    setLinkCode(null);
    // Back to /, so a refresh does not join again.
    if (joinCodeFromPath(window.location.pathname)) {
      window.history.replaceState(null, '', pathFor('game'));
    }
    // Already there (this tab's held seat came back): joining again would
    // give that seat up.
    if (state?.roomId !== linkCode) handleJoin(linkCode);
  }, [linkCode, route, named, connected, state?.roomId, handleJoin]);

  // Screen is derived, not stored: no room state means the lobby.
  // A signed-in user does not need to type anything; join with their profile.
  useEffect(() => {
    if (ready && signedIn && !named && connected) join('');
  }, [ready, signedIn, named, connected, join]);

  // A guest who already picked a name is let straight back in after a refresh.
  const guestName = storedGuestName();
  useEffect(() => {
    if (ready && !signedIn && !named && connected && guestName) join(guestName);
  }, [ready, signedIn, named, connected, guestName, join]);

  // A friend's invite pops up on every page — except inside a room, where
  // joining another would give up your seat (a forfeit, mid-match). Invites
  // that arrive meanwhile wait, and show once you are back out.
  const inviteToasts =
    state === null ? (
      <FriendInviteToasts
        invites={friendInvites}
        onAccept={(invite) => {
          dismissInvite(invite.id);
          navigate('game');
          handleJoin(invite.roomId);
        }}
        // Closes the popup and tells the friend, whose tabs show "<you> declined your invite."
        onDecline={(invite) => declineInvite(invite.id)}
      />
    ) : null;

  // Profile and rankings read public data, so they work before a nickname is
  // chosen. Only the game itself needs an identity.
  if (route === 'profile') {
    return (
      <Shell connected={connected} error={error} route={route} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme} me={me}>
        <ProfileScreen
          online={online}
          rooms={rooms}
          myRoomId={state?.roomId ?? null}
          friends={friends}
          invite={cardInvite}
          onReport={reportPlayer}
          onViewProfile={(name) => navigate('player', pathForPlayer(name))}
          onOpenReview={(matchId) => navigate('review', pathForReview(matchId))}
          guest={guestProfile}
          onForgetGuest={forgetGuestData}
        />
        {inviteToasts}
      </Shell>
    );
  }

  // Someone else's profile: public data, readable with no nickname or sign-in.
  const playerName = route === 'player' ? playerNameFromPath(path) : null;
  if (route === 'player' && playerName) {
    // Your own public page says "This is you" and points to your profile, so the
    // header's picture marks it as the current page too. Guests have no public
    // page: a guest who shares a name with an account is not that account.
    const viewingOwn = me !== null && !isGuest && playerName.toLowerCase() === me.name.toLowerCase();
    return (
      <Shell connected={connected} error={error} route={route} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme} me={me} ownProfile={viewingOwn}>
        <PlayerProfileScreen
          key={playerName}
          username={playerName}
          onOpenReview={(matchId) => navigate('review', pathForReview(matchId))}
          onOpenOwnProfile={() => navigate('profile')}
        />
        {inviteToasts}
      </Shell>
    );
  }

  // A game's review, at /review/latest (the game this tab just finished, from
  // memory) or /review/<match id>. It is only another page: the player's seat
  // and room stay as they were, the rematch vote carries on, and the result
  // popup is back when they return to the game.
  const reviewTarget = route === 'review' ? reviewTargetFromPath(path) : null;
  if (route === 'review' && reviewTarget) {
    return (
      <Shell connected={connected} error={error} route={route} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme} me={me}>
        <LoadBoundary what="the review">
          <Suspense
            fallback={
              <div className="card empty-state" role="status">
                <p className="muted">Loading the review…</p>
              </div>
            }
          >
            <ReviewScreen
              target={reviewTarget}
              latest={latestReplay}
              connected={connected}
              coachApi={{ status: coachStatus, ask: askCoach }}
              onNavigate={navigate}
            />
          </Suspense>
        </LoadBoundary>
        {inviteToasts}
      </Shell>
    );
  }

  // Puzzle mode is single-player and runs entirely in this browser: no name,
  // sign-in or server round trip needed.
  if (route === 'puzzle') {
    return (
      <Shell connected={connected} error={error} route={route} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme} me={me}>
        <LoadBoundary what="the puzzle">
          <Suspense
            fallback={
              <div className="card empty-state" role="status">
                <p className="muted">Loading the puzzle…</p>
              </div>
            }
          >
            <PuzzleScreen />
          </Suspense>
        </LoadBoundary>
        {inviteToasts}
      </Shell>
    );
  }

  if (route === 'ranks') {
    return (
      <Shell connected={connected} error={error} route={route} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme} me={me}>
        <LeaderboardScreen />
        {inviteToasts}
      </Shell>
    );
  }

  // Privacy, security and terms are static text: readable with no nickname,
  // no sign-in and no database.
  if (isPolicy(route)) {
    return (
      <Shell connected={connected} error={error} route={route} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme} me={me}>
        <PolicyScreen policy={route} onNavigate={navigate} />
        {inviteToasts}
      </Shell>
    );
  }

  // Kicked, banned, or the room was ended: say so before anything else.
  if (removed) {
    return (
      <Shell connected={connected} error={error} route={route} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme} me={me}>
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
      <Shell connected={connected} error={error} route={route} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme} me={me}>
        {ready && !(guestName && !signedIn) ? (
          <>
            {linkCode && (
              <p className="join-link-note">
                Pick a name or sign in, and you’ll go straight to room{' '}
                <span className="room-code">{linkCode}</span>.
              </p>
            )}
            <AuthScreen connected={connected} onGuest={join} remembered={guestProfile} onForget={forgetGuestData} />
          </>
        ) : (
          <div className="center-screen">
            <p className="muted">{connected ? 'Signing you back in…' : 'Connecting to the server…'}</p>
          </div>
        )}
      </Shell>
    );
  }

  if (!state) {
    return (
      <Shell connected={connected} error={error} welcome={welcome} route={route} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme} me={me}>
        <div className="stack">
          <IdentityBar isGuest={isGuest} elo={elo} guest={guestProfile} onForgetGuest={forgetGuest} />
          <div className="lobby-layout">
            {/* Games (with + Create game) first: players could not find it
                under the quick match and the computer opponents. */}
            <div className="stack">
              <LobbyScreen
                rooms={rooms}
                clientCount={clientCount}
                onCreate={createGame}
                onJoin={handleJoin}
                onSpectate={spectateRoom}
                inviteFor={pendingInvite?.name ?? null}
                onCancelInvite={() => setPendingInvite(null)}
              />
              <QueuePanel queue={queue} onJoin={joinQueue} onLeave={leaveQueue} />
              <AiPanel connected={connected} onPlay={playVsAi} onAbout={aiAbout} />
            </div>
            {/* Who is online, then what they are saying. On phones the two split
                up: the online list first, the chat after the games. */}
            <div className="stack lobby-side">
              <OnlinePanel
                online={online}
                myId={playerId}
                rooms={rooms}
                onJoin={handleJoin}
                friends={friends}
                invite={cardInvite}
                onViewProfile={(name) => navigate('player', pathForPlayer(name))}
                onOpenOwnProfile={() => navigate('profile')}
                onReport={reportPlayer}
              />
              <WorldChat
                messages={lobbyMessages}
                rooms={rooms}
                connected={connected}
                myId={playerId}
                onSay={sayInLobby}
                onJoin={handleJoin}
              />
            </div>
          </div>
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

        {inviteToasts}
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

  // Playing the computer: the turn banner carries the Hint button on your
  // turn, and the hint's reason shows under it — to you alone. The banner
  // keeps one height either way, so the board does not jump every turn.
  const aiSeat = state.origin === 'ai' && isSeated;
  const turnBanner =
    state.status === 'playing' && !isSpectator ? (
      <div className={`banner ${myTurn ? 'you-turn' : 'wait'}${aiSeat ? ' with-hint' : ''}`}>
        {myTurn ? 'Your turn. Pick a slot.' : `${state.players.find((p) => p.id === state.currentPlayerId)?.nickname ?? 'Another player'} is picking…`}
        {hint.available && (
          <HintButton
            hintsLeft={hint.hintsLeft}
            asking={hint.asking}
            disabled={!hint.canRequest}
            onClick={() => void hint.request()}
          />
        )}
      </div>
    ) : null;

  return (
    <Shell connected={connected} error={error} welcome={welcome} route={route} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme} me={me}>
      <div className="stack">
        <IdentityBar isGuest={isGuest} elo={elo} guest={guestProfile} onForgetGuest={forgetGuest} />
        <div className="room-bar card">
          <div>
            <span className="room-code">{state.roomId}</span>
            <strong style={{ marginLeft: 8 }}>{state.roomName}</strong>
            {state.config.private && <span className="tag private-tag">private</span>}
            <div className="muted room-meta">
              {state.rows}×{state.cols} · {state.bombCount} mines ·{' '}
              {state.players.length}/{state.config.maxPlayers ?? '∞'} players
              {isSpectator && ' · you are spectating'}
            </div>
          </div>
          <div className="room-bar-actions">
            {/* Keyed by room, so an open popover never shows the last room's code. */}
            <ShareRoom
              key={state.roomId}
              roomId={state.roomId}
              roomName={state.roomName}
              isPrivate={state.config.private === true}
            />
            {/* Players only, as the server enforces; a private room's code goes
                public only on its host's say-so. A full room — a game against
                the computer included — has no seat to advertise. Its own key:
                two siblings sharing one would leave a stale Share control behind
                when the room changes. */}
            {isSeated &&
              state.origin !== 'ai' &&
              (!state.config.private || isHost) &&
              !isRoomFull(state.config, state.players.length) && (
                <PostInviteButton key={`invite-${state.roomId}`} connected={connected} onPost={postInvite} />
              )}
            <button className="ghost" onClick={leaveRoom}>
              Leave room
            </button>
          </div>
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

        {aiSeat && turnBanner ? (
          <div className="ai-turn">
            {turnBanner}
            <HintLine note={hint.note} />
          </div>
        ) : (
          turnBanner
        )}

        <div className={`play-area ${state.status === 'waiting' ? 'no-board' : ''}`}>
          {state.status !== 'waiting' && (
            <Board state={state} myTurn={myTurn && !isSpectator} onReveal={reveal} hint={hint.cell} />
          )}
          <div className="stack room-side">
            <Leaderboard state={state} myId={playerId} moderation={moderation} />
            {/* Keyed by room: a half-typed line or an error never carries over. */}
            <RoomChat
              key={state.roomId}
              messages={roomMessages}
              players={state.players}
              connected={connected}
              onSay={sayInRoom}
            />
          </div>
        </div>
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

      {forfeit && (
        <ForfeitOverlay
          notice={forfeit}
          myId={playerId}
          ranked={state.config.mode === 'ranked'}
          seats={state.players}
          guestChange={guestChange}
          replay={replayForPopup(latestReplay, state.roomId, matchCount)}
          onReview={() => navigate('review', pathForReview('latest'))}
          onStay={dismissForfeit}
          onLeave={leaveRoom}
        />
      )}

      {state.status === 'ended' && !forfeit && (
        <ResultOverlay
          state={state}
          myId={playerId}
          isSpectator={isSpectator}
          onRematch={rematch}
          onLeave={leaveRoom}
          guestChange={guestChange}
          replay={replayForPopup(latestReplay, state.roomId, matchCount)}
          onReview={() => navigate('review', pathForReview('latest'))}
        />
      )}
    </Shell>
  );
}

function IdentityBar({
  isGuest,
  elo,
  guest,
  onForgetGuest,
}: {
  isGuest: boolean;
  elo: number;
  /** The record this browser keeps for a guest: its rating is the one shown, unofficially. */
  guest: GuestProfile | null;
  onForgetGuest: () => void;
}) {
  const client = supabase;
  // The server rates every guest as a flat 800; a guest sees their own figure.
  const shown = isGuest && guest ? guest.rating : elo;
  return (
    <div className="identity-bar">
      <span className="elo-badge">
        <strong>{shown}</strong> Elo
      </span>
      <span className="tag">{isGuest ? 'guest' : 'signed in'}</span>
      {isGuest && (
        <span className="muted">
          {guest ? 'unofficial, kept in this browser for 30 days' : 'unofficial, not kept'}
        </span>
      )}
      {isGuest && (
        <button className="ghost small" onClick={onForgetGuest}>
          Change name
        </button>
      )}
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
  me,
  ownProfile = false,
  children,
}: {
  connected: boolean;
  error: string | null;
  welcome?: string | null;
  route: Route;
  onNavigate: (next: Route) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  /** Who the header's picture shows; null before this tab has a name. */
  me: HeaderUser | null;
  /** The page on screen is your own public page (/u/<you>), which counts as your profile. */
  ownProfile?: boolean;
  children: React.ReactNode;
}) {
  return (
    // A full-height column, so the footer sits at the bottom of the window on
    // short pages and after the content on long ones.
    <div className="app site-shell">
      <header className="header site-header">
        <h1 className="title">Find My Mines</h1>
        <div className="header-right">
          <NavBar route={route} onNavigate={onNavigate} />
          <span className={`conn ${connected ? 'online' : 'offline'}`}>
            {connected ? 'Online' : 'Offline'}
          </span>
          <SoundControl />
          <ProfileButton me={me} current={route === 'profile' || ownProfile} onNavigate={onNavigate} />
        </div>
      </header>

      {/* Spec: "a welcome message with their nickname will appear" */}
      {welcome && <p className="welcome">{welcome}</p>}

      <main className="site-main">{children}</main>

      <SiteFooter route={route} onNavigate={onNavigate} theme={theme} onToggleTheme={onToggleTheme} />

      {error && <div className="toast">{error}</div>}
    </div>
  );
}
