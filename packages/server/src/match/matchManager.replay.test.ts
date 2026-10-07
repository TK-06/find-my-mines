import { CLASSIC_PRESET, REPLAY_MAX_SEATS, parseReplay, type Identity, type Replay } from '@fmm/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchManager, type MatchBroadcaster } from './matchManager.js';

/** A broadcaster that remembers what the room was told about the end of a match. */
function recorder() {
  const log = {
    events: [] as string[],
    /** undefined until the room is told; then the replay it was handed (null if none). */
    ended: undefined as Replay | null | undefined,
    forfeited: undefined as Replay | null | undefined,
  };
  const out: MatchBroadcaster = {
    matchStart: () => log.events.push('start'),
    cellRevealed: () => log.events.push('cell'),
    turnChanged: () => {},
    turnTick: () => {},
    matchEnded: (_state, replay) => {
      log.events.push('ended');
      log.ended = replay;
    },
    matchReset: () => {},
    stateSync: () => {},
    matchForfeited: (_notice, _result, replay) => {
      log.events.push('forfeit');
      log.forfeited = replay;
    },
    notice: () => {},
    error: () => {},
    changed: () => {},
  };
  return { log, out };
}

const guest = (nickname: string): Identity => ({ profileId: null, nickname, elo: 800, gamesPlayed: 0, isGuest: true });

let room: MatchManager | null = null;

afterEach(() => {
  room?.shutdown();
  room = null;
});

/** The mines as cell indices, read the way only a test (or the admin console) may. */
function mineCells(r: MatchManager): number[] {
  const cols = r.config.cols;
  return r.minePositions()!.map((m) => m.row * cols + m.col);
}

/** Opens safe cells, one per turn, until `id` is the player on turn. */
function passTurnTo(r: MatchManager, id: string): void {
  const mines = new Set(mineCells(r));
  const cols = r.config.cols;
  for (let cell = 0; cell < r.config.rows * cols && r.publicState().currentPlayerId !== id; cell++) {
    if (mines.has(cell) || r.publicState().revealed.some((c) => c.row * cols + c.col === cell)) continue;
    r.reveal(r.publicState().currentPlayerId!, Math.floor(cell / cols), cell % cols);
  }
}

/** The player on turn finds every remaining mine, which ends the match. */
function findAllMines(r: MatchManager): void {
  const cols = r.config.cols;
  const player = r.publicState().currentPlayerId!;
  for (const cell of mineCells(r)) {
    if (r.publicState().status !== 'playing') break;
    if (r.publicState().revealed.some((c) => c.row * cols + c.col === cell)) continue;
    r.reveal(player, Math.floor(cell / cols), cell % cols);
  }
}

