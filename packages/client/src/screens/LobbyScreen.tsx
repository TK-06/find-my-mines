import {
  CLASSIC_PRESET,
  MAX_GRID,
  MAX_PLAYERS_LIMIT,
  MIN_GRID,
  MIN_PLAYERS_TO_START,
  validateRoomConfig,
  type OnlinePlayer,
  type RoomConfig,
  type RoomMode,
  type RoomSummary,
} from '@fmm/shared';
import { useMemo, useState } from 'react';

interface Props {
  rooms: RoomSummary[];
  clientCount: number;
  online: OnlinePlayer[];
  myId: string | null;
  onCreate: (name: string, config: RoomConfig) => void;
  onJoin: (roomId: string) => void;
  onSpectate: (roomId: string) => void;
}

const CLASSIC: RoomConfig = { ...CLASSIC_PRESET };

export function LobbyScreen({
  rooms,
  online,
  myId,
  onCreate,
  onJoin,
  onSpectate,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="lobby-grid">
    <div className="stack">
      <div className="lobby-head">
        <div>
          <h2 className="section-title">Games</h2>
          <p className="muted">{rooms.length} open</p>
        </div>
        <button onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Cancel' : '+ Create game'}
        </button>
      </div>

      {showCreate && (
        <CreateGameForm
          onCreate={(name, config) => {
            onCreate(name, config);
            setShowCreate(false);
          }}
        />
      )}

      {rooms.length === 0 ? (
        <div className="card empty-state">
          <p style={{ margin: 0 }}>No games yet.</p>
          <p className="muted" style={{ marginBottom: 0 }}>
            Create one — Classic is 6×6 with 11 mines for 2 players.
          </p>
        </div>
      ) : (
        <ul className="room-list">
          {rooms.map((room) => (
            <RoomRow key={room.id} room={room} onJoin={onJoin} onSpectate={onSpectate} />
          ))}
        </ul>
      )}
    </div>

    <OnlinePanel online={online} rooms={rooms} myId={myId} />
    </div>
  );
}

/**
 * Everyone connected right now and where they are.
 *
 * Spec: "the server will provide information about the other connected
 * client. This allows each client to know which users are currently
 * connected to the same network."
 */
