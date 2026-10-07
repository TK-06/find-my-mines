import {
  STARTING_ELO,
  cleanChatText,
  type AiAbout,
  type AiHintResult,
  type ChatMessage,
  type ForfeitNotice,
  type FriendInvite,
  type JoinRequestOutcome,
  type LobbyMessage,
  type ModerationResult,
  type OnlinePlayer,
  type PublicMatchState,
  type RemovalNote,
  type RemovalNotice,
  type RoomActionResult,
  type RoomLookupResult,
  type QueueSnapshot,
  type RoomConfig,
  type ReportReason,
  type RoomMode,
  type RoomSummary,
  type ReviewAskResult,
  type ReviewCoachResult,
  type ReviewRef,
  type ServerToClientEvents,
} from '@fmm/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiSetup } from './data/aiPlay.js';
import { addChatMessage } from './data/chat.js';
import { INVITE_TTL_MS, addInvite } from './data/friendsModel.js';
import {
  clearGuestProfile,
  endedResultApplies,
  forfeitResultApplies,
  forfeitSeats,
  loadGuestProfile,
  newGuestId,
  saveGuestProfile,
  unofficialRatingChange,
  withGuestName,
  withResult,
  type GuestProfile,
  type RatedSeat,
  type UnofficialChange,
} from './data/guestCookie.js';
import { clearGuestMatches, rememberGuestMatch } from './data/guestHistory.js';
import { latestFromNotice, withMatchId, type LatestReplay } from './data/latestReplay.js';
import { seatOfMe } from './data/reviewModel.js';
import { addLobbyMessage, lobbyHistory } from './data/worldChat.js';
import { socket } from './socket.js';

const GUEST_KEY = 'fmm.guest';

/**
 * The nickname a guest last played under, so a refresh does not log them out.
 * Per tab (sessionStorage), so two tabs in one browser stay two players.
 */
export function storedGuestName(): string | null {
  try {
    return sessionStorage.getItem(GUEST_KEY);
  } catch {
    return null;
  }
}

function rememberGuest(nickname: string | null): void {
  try {
    if (nickname) sessionStorage.setItem(GUEST_KEY, nickname);
    else sessionStorage.removeItem(GUEST_KEY);
  } catch {
    // Storage blocked: the guest simply types their name again next time.
  }
}

/** Forgets the remembered guest name, so the next load asks for one again. */
export function forgetStoredGuest(): void {
  rememberGuest(null);
}

/** How the host answered our request to join (or the room closed first). */
export interface RequestResolution {
  roomId: string;
  roomName: string;
  outcome: JoinRequestOutcome;
  byName: string | null;
}

/**
 * All socket wiring for the game client.
 *
 * The server is authoritative for everything — this hook only mirrors what it
 * is told. No game rule is evaluated here.
 */
