import {
  STARTING_ELO,
  cleanChatText,
  type AiHintResult,
  type AiLevel,
  type ChatMessage,
  type ForfeitNotice,
  type FriendInvite,
  type JoinRequestOutcome,
  type ModerationResult,
  type OnlinePlayer,
  type PublicMatchState,
  type RemovalNote,
  type RemovalNotice,
  type RoomActionResult,
  type QueueSnapshot,
  type RoomConfig,
  type RoomMode,
  type RoomSummary,
} from '@fmm/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { addChatMessage } from './data/chat.js';
import { INVITE_TTL_MS, addInvite } from './data/friendsModel.js';
import { rememberGuestMatch } from './data/guestHistory.js';
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
  const [error, setError] = useState<string | null>(null);

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

  const join = useCallback((nickname: string) => {
    socket.emit('player:join', { nickname }, (result) => {
      lastNickname.current = nickname;
      playerIdRef.current = result.playerId;
      setPlayerId(result.playerId);
      setWelcome(result.welcome);
      setIsGuest(result.isGuest);
      setElo(result.elo);
      if (result.isGuest && nickname) rememberGuest(nickname);
      // The server held our seat through a dropped connection or a refresh.
      if (result.roomId) followRoom(result.roomId);
    });
  }, [followRoom]);

  useEffect(() => {
    /** Mirrors a room snapshot, but only for the room we are actually in. */
    const accept = (next: PublicMatchState) => {
      if (next.roomId !== activeRoom.current) return;
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
      setForfeit(null);
      accept(next);
    });
    socket.on('match:ended', accept);
    socket.on('match:reset', accept);
    socket.on('cell:revealed', ({ state: next }) => accept(next));

    socket.on('match:forfeit', (notice) => {
      if (notice.roomId !== activeRoom.current) return;
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

    // A guest's browser remembers its own saved matches for the game log. An
    // account's matches are found by its profile id instead.
    socket.on('match:recorded', ({ matchId }) => {
      if (!isGuestRef.current) return;
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
      socket.off('room:closed');
      socket.off('turn:changed');
      socket.off('turn:tick');
      socket.off('queue:status');
      socket.off('queue:matched');
      socket.off('error:msg');
      socket.off('room:message');
      socket.off('friend:invited');
      if (errorTimer.current) clearTimeout(errorTimer.current);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, [showError, join, followRoom]);

  /** Forgets the remembered guest and starts over at the nickname screen. */
  const forgetGuest = useCallback(() => {
    forgetStoredGuest();
    window.location.reload();
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
   * A game against the computer. The server makes the room, seats us and the
   * bot, and starts at once — so, like creating a room, the ack's room is
   * adopted before its first state:sync arrives.
   */
  const playVsAi = useCallback(
    (level: AiLevel) =>
      new Promise<RoomActionResult>((resolve) =>
        socket.emit('ai:play', { level }, (r) => resolve(handleRoomAck(r))),
      ),
    [handleRoomAck],
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

  const dismissInvite = useCallback(
    (id: string) => setFriendInvites((list) => list.filter((invite) => invite.id !== id)),
    [],
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
    createRoom,
    joinRoom,
    spectateRoom,
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
    playVsAi,
    askHint,
    roomMessages,
    sayInRoom,
  };
}