function OnlinePanel({
  online,
  rooms,
  myId,
}: {
  online: OnlinePlayer[];
  rooms: RoomSummary[];
  myId: string | null;
}) {
  const statusOf = (player: OnlinePlayer) => {
    if (!player.roomId) return 'in lobby';
    if (player.seat === 'spectator') return `watching ${player.roomId}`;
    const room = rooms.find((r) => r.id === player.roomId);
    return room?.status === 'playing' ? `playing ${player.roomId}` : `in room ${player.roomId}`;
  };

  return (
    <aside className="card online-panel" aria-label="Players online">
      <div className="online-head">
        <span className="online-count">{online.length}</span>
        <span className="muted">online now</span>
      </div>

      {online.length === 0 ? (
        <p className="muted">Nobody else yet.</p>
      ) : (
        <ul className="list online-list">
          {online.map((player) => (
            <li key={player.id}>
              <span className="who">
                <span className="online-dot" aria-hidden="true" />
                {player.nickname}
                {player.id === myId && <span className="tag me">you</span>}
              </span>
              <span className="muted">{statusOf(player)}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function RoomRow({
  room,
  onJoin,
  onSpectate,
}: {
  room: RoomSummary;
  onJoin: (id: string) => void;
  onSpectate: (id: string) => void;
}) {
  const limit = room.config.maxPlayers ?? '∞';
  const playing = room.status === 'playing';

  return (
    <li className="room-row card">
      <div className="room-main">
        <div className="room-title">
          <span className="room-code">{room.id}</span>
          <strong>{room.name}</strong>
          <span className={`tag mode-${room.config.mode}`}>{room.config.mode}</span>
          <span className={`tag status-${room.status}`}>{room.status}</span>
        </div>
        <div className="muted room-meta">
          Host {room.hostNickname} · {room.config.rows}×{room.config.cols} ·{' '}
          {room.config.mineCount} mines · {room.playerCount}/{limit} players
          {room.spectatorCount > 0 && ` · ${room.spectatorCount} watching`}
        </div>
      </div>

      <div className="room-actions">
        <button onClick={() => onJoin(room.id)} disabled={!room.joinable}>
          {!room.joinable ? 'Full' : playing ? 'Join next' : 'Join'}
        </button>
        <button className="ghost" onClick={() => onSpectate(room.id)}>
          Spectate
        </button>
      </div>
    </li>
  );
}

function CreateGameForm({ onCreate }: { onCreate: (name: string, config: RoomConfig) => void }) {
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<'classic' | 'custom'>('classic');
  const [rows, setRows] = useState(CLASSIC.rows);
  const [cols, setCols] = useState(CLASSIC.cols);
  const [mineCount, setMineCount] = useState(CLASSIC.mineCount);
  const [unlimited, setUnlimited] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(CLASSIC.maxPlayers ?? 2);
  const [mode, setMode] = useState<RoomMode>('casual');

  const board =
    preset === 'classic'
      ? { rows: CLASSIC.rows, cols: CLASSIC.cols, mineCount: CLASSIC.mineCount, maxPlayers: CLASSIC.maxPlayers }
      : { rows, cols, mineCount, maxPlayers: unlimited ? null : maxPlayers };

  // Mode is independent of the board preset — you can play Classic ranked.
  const config: RoomConfig = { ...board, mode };

  // Same validator the server runs, so the message matches what it would say.
  const errors = useMemo(() => validateRoomConfig(config), [config]);

  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (errors.length === 0) onCreate(name, config);
      }}
    >
      <div>
        <label className="field-label" htmlFor="room-name">
          Game name
        </label>
        <input
          id="room-name"
          type="text"
          value={name}
          maxLength={32}
          placeholder="My game"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="preset-row">
        <button
          type="button"
          className={preset === 'classic' ? '' : 'ghost'}
          onClick={() => setPreset('classic')}
        >
          Classic
        </button>
        <button
          type="button"
          className={preset === 'custom' ? '' : 'ghost'}
          onClick={() => setPreset('custom')}
        >
          Custom
        </button>
        <span className="muted">
          {preset === 'classic'
            ? `${CLASSIC.rows}×${CLASSIC.cols}, ${CLASSIC.mineCount} mines, ${CLASSIC.maxPlayers} players — the assignment spec`
            : 'Pick your own board and player limit'}
        </span>
      </div>

      {preset === 'custom' && (
        <div className="field-grid">
          <NumberField label="Rows" value={rows} min={MIN_GRID} max={MAX_GRID} onChange={setRows} />
          <NumberField
            label="Columns"
            value={cols}
            min={MIN_GRID}
            max={MAX_GRID}
            onChange={setCols}
          />
          <NumberField
            label="Mines"
            value={mineCount}
            min={1}
            max={rows * cols - 1}
            onChange={setMineCount}
          />
          <div>
            <label className="field-label" htmlFor="max-players">
              Players
            </label>
            <input
              id="max-players"
              type="number"
              value={unlimited ? '' : maxPlayers}
              disabled={unlimited}
              min={MIN_PLAYERS_TO_START}
              max={MAX_PLAYERS_LIMIT}
              onChange={(e) => setMaxPlayers(Number(e.target.value))}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={unlimited}
                onChange={(e) => setUnlimited(e.target.checked)}
              />
              No limit
            </label>
          </div>
        </div>
      )}

      <div className="preset-row">
        <button
          type="button"
          className={mode === 'casual' ? '' : 'ghost'}
          onClick={() => setMode('casual')}
        >
          Casual
        </button>
        <button
          type="button"
          className={mode === 'ranked' ? '' : 'ghost'}
          onClick={() => setMode('ranked')}
        >
          Ranked
        </button>
        <span className="muted">
          {mode === 'casual'
            ? 'Recorded, but nobody’s rating changes'
            : 'Elo moves for signed-in players; guests count as an 800 opponent'}
        </span>
      </div>

      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      <button type="submit" disabled={errors.length > 0}>
        Create game
      </button>
    </form>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label className="field-label" htmlFor={`field-${label}`}>
        {label}
      </label>
      <input
        id={`field-${label}`}
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
