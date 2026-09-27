import {
  STARTING_ELO,
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
import { rememberGuestMatch } from './data/guestHistory.js';
import { socket } from './socket.js';

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
  const [requestResolution, setRequestResolution] = useState<RequestResolution | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state:sync', setState);
    socket.on('match:start', setState);
    socket.on('match:ended', setState);
    socket.on('match:reset', setState);
    socket.on('cell:revealed', ({ state: next }) => setState(next));

    socket.on('lobby:rooms', ({ rooms: list, clientCount: count, online: who }) => {
      setRooms(list);
      setClientCount(count);
      setOnline(who ?? []);
    });

    // Kicked, banned, or the room was ended. The server has already taken us
    // out of the room and the queue; this only changes what is on screen.
    socket.on('player:removed', (notice) => {
      setState(null);
      setQueue(null);
      setRemoved(notice);
    });

    socket.on('room:requestResolved', setRequestResolution);

    // A guest's browser remembers its own saved matches for the game log. An
    // account's matches are found by its profile id instead.
    socket.on('match:recorded', ({ matchId }) => {
      if (!isGuestRef.current) return;
      rememberGuestMatch({ matchId, nickname: myNicknameRef.current, at: Date.now() });
    });

    // Leaving drops us back to the lobby; so does the room closing under us.
    socket.on('room:closed', ({ reason }) => {
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
    socket.on('queue:matched', () => setQueue(null));
    socket.on('error:msg', ({ message }) => showError(message));

    // Listeners are registered first so the initial lobby:rooms isn't missed.
    if (!socket.connected) socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state:sync');
      socket.off('match:start');
      socket.off('match:ended');
      socket.off('match:reset');
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
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
  }, [showError]);

  const join = useCallback((nickname: string) => {
    socket.emit('player:join', { nickname }, (result) => {
      setPlayerId(result.playerId);
      setWelcome(result.welcome);
      setIsGuest(result.isGuest);
      setElo(result.elo);
    });
  }, []);

  const handleRoomAck = useCallback(
    (result: RoomActionResult) => {
      if (!result.ok) showError(result.errors?.[0] ?? 'That did not work.');
      return result;
    },
    [showError],
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

  const leaveRoom = useCallback(() => {
    socket.emit('room:leave');
    setState(null);
  }, []);

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
  };
}
