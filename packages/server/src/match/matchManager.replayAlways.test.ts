import { CLASSIC_PRESET, createRng, parseReplay, type Identity, type RoomConfig } from '@fmm/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { MatchManager, type MatchBroadcaster } from './matchManager.js';

/**
 * A match that finishes must come with a replay that holds together, whatever
 * went on around it: a result with no replay is saved, and listed, as a game
 * that cannot be reviewed. So this plays many seeded rooms at random — people
 * joining, leaving, dropping and coming back under a new connection, spectators
 * taking seats, rematches, boards of every shape — and checks every ending.
 */

const guest = (nickname: string): Identity => ({ profileId: null, nickname, elo: 800, gamesPlayed: 0, isGuest: true });

let room: MatchManager | null = null;
afterEach(() => {
  room?.shutdown();
  room = null;
});

describe('the replay of every finished match', () => {
  it('is there, valid, and has each move under the seat of whoever made it', () => {
    const problems: string[] = [];
    let ended = 0;
    let forfeited = 0;

    for (let seed = 1; seed <= 250; seed++) {
      const rng = createRng(seed);
      const pick = (n: number) => Math.floor(rng() * n);
      const rows = 4 + pick(4);
      const cols = 4 + pick(4);
      const config: RoomConfig = {
        ...CLASSIC_PRESET,
        rows,
        cols,
        mineCount: 1 + pick(rows * cols - 2),
        maxPlayers: pick(2) ? null : 2 + pick(5),
        mode: pick(2) ? 'ranked' : 'casual',
      };

      // Who each connection is, by the id it has now. A reconnect moves the name to the new id.
      const nameOf = new Map<string, string>();
      const connections: string[] = [];
      let made = 0;
      const join = (): void => {
        const id = `c${seed}-${made++}`;
        connections.push(id);
        nameOf.set(id, `N${made}`);
        const identity = guest(`N${made}`);
        if (pick(4) === 0) room!.addSpectator(id, identity);
        else room!.addPlayer(id, identity);
      };

      const out: MatchBroadcaster = {
        matchStart: () => {},
        cellRevealed: () => {},
        turnChanged: () => {},
        turnTick: () => {},
        matchEnded: (state, replay) => {
          ended++;
          const result = room!.takeResult();
          if (!replay || !result) {
            problems.push(`seed ${seed}: match ended with replay ${replay ? 'yes' : 'NO'}, result ${result ? 'yes' : 'NO'}`);
            return;
          }
          if (!parseReplay(replay)) problems.push(`seed ${seed}: the replay does not parse`);
          const names = state.revealed.map((cell) => nameOf.get(cell.byPlayerId));
          if (replay.moves.map((m) => replay.seats[m.s]?.name).join() !== names.join()) {
            problems.push(`seed ${seed}: a move is under the wrong seat`);
          }
        },
        matchReset: () => {},
        stateSync: () => {},
        matchForfeited: (_notice, result, replay) => {
          forfeited++;
          if (!replay || !result) {
            problems.push(`seed ${seed}: forfeit with replay ${replay ? 'yes' : 'NO'}, result ${result ? 'yes' : 'NO'}`);
          }
        },
        notice: () => {},
        error: () => {},
        changed: () => {},
      };
      room = new MatchManager(`R${seed}`, 'Random', config, 'created', out);

      for (let n = 2 + pick(3); n > 0; n--) join();
      for (let step = 0; step < 300; step++) {
        const state = room.publicState();
        const op = pick(20);
        const someone = connections[pick(connections.length)];
        if (op < 2) join();
        else if (op < 4 && state.status !== 'playing') room.start(state.hostId ?? connections[0]!);
        else if (op < 5 && someone) {
          room.remove(someone);
          connections.splice(connections.indexOf(someone), 1);
        } else if (op < 7 && someone) {
          // Their connection drops; half the time they come back as a new one.
          room.markDisconnected(someone);
          const back = `c${seed}-${made++}`;
          if (pick(2) === 0 && room.rebind(someone, back)) {
            connections[connections.indexOf(someone)] = back;
            nameOf.set(back, nameOf.get(someone)!);
          }
        } else if (op < 9 && state.status === 'ended') {
          for (const player of state.players) room.voteRematch(player.id);
        } else if (state.status === 'playing' && state.currentPlayerId) {
          room.reveal(state.currentPlayerId, pick(rows), pick(cols));
        }
      }
      room.shutdown();
    }

    expect(problems.slice(0, 10)).toEqual([]);
    // Not vacuous: both kinds of ending came up.
    expect(ended).toBeGreaterThan(50);
    expect(forfeited).toBeGreaterThan(50);
  });
});
