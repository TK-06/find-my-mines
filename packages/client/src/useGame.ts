import {
  STARTING_ELO,
  type ForfeitNotice,
  type PublicMatchState,
  type RoomActionResult,
  type QueueSnapshot,
  type RoomConfig,
  type RoomMode,
  type RoomSummary,
} from '@fmm/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [welcome, setWelcome] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(true);
  const [elo, setElo] = useState(STARTING_ELO);
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [forfeit, setForfeit] = useState<ForfeitNotice | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The room this client is in, as far as it knows. Room events for any other
   * room are ignored — after leaving, a late update must not pull us back in.
   */
  const activeRoom = useRef<string | null>(null);
  const playerIdRef = useRef<string | null>(null);
  /** Set once joined, so a dropped connection can re-join under the same name. */
  const lastNickname = useRef<string | null>(null);

  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showError = useCallback((message: string) => {
    setError(message);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 2600);
  }, []);

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
      if (result.roomId) activeRoom.current = result.roomId;
    });
  }, []);

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
        activeRoom.current = null;
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

    socket.on('lobby:rooms', ({ rooms: list, clientCount: count }) => {
      setRooms(list);
      setClientCount(count);
    });

    // Leaving drops us back to the lobby; so does the room closing under us.
    socket.on('room:closed', ({ roomId, reason }) => {
      if (roomId !== activeRoom.current) return;
      activeRoom.current = null;
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
      activeRoom.current = roomId;
      setForfeit(null);
      setQueue(null);
    });
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
      socket.off('match:forfeit');
      socket.off('room:notice');
      socket.off('cell:revealed');
      socket.off('lobby:rooms');
      socket.off('room:closed');
      socket.off('turn:changed');
      socket.off('turn:tick');
      socket.off('queue:status');
      socket.off('queue:matched');
      socket.off('error:msg');
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
  }, [showError, join]);

  /** Forgets the remembered guest and starts over at the nickname screen. */
  const forgetGuest = useCallback(() => {
    rememberGuest(null);
    window.location.reload();
  }, []);

  const handleRoomAck = useCallback(
    (result: RoomActionResult) => {
      if (result.ok && result.roomId) {
        activeRoom.current = result.roomId;
        setForfeit(null);
      }
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
    // Cleared before emitting, so nothing the room sends afterwards is applied.
    activeRoom.current = null;
    socket.emit('room:leave');
    setState(null);
    setForfeit(null);
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
  const dismissForfeit = useCallback(() => setForfeit(null), []);

  return {
    connected,
    state,
    rooms,
    clientCount,
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
  };
}