describe('the replay of a finished match', () => {
  it('comes with the end of the match: the mines, the seats and every cell in the order opened', () => {
    const { log, out } = recorder();
    room = new MatchManager('R1', 'Replay', { ...CLASSIC_PRESET }, 'created', out);
    room.addPlayer('a', guest('Ann'));
    room.addPlayer('b', guest('Ben'));
    room.start('a');

    const first = room.publicState().currentPlayerId!;
    passTurnTo(room, first === 'a' ? 'b' : 'a');
    const second = room.publicState().currentPlayerId!;
    findAllMines(room);

    const state = room.publicState();
    expect(state.status).toBe('ended');
    const replay = log.ended!;
    expect(replay).not.toBeNull();
    expect(parseReplay(replay)).toEqual(replay);

    expect(replay.rows).toBe(6);
    expect(replay.cols).toBe(6);
    expect(replay.mineCount).toBe(11);
    expect(replay.mines).toEqual(mineCells(room).sort((x, y) => x - y));
    expect(replay.seats).toEqual([
      { name: 'Ann', bot: false },
      { name: 'Ben', bot: false },
    ]);

    // Same cells, same order as the room's own reveal history, mapped to seats.
    expect(replay.moves.map((m) => m.i)).toEqual(state.revealed.map((c) => c.row * 6 + c.col));
    const seatOf = (id: string) => (id === 'a' ? 0 : 1);
    expect(replay.moves.map((m) => m.s)).toEqual(state.revealed.map((c) => seatOf(c.byPlayerId)));
    expect(replay.moves[0]!.s).toBe(seatOf(first));
    expect(replay.moves.at(-1)!.s).toBe(seatOf(second));
  });

  it('is never handed over while the match is still being played', () => {
    const { log, out } = recorder();
    room = new MatchManager('R1', 'Replay', { ...CLASSIC_PRESET }, 'created', out);
    room.addPlayer('a', guest('Ann'));
    room.addPlayer('b', guest('Ben'));
    room.start('a');

    // Open the first mine only: the match is far from over.
    const cols = 6;
    const [mine] = mineCells(room);
    room.reveal(room.publicState().currentPlayerId!, Math.floor(mine! / cols), mine! % cols);

    expect(room.publicState().status).toBe('playing');
    expect(log.ended).toBeUndefined();
    expect(log.forfeited).toBeUndefined();
    expect(log.events).not.toContain('ended');
    // And the public state never carries the mines, as ever.
    const wire = JSON.stringify(room.publicState());
    expect(wire).not.toContain('"bombs"');
    expect(wire).not.toContain('"mines"');
  });

  it('marks a computer opponent’s seat', () => {
    const { log, out } = recorder();
    room = new MatchManager('R1', 'Replay', { ...CLASSIC_PRESET, maxPlayers: 2 }, 'ai', out);
    room.addPlayer('a', guest('Ann'));
    room.addBot('bot', { level: 'hard', model: 'ai' });
    room.start('a');
    passTurnTo(room, room.publicState().currentPlayerId === 'a' ? 'bot' : 'a');
    findAllMines(room);

    expect(log.ended!.seats).toEqual([
      { name: 'Ann', bot: false },
      { name: 'AI · Hard', bot: true },
    ]);
  });

  it('is built for a forfeit too, as long as the match lasted', () => {
    const { log, out } = recorder();
    room = new MatchManager('R1', 'Replay', { ...CLASSIC_PRESET }, 'created', out);
    room.addPlayer('a', guest('Ann'));
    room.addPlayer('b', guest('Ben'));
    room.start('a');

    const mover = room.publicState().currentPlayerId!;
    const cols = 6;
    const [mine] = mineCells(room);
    room.reveal(mover, Math.floor(mine! / cols), mine! % cols);
    // The other player walks out: the one who stayed wins by forfeit.
    room.remove(mover === 'a' ? 'b' : 'a');

    expect(log.events.at(-1)).toBe('forfeit');
    const replay = log.forfeited!;
    expect(replay).not.toBeNull();
    expect(parseReplay(replay)).toEqual(replay);
    expect(replay.moves).toEqual([{ i: mine, s: mover === 'a' ? 0 : 1 }]);
    // The leaver's seat is still in the record.
    expect(replay.seats.map((s) => s.name)).toEqual(['Ann', 'Ben']);
    expect(replay.mines).toHaveLength(11);
  });

  it('keeps a seat’s moves with the seat after its player reconnects under a new id', () => {
    const { log, out } = recorder();
    room = new MatchManager('R1', 'Replay', { ...CLASSIC_PRESET }, 'created', out);
    room.addPlayer('a', guest('Ann'));
    room.addPlayer('b', guest('Ben'));
    room.start('a');

    passTurnTo(room, 'a'); // whoever moves first, it ends up Ann's turn with Ben having moved or not
    const cols = 6;
    const mines = mineCells(room);
    room.reveal('a', Math.floor(mines[0]! / cols), mines[0]! % cols);
    room.rebind('a', 'a2');
    findAllMines(room);

    const replay = log.ended!;
    // Ann's first mine and everything after it are hers, though her id changed in between.
    expect(replay.moves.filter((m) => m.s === 0).length).toBeGreaterThan(0);
    expect(replay.moves.find((m) => m.i === mines[0])!.s).toBe(0);
    expect(replay.moves.at(-1)!.s).toBe(0);
  });

  it('keeps the moves of a seat that left a free-for-all before the end', () => {
    const { log, out } = recorder();
    room = new MatchManager('R1', 'Replay', { ...CLASSIC_PRESET, maxPlayers: null }, 'created', out);
    room.addPlayer('a', guest('Ann'));
    room.addPlayer('b', guest('Ben'));
    room.addPlayer('c', guest('Cy'));
    room.start('a');

    passTurnTo(room, 'c');
    const cols = 6;
    const safe = (() => {
      const mines = new Set(mineCells(room!));
      for (let cell = 0; cell < 36; cell++) {
        if (!mines.has(cell) && !room!.publicState().revealed.some((c) => c.row * cols + c.col === cell)) return cell;
      }
      throw new Error('no safe cell');
    })();
    // Cy opens a cell and passes the turn, then walks out; the match goes on without them.
    room.reveal('c', Math.floor(safe / cols), safe % cols);
    room.remove('c');
    expect(room.publicState().status).toBe('playing');
    findAllMines(room);

    const replay = log.ended!;
    expect(replay.seats.map((s) => s.name)).toEqual(['Ann', 'Ben', 'Cy']);
    expect(replay.moves.find((m) => m.i === safe)!.s).toBe(2);
  });

  it('is built for an unlimited room however many people are seated', () => {
    const { log, out } = recorder();
    room = new MatchManager('R1', 'Crowd', { ...CLASSIC_PRESET, maxPlayers: null }, 'created', out);
    // More than any fixed room allows (12): an unlimited room has no ceiling.
    for (let n = 1; n <= 15; n++) room.addPlayer(`p${n}`, guest(`Player${n}`));
    room.start('p1');
    findAllMines(room);

    expect(room.publicState().status).toBe('ended');
    const replay = log.ended;
    expect(replay).not.toBeNull();
    expect(replay!.seats).toHaveLength(15);
    expect(parseReplay(replay)).toEqual(replay);
  });

  it('says so, rather than staying silent, when a replay cannot be built', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { log, out } = recorder();
    room = new MatchManager('R1', 'Crowd', { ...CLASSIC_PRESET, maxPlayers: null }, 'created', out);
    // Past what a replay can describe.
    for (let n = 1; n <= REPLAY_MAX_SEATS + 1; n++) room.addPlayer(`p${n}`, guest(`Player${n}`));
    room.start('p1');
    findAllMines(room);

    expect(log.ended).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('R1'));
    warn.mockRestore();
  });
});
