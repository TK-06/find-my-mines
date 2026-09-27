import type { OnlinePlayer, RoomSummary } from '@fmm/shared';
import { presenceLabel } from '../data/format.js';

interface Props {
  online: OnlinePlayer[];
  myId: string | null;
  /** Open rooms, to offer joining the game someone is in. */
  rooms: RoomSummary[];
  /** Same action as the game list's Join — an ask-to-join room opens the request. */
  onJoin: (roomId: string) => void;
}

/**
 * Who else is connected, and where they are.
 *
 * Spec: "When a client is on the network, a client would connect to the
 * server first. Then, the server will provide information about the other
 * connected client." The server pushes this list on every change.
 */
export function OnlinePanel({ online, myId, rooms, onJoin }: Props) {
  // Yourself first, then everyone else in the order they connected.
  const ordered = [...online].sort((a, b) => Number(b.id === myId) - Number(a.id === myId));
  const roomsById = new Map(rooms.map((room) => [room.id, room]));

  return (
    <aside className="card online-panel">
      <div className="lobby-head" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Online now</h3>
        <span className="tag">{online.length}</span>
      </div>

      {ordered.length <= 1 ? (
        <p className="muted" style={{ margin: 0 }}>
          Just you so far. Anyone who connects shows up here.
        </p>
      ) : null}

      <ul className="list online-list">
        {ordered.map((player) => {
          const room = player.roomId ? roomsById.get(player.roomId) : undefined;
          const canJoin = player.id !== myId && room !== undefined && room.joinable;

          return (
            <li key={player.id}>
              <span className="online-who">
                <span className={`presence-dot ${player.status}`} aria-hidden />
                <strong>{player.nickname}</strong>
                {player.id === myId && <span className="tag me">you</span>}
                {player.isGuest && <span className="tag">guest</span>}
              </span>
              <span className="online-where">
                <span className="muted">{presenceLabel(player)}</span>
                {canJoin && (
                  <button className="ghost small" onClick={() => onJoin(room.id)}>
                    {room.config.joinByRequest ? 'Ask' : 'Join'}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
