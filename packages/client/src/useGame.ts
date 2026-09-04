import type { PublicMatchState, RoomActionResult, RoomConfig, RoomSummary } from '@fmm/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from './socket.js';

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
  const [error, setError] = useState<string | null>(null);

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

    socket.on('lobby:rooms', ({ rooms: list, clientCount: count }) => {
      setRooms(list);
      setClientCount(count);
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
      socket.off('room:closed');
      socket.off('turn:changed');
      socket.off('turn:tick');
      socket.off('error:msg');
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
  }, [showError]);

  const join = useCallback((nickname: string) => {
    socket.emit('player:join', { nickname }, (result) => {
      setPlayerId(result.playerId);
      setWelcome(result.welcome);
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

  const startMatch = useCallback(() => socket.emit('game:start'), []);
  const reveal = useCallback(
    (row: number, col: number) => socket.emit('game:reveal', { row, col }),
    [],
  );
  const rematch = useCallback(() => socket.emit('game:rematch'), []);

  return {
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
  };
}