export function useGame() {
  const [connected, setConnected] = useState(socket.connected);
  const [state, setState] = useState<PublicMatchState | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [clientCount, setClientCount] = useState(0);
  const [online, setOnline] = useState<OnlinePlayer[]>([]);
  /** Set when a host or admin removed us; the removed page shows until dismissed. */
  const [removed, setRemoved] = useState<RemovalNotice | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [welcome, setWelcome] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(true);
  const [elo, setElo] = useState(STARTING_ELO);
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [forfeit, setForfeit] = useState<ForfeitNotice | null>(null);
  const [requestResolution, setRequestResolution] = useState<RequestResolution | null>(null);
  /** Invites from friends to the room they are in, newest last. */
  const [friendInvites, setFriendInvites] = useState<FriendInvite[]>([]);
  /** The chat of the room we follow, oldest first. Nothing is kept once we leave it. */
  const [roomMessages, setRoomMessages] = useState<ChatMessage[]>([]);
  /** The lobby's world chat, oldest first: the server's history, then each new line. */
  const [lobbyMessages, setLobbyMessages] = useState<LobbyMessage[]>([]);
  /**
   * The replay of the game this tab last finished (or watched finish), kept for
   * its review. It outlives the room: leaving does not take it away.
   */
  const [latestReplay, setLatestReplay] = useState<LatestReplay | null>(null);
  /** How many matches have started in this tab, so a replay can be matched to the game it belongs to. */
  const [matchCount, setMatchCount] = useState(0);
  const matchCountRef = useRef(0);
  /** The newest room snapshot, for socket listeners that would otherwise see an old render's. */
  const stateRef = useRef<PublicMatchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * The guest remembered by this browser (the `fmm_guest` cookie), with their
   * unofficial rating. Read once at load; null for anyone else. Kept in memory
   * too, so a browser that blocks cookies still tallies for as long as the tab lives.
   */
  const [guestProfile, setGuestProfile] = useState<GuestProfile | null>(() => loadGuestProfile());
  const guestProfileRef = useRef(guestProfile);
  /** The guest's own rating change for the match just finished, for the result screen. */
  const [guestChange, setGuestChange] = useState<UnofficialChange | null>(null);
  /**
   * The last state seen while a match was being played, in the room we follow.
   * A result is counted by comparing against it, and it is dropped the moment
   * one is counted — that is what keeps a match from counting twice.
   */
  const playingSnapshot = useRef<PublicMatchState | null>(null);
  /** Set once "Forget me" is used by a tab that already has a name: nothing is remembered again until it reloads. */
  const suppressRemember = useRef(false);
  /**
   * The id a brand-new guest gets. Made up front, so the very first join can
   * already send it; the record created after that join keeps the same one.
   */
  const pendingGuestId = useRef(newGuestId());

  // A cookie written before guests had ids was given one when it was read.
  // Write it back once, so every later read (and this tab's join) sees the same id.
  useEffect(() => {
    if (guestProfileRef.current) saveGuestProfile(guestProfileRef.current);
  }, []);

  /**
   * The room this client is in, as far as it knows. Room events for any other
   * room are ignored — after leaving, a late update must not pull us back in.
   */
  const activeRoom = useRef<string | null>(null);

  /**
   * Adopt a room (or none) as the one we follow. Every place that changes
   * `activeRoom` goes through here, so the chat always belongs to it: lines
   * from the room we were in never show up in the next one.
   */
  const followRoom = useCallback((roomId: string | null) => {
    activeRoom.current = roomId;
    playingSnapshot.current = null;
    setGuestChange(null);
    setRoomMessages([]);
  }, []);
  const playerIdRef = useRef<string | null>(null);
  /** Set once joined, so a dropped connection can re-join under the same name. */
  const lastNickname = useRef<string | null>(null);

  // Read by long-lived socket listeners, which would otherwise see the values
  // from the render they were registered in.
  const isGuestRef = useRef(isGuest);
  isGuestRef.current = isGuest;
  /** The name we last played under — the room may be gone when the save lands. */
  const myNicknameRef = useRef('');
  const mine = state?.players.find((p) => p.id === playerId);
  if (mine) myNicknameRef.current = mine.nickname;

  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showError = useCallback((message: string) => {
    setError(message);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 2600);
  }, []);

  /** Each friend invite's own expiry, cleared if the hook goes away first. */
  const inviteTimers = useRef(new Set<ReturnType<typeof setTimeout>>());

  /** Keeps the guest's record: in memory, and in the cookie (which is written again, for another 30 days). */
  const commitGuest = useCallback((next: GuestProfile | null) => {
    guestProfileRef.current = next;
    setGuestProfile(next);
    if (next) saveGuestProfile(next);
  }, []);

  /**
   * A finished ranked match, added to the guest's own record. The server has
   * already rated this seat as a fixed 800 and dropped the result; this is the
   * browser's private tally. The cookie is read first, so a second tab's
   * results are not overwritten by this tab's older copy.
   */
  const countGuestResult = useCallback(
    (seats: readonly RatedSeat[], ranked: boolean) => {
      const myId = playerIdRef.current;
      if (!isGuestRef.current || myId === null || !ranked || guestProfileRef.current === null) return;
      const base = loadGuestProfile() ?? guestProfileRef.current;
      const change = unofficialRatingChange({ ranked, myId, seats, profile: base });
      if (!change) return;
      commitGuest(withResult(base, change, Date.now()));
      setGuestChange(change);
    },
    [commitGuest],
  );

  const join = useCallback((nickname: string) => {
    // A signed-in player's id is their account; the server ignores this for them.
    const guestId = (loadGuestProfile() ?? guestProfileRef.current)?.id ?? pendingGuestId.current;
    socket.emit('player:join', { nickname, guestId }, (result) => {
      lastNickname.current = nickname;
      playerIdRef.current = result.playerId;
      setPlayerId(result.playerId);
      setWelcome(result.welcome);
      setIsGuest(result.isGuest);
      setElo(result.elo);
      if (result.isGuest && nickname) {
        rememberGuest(nickname);
        // The same person on this browser keeps their record under a new name.
        if (!suppressRemember.current) {
          commitGuest(
            withGuestName(loadGuestProfile() ?? guestProfileRef.current, nickname, Date.now(), pendingGuestId.current),
          );
        }
      }
      // The server held our seat through a dropped connection or a refresh.
      if (result.roomId) followRoom(result.roomId);
    });
  }, [followRoom, commitGuest]);

  useEffect(() => {
    /** Mirrors a room snapshot, but only for the room we are actually in. */
    const accept = (next: PublicMatchState) => {
      if (next.roomId !== activeRoom.current) return;
      if (next.status === 'playing') {
        playingSnapshot.current = next;
        setGuestChange(null);
      } else if (endedResultApplies(playingSnapshot.current, next, playerIdRef.current)) {
        playingSnapshot.current = null;
        countGuestResult(next.players, next.config.mode === 'ranked');
      }
      stateRef.current = next;
      setState(next);
      const me = next.players.find((p) => p.id === playerIdRef.current);
      if (me) setElo(me.elo);
    };

    const onConnect = () => {
      setConnected(true);
      // The server forgets a socket when it drops (Render waking up, Wi-Fi
      // blip). Re-join under the same name instead of stranding the player.
      if (lastNickname.current !== null) {
        followRoom(null);
        setState(null);
        join(lastNickname.current);
      }
    };
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state:sync', accept);
    socket.on('match:start', (next) => {
      if (next.roomId === activeRoom.current) {
        matchCountRef.current += 1;
        setMatchCount(matchCountRef.current);
      }
      setForfeit(null);
      accept(next);
    });
    socket.on('match:ended', accept);
    socket.on('match:reset', accept);
    socket.on('cell:revealed', ({ state: next }) => accept(next));

    socket.on('match:forfeit', (notice) => {
      if (notice.roomId !== activeRoom.current) return;
      // The leaver is no longer among the seats, so their rating comes from
      // the last state seen while the match was played.
      const snapshot = playingSnapshot.current;
      if (snapshot && forfeitResultApplies(snapshot, notice, playerIdRef.current)) {
        playingSnapshot.current = null;
        countGuestResult(forfeitSeats(notice, snapshot), snapshot.config.mode === 'ranked');
      }
      // The state:sync that follows carries the updated rating.
      setForfeit(notice);
    });
    socket.on('room:notice', ({ message }) => showError(message));

    socket.on('lobby:rooms', ({ rooms: list, clientCount: count, online: who }) => {
      setRooms(list);
      setClientCount(count);
      setOnline(who ?? []);
    });

    // Kicked, banned, or the room was ended. The server has already taken us
    // out of the room and the queue; this only changes what is on screen.
    socket.on('player:removed', (notice) => {
      followRoom(null);
      setState(null);
      setQueue(null);
      setForfeit(null);
      setRemoved(notice);
    });

    // On 'accepted' the server seats us right after this, so adopt the room
    // now — its state:sync would otherwise be ignored as another room's.
    socket.on('room:requestResolved', (resolution) => {
      if (resolution.outcome === 'accepted') {
        followRoom(resolution.roomId);
        setForfeit(null);
      }
      setRequestResolution(resolution);
    });

    // The finished match's replay: where the mines were and how the cells were
    // opened. It only ever arrives after the match is over. Kept for the review
    // page, with which seat was ours and how the room was set up, read now
    // because the room may be gone by the time the page is opened.
    socket.on('match:replay', (notice) => {
      if (notice.roomId !== activeRoom.current) return;
      const room = stateRef.current?.roomId === notice.roomId ? stateRef.current : null;
      setLatestReplay(
        latestFromNotice(notice, {
          matchCount: matchCountRef.current,
          mode: room?.config.mode ?? null,
          you: room ? seatOfMe(notice.replay, room.players, playerIdRef.current) : null,
          now: Date.now(),
        }),
      );
    });

    // The saved match's id links the game just played to its record, so its
    // review can be opened by either. A guest's browser also remembers its own
    // saved matches for the game log; an account's are found by its profile id.
    socket.on('match:recorded', ({ matchId }) => {
      setLatestReplay((latest) => withMatchId(latest, matchId));
      if (!isGuestRef.current || suppressRemember.current) return;
      rememberGuestMatch({ matchId, nickname: myNicknameRef.current, at: Date.now() });
    });

    // Leaving drops us back to the lobby; so does the room closing under us.
    socket.on('room:closed', ({ roomId, reason }) => {
      if (roomId !== activeRoom.current) return;
      followRoom(null);
      setState(null);
      showError(reason);
    });

    socket.on('turn:changed', ({ currentPlayerId, secondsLeft }) =>
      setState((prev) => (prev ? { ...prev, currentPlayerId, secondsLeft } : prev)),
    );
    socket.on('turn:tick', ({ secondsLeft }) =>
      setState((prev) => (prev ? { ...prev, secondsLeft } : prev)),
    );
    socket.on('queue:status', setQueue);
    socket.on('queue:matched', ({ roomId }) => {
      followRoom(roomId);
      setForfeit(null);
      setQueue(null);
    });
    socket.on('error:msg', ({ message }) => showError(message));

    // Room chat. Read the room now, not inside the updater: by the time React
    // runs it we may already follow another room.
    socket.on('room:message', (message) => {
      const roomId = activeRoom.current;
      setRoomMessages((list) => addChatMessage(list, message, roomId));
    });

    // World chat. The history comes once per name picked (again after a
    // reconnect) and replaces what we had; an admin can empty it for everyone.
    socket.on('lobby:history', (history) => setLobbyMessages(lobbyHistory(history)));
    socket.on('lobby:message', (message) =>
      setLobbyMessages((list) => addLobbyMessage(list, message)),
    );
    socket.on('lobby:cleared', () => setLobbyMessages([]));

    // A friend asked us over. A newer invite from the same friend to the same
    // room replaces the older one, and each goes away by itself after a
    // minute — by then the room has usually moved on.
    const timers = inviteTimers.current;
    socket.on('friend:invited', (invite) => {
      // Already there: nothing to accept.
      if (invite.roomId === activeRoom.current) return;
      setFriendInvites((list) => addInvite(list, invite));
      const timer = setTimeout(() => {
        timers.delete(timer);
        setFriendInvites((list) => list.filter((i) => i.id !== invite.id));
      }, INVITE_TTL_MS);
      timers.add(timer);
    });

    // The friend we invited said no. An invite that merely ran out says nothing.
    socket.on('friend:inviteDeclined', ({ byName }) => showError(`${byName} declined your invite.`));

    // Listeners are registered first so the initial lobby:rooms isn't missed.
    if (!socket.connected) socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state:sync');
      socket.off('match:start');
      socket.off('match:ended');
      socket.off('match:reset');
      socket.off('match:forfeit');
      socket.off('room:notice');
      socket.off('cell:revealed');
      socket.off('lobby:rooms');
      socket.off('player:removed');
      socket.off('room:requestResolved');
      socket.off('match:recorded');
      socket.off('match:replay');
      socket.off('room:closed');
      socket.off('turn:changed');
      socket.off('turn:tick');
      socket.off('queue:status');
      socket.off('queue:matched');
      socket.off('error:msg');
      socket.off('room:message');
      socket.off('lobby:history');
      socket.off('lobby:message');
      socket.off('lobby:cleared');
      socket.off('friend:invited');
      socket.off('friend:inviteDeclined');
      if (errorTimer.current) clearTimeout(errorTimer.current);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, [showError, join, followRoom, countGuestResult]);

  /** Forgets the remembered guest and starts over at the nickname screen. */
  const forgetGuest = useCallback(() => {
    forgetStoredGuest();
    window.location.reload();
  }, []);

  /**
   * "Not you?" and "Forget me": the cookie and the remembered matches go, and
   * the next guest to join starts at 800 with nothing played. A tab that is
   * already playing under a name stays as it is, but remembers nothing more.
   */
  const forgetGuestData = useCallback(() => {
    suppressRemember.current = playerIdRef.current !== null;
    // Forgotten means forgotten: the next guest on this browser is a new id too.
    pendingGuestId.current = newGuestId();
    clearGuestProfile();
    clearGuestMatches();
    guestProfileRef.current = null;
    setGuestProfile(null);
    setGuestChange(null);
  }, []);

  const handleRoomAck = useCallback(
    (result: RoomActionResult) => {
      if (result.ok && result.roomId) {
        followRoom(result.roomId);
        setForfeit(null);
      }
      if (!result.ok) showError(result.errors?.[0] ?? 'That did not work.');
      return result;
    },
    [showError, followRoom],
  );

  const createRoom = useCallback(
    (name: string, config: RoomConfig) =>
      new Promise<RoomActionResult>((resolve) =>
        socket.emit('room:create', { name, config }, (r) => resolve(handleRoomAck(r))),
      ),
    [handleRoomAck],
  );

  const joinRoom = useCallback(
    (roomId: string) =>
      new Promise<RoomActionResult>((resolve) =>
        socket.emit('room:join', { roomId }, (r) => resolve(handleRoomAck(r))),
      ),
    [handleRoomAck],
  );

  const spectateRoom = useCallback(
    (roomId: string) =>
      new Promise<RoomActionResult>((resolve) =>
        socket.emit('room:spectate', { roomId }, (r) => resolve(handleRoomAck(r))),
      ),
    [handleRoomAck],
  );

  /**
   * One room by its code, private rooms included — a join link or "Join by
   * code" must know whether to join or ask the host. Resolves null, with a
   * toast saying why, when there is no such room. Timed, so a lost answer
   * cannot leave the join hanging.
   */
  const lookupRoom = useCallback(
    (roomId: string) =>
      new Promise<RoomSummary | null>((resolve) =>
        socket
          .timeout(8000)
          .emit('room:lookup', { roomId }, (err: Error | null, result: RoomLookupResult) => {
            if (!err && result?.ok && result.room) {
              resolve(result.room);
              return;
            }
            showError(
              err || !result
                ? 'The server did not answer — try again.'
                : (result.error ?? 'That room no longer exists.'),
            );
            resolve(null);
          }),
      ),
    [showError],
  );

  /**
   * A game against the computer. The server makes the room, seats us and the
   * bot, and starts at once — so, like creating a room, the ack's room is
   * adopted before its first state:sync arrives.
   */
  const playVsAi = useCallback(
    (setup: AiSetup) =>
      new Promise<RoomActionResult>((resolve) =>
        socket.emit('ai:play', setup, (r) => resolve(handleRoomAck(r))),
      ),
    [handleRoomAck],
  );

  /**
   * What the server's language model is, for the "About this opponent"
   * dialog. Null when there is no answer: the dialog says it could not check
   * rather than guessing.
   */
  const aiAbout = useCallback(
    () =>
      new Promise<AiAbout | null>((resolve) =>
        socket
          .timeout(8000)
          .emit('ai:about', {}, (err: Error | null, result: AiAbout) => resolve(err ? null : result)),
      ),
    [],
  );

  const leaveRoom = useCallback(() => {
    // Cleared before emitting, so nothing the room sends afterwards is applied.
    followRoom(null);
    socket.emit('room:leave');
    setState(null);
    setForfeit(null);
  }, [followRoom]);

  const joinQueue = useCallback((mode: RoomMode) => socket.emit('queue:join', { mode }), []);
  const leaveQueue = useCallback(() => {
    socket.emit('queue:leave');
    setQueue(null);
  }, []);

  const startMatch = useCallback(() => socket.emit('game:start'), []);
  const reveal = useCallback(
    (row: number, col: number) => socket.emit('game:reveal', { row, col }),
    [],
  );
  const rematch = useCallback(() => socket.emit('game:rematch'), []);
  const dismissForfeit = useCallback(() => setForfeit(null), []);

  /** Host only. The server re-checks every rule; a refusal comes back as `error`. */
  const kickMember = useCallback(
    (targetId: string, ban: boolean, note: RemovalNote) =>
      new Promise<ModerationResult>((resolve) =>
        socket.emit('room:kick', { targetId, ban, note }, resolve),
      ),
    [],
  );

  const dismissRemoved = useCallback(() => setRemoved(null), []);

  /** Ask an ask-to-join room's host for a seat. Resolves when the request is pending. */
  const requestJoin = useCallback((roomId: string) => {
    setRequestResolution(null);
    return new Promise<ModerationResult>((resolve) =>
      socket.emit('room:requestJoin', { roomId }, resolve),
    );
  }, []);

  const cancelJoinRequest = useCallback(() => socket.emit('room:cancelRequest'), []);
  const clearRequestResolution = useCallback(() => setRequestResolution(null), []);

  /** Host only: let a requester in, or turn them away. */
  const answerJoinRequest = useCallback(
    (requesterId: string, accept: boolean) =>
      new Promise<ModerationResult>((resolve) =>
        socket.emit('room:answerRequest', { requesterId, accept }, (result) => {
          if (!result.ok) showError(result.error ?? 'That did not work.');
          resolve(result);
        }),
      ),
    [showError],
  );

  /**
   * Signed-in players only: invite an online friend to the room you are in.
   * The server checks the friendship; a refusal comes back as `error`.
   *
   * Timed, unlike the other acks: the server's friendship check waits on the
   * database, and an answer lost to a dropped connection must not leave the
   * Invite button spinning forever.
   */
  const inviteFriend = useCallback(
    (profileId: string) =>
      new Promise<ModerationResult>((resolve) =>
        socket
          .timeout(8000)
          .emit('friend:invite', { profileId }, (err: Error | null, result: ModerationResult) =>
            resolve(err ? { ok: false, error: 'The server did not answer — try again.' } : result),
          ),
      ),
    [],
  );

  /**
   * Report someone in the online list. The server fills in who and where from
   * its own records; a refusal (already reported, too many) comes back as
   * `error`. Timed, so a lost answer never leaves the dialog waiting.
   */
  const reportPlayer = useCallback(
    (targetId: string, reason: ReportReason, details: string) =>
      new Promise<ModerationResult>((resolve) =>
        socket
          .timeout(8000)
          .emit('player:report', { targetId, reason, details }, (err: Error | null, result: ModerationResult) =>
            resolve(err ? { ok: false, error: 'The server did not answer — try again.' } : result),
          ),
      ),
    [],
  );

  const dismissInvite = useCallback(
    (id: string) => setFriendInvites((list) => list.filter((invite) => invite.id !== id)),
    [],
  );

  /**
   * Say no to a friend's invite: the popup goes, and the server tells whoever
   * sent it. Fire and forget — the server only honours a decline from the
   * account that was invited, and the popup is gone either way.
   */
  const declineInvite = useCallback(
    (id: string) => {
      dismissInvite(id);
      socket.emit('friend:declineInvite', { inviteId: id });
    },
    [dismissInvite],
  );

  /**
   * In a game against the computer, on your turn: the server's pick of the
   * covered cell most likely to be a mine. It counts the hints; a refusal
   * (not your turn, none left) comes back as `error`. Timed, so a lost answer
   * cannot leave the button waiting forever.
   */
  const askHint = useCallback(
    () =>
      new Promise<AiHintResult>((resolve) =>
        socket
          .timeout(10_000)
          .emit('ai:hint', {}, (err: Error | null, result: AiHintResult) =>
            resolve(
              err || !result
                ? { ok: false, error: 'The server did not answer — try again.' }
                : result,
            ),
          ),
      ),
    [],
  );

  /**
   * Hears the language model's friendlier wording of a hint's "Why?", which the
   * server sends to the asker alone a moment after the hint itself. The hint
   * hook decides whether it still applies; this only wires the event, and
   * hands back the way to stop listening.
   */
  const onHintWhy = useCallback((listener: ServerToClientEvents['ai:hintWhy']) => {
    socket.on('ai:hintWhy', listener);
    return () => {
      socket.off('ai:hintWhy', listener);
    };
  }, []);

  /**
   * Is the coach on for this finished game, and how many questions are left?
   * Null when the server did not answer. Timed, so a lost answer cannot leave
   * the panel waiting for ever.
   */
  const coachStatus = useCallback(
    (ref: ReviewRef) =>
      new Promise<ReviewCoachResult | null>((resolve) =>
        socket
          .timeout(10_000)
          .emit('review:coach', ref, (err: Error | null, result: ReviewCoachResult) =>
            resolve(err || !result ? null : result),
          ),
      ),
    [],
  );

  /**
   * One question to the coach about a finished game. The server answers from its
   * own record of the game; a refusal or a busy coach comes back as `error` and
   * costs no question. Timed generously: the model may take several seconds.
   */
  const askCoach = useCallback(
    (ref: ReviewRef, question: string) =>
      new Promise<ReviewAskResult | null>((resolve) =>
        socket
          .timeout(20_000)
          .emit('review:ask', { ...ref, question }, (err: Error | null, result: ReviewAskResult) =>
            resolve(err || !result ? null : result),
          ),
      ),
    [],
  );

  /**
   * Say something in the room's chat. Nothing is shown until the server sends
   * the line back to the whole room, us included — it may refuse (too fast,
   * not in a room) and says why in `error`.
   */
  const sayInRoom = useCallback((text: string) => {
    const clean = cleanChatText(text);
    if (clean === null) {
      return Promise.resolve<ModerationResult>({ ok: false, error: 'Type a message first.' });
    }
    return new Promise<ModerationResult>((resolve) =>
      socket
        .timeout(8000)
        .emit('room:say', { text: clean }, (err: Error | null, result: ModerationResult) =>
          resolve(
            err || !result ? { ok: false, error: 'The server did not answer — try again.' } : result,
          ),
        ),
    );
  }, []);

  /**
   * Say something in the lobby's world chat. Like the room chat, the line
   * shows when the server sends it back to everyone; a refusal (too fast, no
   * name yet) comes back as `error`.
   */
  const sayInLobby = useCallback((text: string) => {
    const clean = cleanChatText(text);
    if (clean === null) {
      return Promise.resolve<ModerationResult>({ ok: false, error: 'Type a message first.' });
    }
    return new Promise<ModerationResult>((resolve) =>
      socket
        .timeout(8000)
        .emit('lobby:say', { text: clean }, (err: Error | null, result: ModerationResult) =>
          resolve(
            err || !result ? { ok: false, error: 'The server did not answer — try again.' } : result,
          ),
        ),
    );
  }, []);

  /**
   * Post an invite card for the room we are playing in to the world chat.
   * The server decides whether we may (seated, a free seat, the host's call
   * for a private room, not too often) and says why not in `error`.
   */
  const postInvite = useCallback(
    () =>
      new Promise<ModerationResult>((resolve) =>
        socket
          .timeout(8000)
          .emit('lobby:invite', {}, (err: Error | null, result: ModerationResult) =>
            resolve(
              err || !result
                ? { ok: false, error: 'The server did not answer — try again.' }
                : result,
            ),
          ),
      ),
    [],
  );

  return {
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
    /** The short toast at the bottom of the page, for a notice that is not an error too. */
    notify: showError,
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
  };
}
