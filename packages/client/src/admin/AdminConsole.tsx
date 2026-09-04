import type { AdminState } from '@fmm/shared';
import { useEffect, useState } from 'react';
import { adminSocket } from '../socket.js';

/**
 * The server's console, served by the server process at /admin.
 *
 * Covers two graded requirements:
 *   - "The server program must display: (1) the number of concurrent clients
 *      currently connected (2) a list of those connected clients."
 *   - "The server has a reset button to reset the game and players' scores."
 *
 * The same information is also printed to the server's stdout.
 */
export function AdminConsole() {
  const [state, setState] = useState<AdminState | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    adminSocket.connect();

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    adminSocket.on('connect', onConnect);
    adminSocket.on('disconnect', onDisconnect);
    adminSocket.on('admin:state', setState);

    return () => {
      adminSocket.off('connect', onConnect);
      adminSocket.off('disconnect', onDisconnect);
      adminSocket.off('admin:state');
      adminSocket.disconnect();
    };
  }, []);

  const rooms = state?.rooms ?? [];
  const playing = rooms.filter((r) => r.status === 'playing').length;

  return (
    <div className="app admin">
      <header className="header">
        <div>
          <h1 className="title">Server Console</h1>
          <p className="subtitle">Find My Mines · authoritative game server</p>
        </div>
        <span className={`conn ${connected ? 'online' : 'offline'}`}>
          {connected ? '● live' : '● disconnected'}
        </span>
      </header>

      <div className="stack">
        <div className="stat-row">
          <div className="stat">
            <div className="k">Clients online</div>
            <div className="v">{state?.clientCount ?? '–'}</div>
          </div>
          <div className="stat">
            <div className="k">Open rooms</div>
            <div className="v">{state ? rooms.length : '–'}</div>
          </div>
          <div className="stat">
            <div className="k">Matches running</div>
            <div className="v">{state ? playing : '–'}</div>
          </div>
          <div className="stat">
            <div className="k">In matchmaking</div>
            <div className="v">{state ? (state.queue?.length ?? 0) : '–'}</div>
          </div>
        </div>

        <div className="card">
          <h3>Connected clients</h3>
          {state && state.clients.length > 0 ? (
            <ul className="list">
              {state.clients.map((client, index) => (
                <li key={client.id}>
                  <span>
                    <strong>{index + 1}.</strong> {client.nickname}{' '}
                    <span className="muted">{client.address}</span>
                  </span>
                  <span>
                    <span className="tag">{client.roomId ?? 'lobby'}</span>{' '}
                    <span className={`tag ${client.seat}`}>{client.seat}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No clients connected.</p>
          )}
        </div>

        <div className="card">
          <h3>Matchmaking pool</h3>
          {(state?.queue?.length ?? 0) > 0 ? (
            <ul className="list">
              {state!.queue.map((row) => (
                <li key={row.id}>
                  <span>
                    <strong>{row.nickname}</strong>{' '}
                    <span className="muted">{row.elo} Elo</span>
                  </span>
                  <span>
                    <span className={`tag mode-${row.mode}`}>{row.mode}</span>{' '}
                    <span className="muted">
                      {Math.round(row.waitedMs / 1000)}s · ±{row.eloWindow}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nobody is queued.</p>
          )}
        </div>

        <div className="card">
          <h3>Rooms</h3>
          {rooms.length > 0 ? (
            <ul className="list">
              {rooms.map((room) => (
                <li key={room.id}>
                  <span>
                    <span className="room-code">{room.id}</span> <strong>{room.name}</strong>
                    <span className="muted">
                      {' '}
                      · {room.config.rows}×{room.config.cols} · {room.config.mineCount} mines ·{' '}
                      {room.playerCount}/{room.config.maxPlayers ?? '∞'} players
                      {room.spectatorCount > 0 && ` · ${room.spectatorCount} watching`}
                    </span>
                  </span>
                  <span>
                    <span className={`tag status-${room.status}`}>{room.status}</span>{' '}
                    <button
                      className="danger small"
                      disabled={!connected}
                      onClick={() => adminSocket.emit('admin:reset', { roomId: room.id })}
                    >
                      Reset
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No rooms open.</p>
          )}
        </div>

        <div className="card">
          <h3>Controls</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Reset clears the board, ends the current match and sets every score — including
            cumulative totals — back to zero. Reset all applies that to every open room.
          </p>
          <button className="danger" disabled={!connected} onClick={() => adminSocket.emit('admin:reset', {})}>
            Reset all games &amp; scores
          </button>
        </div>
      </div>
    </div>
  );
}
