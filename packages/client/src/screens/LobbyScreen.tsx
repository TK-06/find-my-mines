import {
  CLASSIC_PRESET,
  MAX_GRID,
  MAX_PLAYERS_LIMIT,
  MIN_GRID,
  MIN_PLAYERS_TO_START,
  isClassicConfig,
  parseRoomCode,
  validateRoomConfig,
  type RoomConfig,
  type RoomMode,
  type RoomSummary,
} from '@fmm/shared';
import { useMemo, useState } from 'react';

interface Props {
  rooms: RoomSummary[];
  clientCount: number;
  onCreate: (name: string, config: RoomConfig) => void;
  onJoin: (roomId: string) => void;
  onSpectate: (roomId: string) => void;
}

const CLASSIC: RoomConfig = { ...CLASSIC_PRESET };

export function LobbyScreen({ rooms, clientCount, onCreate, onJoin, onSpectate }: Props) {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="stack">
      <div className="lobby-head">
        <div>
          <h2 className="section-title">Games</h2>
          <p className="muted">
            {rooms.length} open · {clientCount} player{clientCount === 1 ? '' : 's'} online
          </p>
        </div>
        <button onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Cancel' : '+ Create game'}
        </button>
      </div>

      <JoinByCode onJoin={onJoin} onSpectate={onSpectate} />

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
  const ask = room.config.joinByRequest === true;

  return (
    <li className="room-row card">
      <div className="room-main">
        <div className="room-title">
          <span className="room-code">{room.id}</span>
          <strong>{room.name}</strong>
          <span className={`tag mode-${room.config.mode}`}>{room.config.mode}</span>
          <span className={`tag status-${room.status}`}>{room.status}</span>
          {ask && <span className="tag ask">ask to join</span>}
        </div>
        <div className="muted room-meta">
          Host {room.hostNickname} · {room.config.rows}×{room.config.cols} ·{' '}
          {room.config.mineCount} mines · {room.playerCount}/{limit} players
          {room.spectatorCount > 0 && ` · ${room.spectatorCount} watching`}
        </div>
      </div>

      <div className="room-actions">
        <button onClick={() => onJoin(room.id)} disabled={!room.joinable}>
          {!room.joinable ? 'Full' : ask ? 'Ask to join' : playing ? 'Join next' : 'Join'}
        </button>
        <button className="ghost" onClick={() => onSpectate(room.id)}>
          Spectate
        </button>
      </div>
    </li>
  );
}

/**
 * A room someone told you about: private rooms are not in the list, and a
 * code read out loud is quicker than finding the row. Takes a pasted share
 * link too. Joining goes the same way as the list's Join button.
 */
function JoinByCode({
  onJoin,
  onSpectate,
}: {
  onJoin: (roomId: string) => void;
  onSpectate: (roomId: string) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const empty = text.trim() === '';

  const submit = (watch: boolean) => {
    const code = parseRoomCode(text);
    if (!code) {
      setError('Room codes are 4 letters or numbers, like K7QX.');
      return;
    }
    setError(null);
    setText(code);
    if (watch) onSpectate(code);
    else onJoin(code);
  };

  return (
    <form
      className="join-code"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <label className="field-label" htmlFor="join-code">
        Join by code
      </label>
      <div className="join-code-row">
        <input
          id="join-code"
          type="text"
          value={text}
          placeholder="ABCD"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'join-code-error' : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        <button type="submit" disabled={empty}>
          Join
        </button>
        <button type="button" className="ghost" disabled={empty} onClick={() => submit(true)}>
          Watch
        </button>
      </div>
      {error && (
        <p id="join-code-error" className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
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
  // Custom rooms showcase the host approving players; Classic stays open.
  const [askToJoin, setAskToJoin] = useState(true);
  // Listed unless the host says otherwise; a private room is found by its code.
  const [isPrivate, setIsPrivate] = useState(false);

  const board =
    preset === 'classic'
      ? { rows: CLASSIC.rows, cols: CLASSIC.cols, mineCount: CLASSIC.mineCount, maxPlayers: CLASSIC.maxPlayers }
      : { rows, cols, mineCount, maxPlayers: unlimited ? null : maxPlayers };

  // Mode is independent of the board preset — you can play Classic ranked.
  const config: RoomConfig = {
    ...board,
    mode,
    joinByRequest: preset === 'custom' && askToJoin,
    private: preset === 'custom' && isPrivate,
  };

  // A Custom board with Classic's numbers is Classic, and the server keeps
  // Classic open and listed whatever the form sends. Say so before creating,
  // rather than let someone believe a listed room is private.
  const classicOverrides =
    preset === 'custom' && (askToJoin || isPrivate) && isClassicConfig(board);

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
            ? `${CLASSIC.rows}×${CLASSIC.cols}, ${CLASSIC.mineCount} mines, ${CLASSIC.maxPlayers} players — the original assignment rules: anyone can join`
            : 'Pick your own board and player limit'}
        </span>
      </div>

      {preset === 'custom' && (
        <label className="checkbox" style={{ marginTop: 0 }}>
          <input
            type="checkbox"
            checked={askToJoin}
            onChange={(e) => setAskToJoin(e.target.checked)}
          />
          Players ask to join — you approve each one
        </label>
      )}

      {preset === 'custom' && (
        <label className="checkbox" style={{ marginTop: 0 }}>
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
          />
          Private room — only people with the link or code can join
        </label>
      )}

      {classicOverrides && (
        <p className="muted classic-note" role="status">
          {CLASSIC.rows}×{CLASSIC.cols} with {CLASSIC.mineCount} mines and {CLASSIC.maxPlayers} players
          is the Classic board, which keeps the original rules: it is listed and anyone can join
          directly. Change the board or the player limit to use the options above.
        </p>
      )}

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
