import {
  ADMIN_ONLY_ERROR,
  type AdminRoomView,
  type AdminState,
  type LogLine,
  type ModerationResult,
  type PlayerReport,
  type RemovalNote,
  type ReportStatus,
} from '@fmm/shared';
import { useCallback, useEffect, useState } from 'react';
import { mergeLogLines } from '../data/format.js';
import { adminSocket } from '../socket.js';

/**
 * All socket wiring for the server console. Like useGame, it only mirrors what
 * the server says; every permission is checked server-side.
 */
export function useAdmin() {
  const [state, setState] = useState<AdminState | null>(null);
  const [connected, setConnected] = useState(false);
  /** The server refused this browser: not the server machine, not an admin account. */
  const [locked, setLocked] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [view, setView] = useState<AdminRoomView | null>(null);
  /** Player reports, newest first, as the server keeps them. */
  const [reports, setReports] = useState<PlayerReport[]>([]);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      setLocked(false);
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = (err: Error) => {
      if (err.message === ADMIN_ONLY_ERROR) setLocked(true);
    };
    const onLog = (incoming: LogLine[]) => setLines((current) => mergeLogLines(current, incoming));

    adminSocket.on('connect', onConnect);
    adminSocket.on('disconnect', onDisconnect);
    adminSocket.on('connect_error', onConnectError);
    adminSocket.on('admin:state', setState);
    adminSocket.on('admin:log', onLog);
    adminSocket.on('admin:room', setView);
    adminSocket.on('admin:reports', setReports);

    // A signed-in admin's session carries over from the game page: the socket
    // reads the token itself when the handshake is sent.
    adminSocket.connect();

    return () => {
      adminSocket.off('connect', onConnect);
      adminSocket.off('disconnect', onDisconnect);
      adminSocket.off('connect_error', onConnectError);
      adminSocket.off('admin:state');
      adminSocket.off('admin:log');
      adminSocket.off('admin:room');
      adminSocket.off('admin:reports');
      adminSocket.disconnect();
    };
  }, []);

  const kick = useCallback(
    (clientId: string, note: RemovalNote) =>
      new Promise<ModerationResult>((resolve) =>
        adminSocket.emit('admin:kick', { clientId, note }, resolve),
      ),
    [],
  );

  const ban = useCallback(
    (clientId: string, note: RemovalNote) =>
      new Promise<ModerationResult>((resolve) =>
        adminSocket.emit('admin:ban', { clientId, note }, resolve),
      ),
    [],
  );

  const closeRoom = useCallback(
    (roomId: string, note: RemovalNote) =>
      new Promise<ModerationResult>((resolve) =>
        adminSocket.emit('admin:closeRoom', { roomId, note }, resolve),
      ),
    [],
  );

  const watch = useCallback((roomId: string | null) => {
    adminSocket.emit('admin:watch', { roomId });
    if (roomId === null) setView(null);
  }, []);

  const setMinesVisible = useCallback(
    (show: boolean) => adminSocket.emit('admin:mines', { show }),
    [],
  );

  const reset = useCallback((roomId?: string) => adminSocket.emit('admin:reset', { roomId }), []);

  /** Resolve, dismiss or reopen a report. Every open console gets the new list. */
  const setReportStatus = useCallback(
    (id: string, status: ReportStatus) =>
      new Promise<ModerationResult>((resolve) => adminSocket.emit('admin:report', { id, status }, resolve)),
    [],
  );

  /** Empties the lobby's world chat for everyone. The terminal log confirms it. */
  const clearChat = useCallback(() => adminSocket.emit('admin:clearChat'), []);

  return {
    state,
    connected,
    locked,
    lines,
    view,
    reports,
    setReportStatus,
    kick,
    ban,
    closeRoom,
    watch,
    setMinesVisible,
    reset,
    clearChat,
  };
}
