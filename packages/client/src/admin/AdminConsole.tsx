import type { ModerationResult, RemovalNote } from '@fmm/shared';
import { useEffect, useRef, useState } from 'react';
import { ReasonDialog } from '../components/ReasonDialog.js';
import { GameViewer } from './GameViewer.js';
import { ReportsPanel } from './ReportsPanel.js';
import { TerminalPanel } from './TerminalPanel.js';
import { useAdmin } from './useAdmin.js';

/** A kick, ban or end-game waiting on its reasons. */
type PendingAction =
  | { kind: 'kick' | 'ban'; clientId: string; label: string }
  | { kind: 'close'; roomId: string; label: string };

/**
 * The server's console, served by the server process at /admin.
 *
 * Covers two graded requirements:
 *   - "The server program must display: (1) the number of concurrent clients
 *      currently connected (2) a list of those connected clients."
 *   - "The server has a reset button to reset the game and players' scores."
 *
 * The same information is also printed to the server's stdout. Only the
 * server machine itself, an admin account, or the server's ADMIN_TOKEN (when
 * set) is let in.
 */
export function AdminConsole() {
  const admin = useAdmin();
  const { state, connected, locked, lines, view } = admin;
  const [pending, setPending] = useState<PendingAction | null>(null);

  if (locked) return <LockedConsole />;

  const rooms = state?.rooms ?? [];
  const playing = rooms.filter((r) => r.status === 'playing').length;
  const watchingId = view?.state.roomId ?? null;

  function confirmPending(note: RemovalNote): Promise<ModerationResult> {
    if (!pending) return Promise.resolve({ ok: false, error: 'Nothing to confirm.' });
    if (pending.kind === 'close') return admin.closeRoom(pending.roomId, note);
    return pending.kind === 'ban' ? admin.ban(pending.clientId, note) : admin.kick(pending.clientId, note);
  }

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

        <TerminalPanel lines={lines} />

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
                  <span className="client-actions">
                    <span className="tag">{client.isGuest ? 'guest' : 'account'}</span>
                    <span className="tag">{client.roomId ?? 'lobby'}</span>
                    <span className={`tag ${client.seat}`}>{client.seat}</span>
                    <button
                      className="ghost small"
                      disabled={!connected}
                      onClick={() =>
                        setPending({ kind: 'kick', clientId: client.id, label: client.nickname })
                      }
                    >
                      Kick
                    </button>
                    <button
                      className="danger small"
                      disabled={!connected}
                      onClick={() =>
                        setPending({ kind: 'ban', clientId: client.id, label: client.nickname })
                      }
                    >
                      Ban
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No clients connected.</p>
          )}
        </div>

        <ReportsPanel
          reports={admin.reports}
          connected={connected}
          liveClientIds={new Set(state?.clients.map((client) => client.id) ?? [])}
          onStatus={admin.setReportStatus}
          onKick={(clientId, nickname) => setPending({ kind: 'kick', clientId, label: nickname })}
          onBan={(clientId, nickname) => setPending({ kind: 'ban', clientId, label: nickname })}
        />

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
                  <span className="client-actions">
                    <span className={`tag status-${room.status}`}>{room.status}</span>
                    <button
                      className="ghost small"
                      disabled={!connected}
                      onClick={() => admin.watch(watchingId === room.id ? null : room.id)}
                    >
                      {watchingId === room.id ? 'Watching' : 'Watch'}
                    </button>
                    <button
                      className="danger small"
                      disabled={!connected}
                      onClick={() => admin.reset(room.id)}
                    >
                      Reset
                    </button>
                    <button
                      className="danger small"
                      disabled={!connected}
                      onClick={() =>
                        setPending({ kind: 'close', roomId: room.id, label: `${room.id} “${room.name}”` })
                      }
                    >
                      End game
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No rooms open.</p>
          )}
        </div>

        {view && (
          <GameViewer
            view={view}
            onStop={() => admin.watch(null)}
            onToggleMines={admin.setMinesVisible}
            onEndGame={(roomId, roomName) =>
              setPending({ kind: 'close', roomId, label: `${roomId} “${roomName}”` })
            }
          />
        )}

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
          <h3>Controls</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Reset clears the board, ends the current match and sets every score — including
            cumulative totals — back to zero. Reset all applies that to every open room.
          </p>
          <button className="danger" disabled={!connected} onClick={() => admin.reset()}>
            Reset all games &amp; scores
          </button>
          <ClearWorldChat connected={connected} onClear={admin.clearChat} />
        </div>
      </div>

      {pending && (
        <ReasonDialog
          title={
            pending.kind === 'close'
              ? `End the game in ${pending.label}?`
              : `${pending.kind === 'ban' ? 'Ban' : 'Kick'} ${pending.label}?`
          }
          consequence={
            pending.kind === 'close'
              ? 'Everyone inside goes back to the menu and the room is closed.'
              : pending.kind === 'ban'
                ? 'They are disconnected and shown the ban page. They can log in again.'
                : 'They leave their room and go back to the menu. They stay connected.'
          }
          confirmLabel={pending.kind === 'close' ? 'End game' : pending.kind === 'ban' ? 'Ban' : 'Kick'}
          onConfirm={confirmPending}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}

/**
 * Empties the lobby's world chat for everyone. It cannot be undone — the chat
 * lives only in server memory — so the button first asks, right where it is,
 * instead of in a browser popup.
 */
function ClearWorldChat({ connected, onClear }: { connected: boolean; onClear: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);

  // Focus follows the question: onto its answer when it opens, back to the
  // button when it closes, so a keyboard user is never dropped at the page top.
  useEffect(() => {
    if (confirming) {
      asked.current = true;
      confirmRef.current?.focus();
    } else if (asked.current) {
      asked.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming]);

  // "Cleared." says so for a moment, then goes.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 3000);
    return () => clearTimeout(timer);
  }, [done]);

  return (
    <div className="clear-chat">
      <p className="muted">
        World chat keeps its last lines in server memory only. Clearing it empties the lobby chat
        for everyone.
      </p>
      {confirming ? (
        <div
          className="clear-chat-confirm"
          role="group"
          aria-label="Clear the world chat?"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setConfirming(false);
          }}
        >
          <span>Clear the world chat for everyone?</span>
          <button
            ref={confirmRef}
            className="danger"
            disabled={!connected}
            onClick={() => {
              onClear();
              setConfirming(false);
              setDone(true);
            }}
          >
            Clear it
          </button>
          <button className="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          ref={triggerRef}
          className="ghost"
          disabled={!connected}
          onClick={() => setConfirming(true)}
        >
          Clear world chat
        </button>
      )}
      <span className="clear-chat-note" role="status">
        {done ? 'World chat cleared.' : ''}
      </span>
    </div>
  );
}

/** Shown when the server refused this browser. */
function LockedConsole() {
  return (
    <div className="app admin">
      <div className="center-screen">
        <div className="card join-card">
          <h2>Admin only</h2>
          <p>
            The server console opens on the server machine itself, or for an account listed as an
            admin. Sign in with an admin account on the game page, then come back — or, if the
            server sets an admin token, open this page as <code>/admin?token=…</code>.
          </p>
          <a className="button-link" href="/">
            Go to the game
          </a>
        </div>
      </div>
    </div>
  );
}
