import type { ForfeitNotice, PlayerPublic, PublicMatchState, RevealedCell } from '@fmm/shared';
import { describe, expect, it } from 'vitest';
import {
  FRESH_MEMORY,
  forfeitSoundEvents,
  matchSoundEvents,
  puzzleSoundEvents,
  stepSounds,
  type SoundEvent,
  type SoundMemory,
} from './soundEvents.js';

const ME = 'me';
const OPP = 'opp';
const WATCHER = 'watcher';

const player = (id: string): PlayerPublic => ({
  id,
  nickname: id,
  score: 0,
  totalScore: 0,
  connected: true,
  elo: 800,
  isGuest: true,
});

/** A two-player room in the middle of a match, my turn, ten seconds on the clock. */
function room(over: Partial<PublicMatchState> = {}): PublicMatchState {
  return {
    roomId: 'ROOM1',
    roomName: 'Test room',
    hostId: ME,
    config: { rows: 6, cols: 6, mineCount: 11, maxPlayers: 2, mode: 'casual' },
    origin: 'created',
    status: 'playing',
    rows: 6,
    cols: 6,
    bombCount: 11,
    bombsFound: 0,
    players: [player(ME), player(OPP)],
    spectatorCount: 0,
    spectators: [],
    joinRequests: [],
    currentPlayerId: ME,
    secondsLeft: 10,
    revealed: [],
    winnerId: null,
    rematchVotes: [],
    ...over,
  };
}

const cell = (row: number, col: number, kind: 'bomb' | 'empty', by: string, adjacent = 0): RevealedCell => ({
  row,
  col,
  kind,
  adjacent,
  byPlayerId: by,
});

const kinds = (events: readonly SoundEvent[]) => events.map((e) => e.kind);

/**
 * Feeds snapshots to the detector one by one, exactly as `useGameSounds` does,
 * and returns what each one played.
 */
function play(snapshots: (PublicMatchState | null)[], myId: string | null = ME, from: SoundMemory = FRESH_MEMORY) {
  let memory = from;
  return snapshots.map((snapshot) => {
    const step = stepSounds(memory, snapshot, myId);
    memory = step.memory;
    return kinds(step.events);
  });
}

describe('my turn', () => {
  it('plays when a match begins on my turn, the first turn of the match included', () => {
    const waiting = room({ status: 'waiting', currentPlayerId: null, secondsLeft: 0 });
    const started = room({ currentPlayerId: ME, secondsLeft: 0 });
    expect(kinds(matchSoundEvents(waiting, started, ME))).toEqual(['myTurn']);
  });

  it('is silent when the match begins on the opponent’s turn', () => {
    const waiting = room({ status: 'waiting', currentPlayerId: null });
    expect(matchSoundEvents(waiting, room({ currentPlayerId: OPP }), ME)).toEqual([]);
  });

  it('plays when the turn comes round to me', () => {
    const events = matchSoundEvents(room({ currentPlayerId: OPP }), room({ currentPlayerId: ME }), ME);
    expect(kinds(events)).toEqual(['myTurn']);
  });

  it('does not play again while the turn stays mine', () => {
    expect(matchSoundEvents(room(), room({ secondsLeft: 9 }), ME)).toEqual([]);
  });

  it('plays for a rematch that starts on my turn, with no blips for the board it clears', () => {
    const ended = room({
      status: 'ended',
      currentPlayerId: null,
      winnerId: ME,
      revealed: [cell(0, 0, 'bomb', ME), cell(0, 1, 'empty', OPP, 2)],
    });
    expect(kinds(matchSoundEvents(ended, room({ revealed: [] }), ME))).toEqual(['myTurn']);
  });

  it('is silent while the room is only waiting', () => {
    const waiting = room({ status: 'waiting', currentPlayerId: null });
    expect(matchSoundEvents(waiting, room({ status: 'waiting', currentPlayerId: ME }), ME)).toEqual([]);
  });
});

describe('opening a slot', () => {
  it('my empty slot plays a blip carrying its number', () => {
    const events = matchSoundEvents(room(), room({ revealed: [cell(2, 3, 'empty', ME, 5)] }), ME);
    expect(events).toEqual([{ kind: 'myEmpty', adjacent: 5 }]);
  });

  it('my empty slot, with the turn handed on in the same change, is a blip and nothing else', () => {
    const next = room({ currentPlayerId: OPP, revealed: [cell(2, 3, 'empty', ME, 1)] });
    expect(matchSoundEvents(room(), next, ME)).toEqual([{ kind: 'myEmpty', adjacent: 1 }]);
  });

  it('my mine plays the reward and keeps the turn without a new-turn chime', () => {
    const events = matchSoundEvents(room(), room({ revealed: [cell(0, 0, 'bomb', ME)], bombsFound: 1 }), ME);
    expect(kinds(events)).toEqual(['myMine']);
  });

  it('another player’s mine is its own, quieter sound', () => {
    const before = room({ currentPlayerId: OPP });
    const events = matchSoundEvents(before, room({ currentPlayerId: OPP, revealed: [cell(0, 0, 'bomb', OPP)] }), ME);
    expect(kinds(events)).toEqual(['otherMine']);
  });

  it('another player’s empty slot is the faint tick', () => {
    const before = room({ currentPlayerId: OPP });
    const events = matchSoundEvents(before, room({ currentPlayerId: OPP, revealed: [cell(1, 1, 'empty', OPP, 3)] }), ME);
    expect(kinds(events)).toEqual(['otherEmpty']);
  });

  it('another player’s empty slot that hands the turn to me plays both, tick then chime', () => {
    const before = room({ currentPlayerId: OPP });
    const next = room({ currentPlayerId: ME, revealed: [cell(1, 1, 'empty', OPP)] });
    expect(kinds(matchSoundEvents(before, next, ME))).toEqual(['otherEmpty', 'myTurn']);
  });

  it('a bot’s move sounds like anyone else’s', () => {
    const before = room({ currentPlayerId: 'bot-1' });
    const next = room({ currentPlayerId: 'bot-1', revealed: [cell(0, 0, 'bomb', 'bot-1')] });
    expect(kinds(matchSoundEvents(before, next, ME))).toEqual(['otherMine']);
  });
});

describe('one reveal that opens several slots is one move', () => {
  it('sounds by the slot that was clicked, the first', () => {
    const opened = [cell(2, 2, 'empty', ME, 0), cell(2, 3, 'empty', ME, 1), cell(3, 3, 'empty', ME, 2)];
    expect(matchSoundEvents(room(), room({ revealed: opened }), ME)).toEqual([{ kind: 'myEmpty', adjacent: 0 }]);
  });

  it('is a mine when any slot in the batch is one', () => {
    const opened = [cell(2, 2, 'empty', ME, 1), cell(2, 3, 'bomb', ME)];
    expect(kinds(matchSoundEvents(room(), room({ revealed: opened }), ME))).toEqual(['myMine']);
  });

  it('is one sound per player when two players’ moves arrive together', () => {
    const opened = [cell(0, 0, 'empty', ME, 2), cell(0, 1, 'bomb', OPP), cell(0, 2, 'empty', OPP, 1)];
    const events = matchSoundEvents(room(), room({ revealed: opened, currentPlayerId: ME }), ME);
    expect(events).toEqual([{ kind: 'myEmpty', adjacent: 2 }, { kind: 'otherMine' }]);
  });

  it('only counts the slots that are new', () => {
    const old = [cell(0, 0, 'bomb', ME), cell(0, 1, 'empty', ME, 1)];
    const before = room({ revealed: old });
    const next = room({ revealed: [...old, cell(4, 4, 'empty', ME, 7)] });
    expect(matchSoundEvents(before, next, ME)).toEqual([{ kind: 'myEmpty', adjacent: 7 }]);
  });
});

describe('a board that is not simply the next step plays no moves', () => {
  it('a reset (the board shrinks) is silent', () => {
    const before = room({ revealed: [cell(0, 0, 'bomb', ME), cell(1, 1, 'empty', OPP)] });
    expect(matchSoundEvents(before, room({ status: 'waiting', currentPlayerId: null }), ME)).toEqual([]);
  });

  it('a different board of the same room is silent', () => {
    const before = room({ revealed: [cell(0, 0, 'bomb', ME)] });
    const next = room({ revealed: [cell(5, 5, 'empty', OPP), cell(5, 4, 'bomb', OPP)] });
    expect(matchSoundEvents(before, next, ME)).toEqual([]);
  });

  it('slots appearing while the room is not playing are silent', () => {
    const waiting = room({ status: 'waiting', currentPlayerId: null });
    expect(matchSoundEvents(waiting, room({ status: 'waiting', currentPlayerId: null, revealed: [cell(0, 0, 'bomb', ME)] }), ME)).toEqual([]);
  });

  it('two different rooms are never compared', () => {
    const next = room({ roomId: 'OTHER', revealed: [cell(0, 0, 'bomb', OPP)], currentPlayerId: ME });
    expect(matchSoundEvents(room({ currentPlayerId: OPP }), next, ME)).toEqual([]);
  });
});

describe('the last three seconds of my turn', () => {
  it('ticks on 3, 2 and 1', () => {
    const events = [3, 2, 1].map((secondsLeft) => matchSoundEvents(room({ secondsLeft: secondsLeft + 1 }), room({ secondsLeft }), ME));
    expect(events).toEqual([
      [{ kind: 'tick', secondsLeft: 3 }],
      [{ kind: 'tick', secondsLeft: 2 }],
      [{ kind: 'tick', secondsLeft: 1 }],
    ]);
  });

  it('does not tick before 3, or on 0', () => {
    expect(matchSoundEvents(room({ secondsLeft: 5 }), room({ secondsLeft: 4 }), ME)).toEqual([]);
    expect(matchSoundEvents(room({ secondsLeft: 1 }), room({ secondsLeft: 0 }), ME)).toEqual([]);
  });

  it('does not tick again for the same second (a sync that repeats it)', () => {
    expect(matchSoundEvents(room({ secondsLeft: 2 }), room({ secondsLeft: 2 }), ME)).toEqual([]);
  });

  it('does not tick on the opponent’s turn', () => {
    const before = room({ currentPlayerId: OPP, secondsLeft: 4 });
    expect(matchSoundEvents(before, room({ currentPlayerId: OPP, secondsLeft: 3 }), ME)).toEqual([]);
  });

  it('does not tick for a spectator, whose turn it never is', () => {
    const before = room({ secondsLeft: 4 });
    expect(matchSoundEvents(before, room({ secondsLeft: 3 }), WATCHER)).toEqual([]);
  });
});

describe('my turn running out', () => {
  it('plays the timeout when the turn goes to the opponent with nothing opened', () => {
    const events = matchSoundEvents(room({ secondsLeft: 10 }), room({ currentPlayerId: OPP }), ME);
    expect(kinds(events)).toEqual(['timeout']);
  });

  it('is not the timeout when I opened an empty slot in that very change', () => {
    const next = room({ currentPlayerId: OPP, revealed: [cell(0, 0, 'empty', ME, 2)] });
    expect(kinds(matchSoundEvents(room(), next, ME))).not.toContain('timeout');
  });

  it('is the timeout when I found a mine and the clock then ended the turn, even all in one change', () => {
    const next = room({ currentPlayerId: OPP, revealed: [cell(0, 0, 'bomb', ME)] });
    expect(kinds(matchSoundEvents(room(), next, ME))).toEqual(['myMine', 'timeout']);
  });

  it('is silent when the turn passes between other players', () => {
    const before = room({ currentPlayerId: OPP, players: [player(ME), player(OPP), player('third')] });
    const next = room({ currentPlayerId: 'third', players: [player(ME), player(OPP), player('third')] });
    expect(matchSoundEvents(before, next, ME)).toEqual([]);
  });

  it('does not play when the match ends instead of the turn passing', () => {
    const ended = room({ status: 'ended', currentPlayerId: null, winnerId: OPP });
    expect(kinds(matchSoundEvents(room(), ended, ME))).toEqual(['lose']);
  });

  it('does not play when the room falls back to waiting (the other side left)', () => {
    const waiting = room({ status: 'waiting', currentPlayerId: null, revealed: [] });
    expect(matchSoundEvents(room(), waiting, ME)).toEqual([]);
  });
});

/**
 * The server says things in a fixed order. After an empty slot:
 *   cell:revealed (still my turn) → turn:tick 10 → turn:changed (their turn).
 * After the clock runs out there is no reveal:
 *   turn:tick 0 → turn:tick 10 → turn:changed (their turn).
 * Each message is its own snapshot, so these run the whole sequence.
 */
describe('telling a hand-over from a timeout, in the order the server sends it', () => {
  const turnStart = room({ secondsLeft: 8 });

  it('an empty slot, then the new turn in a second message, is never a timeout', () => {
    const revealed = [cell(2, 2, 'empty', ME, 4)];
    const afterReveal = room({ secondsLeft: 8, revealed });
    const tickTen = room({ secondsLeft: 10, revealed });
    const handedOver = room({ secondsLeft: 10, revealed, currentPlayerId: OPP });
    expect(play([turnStart, afterReveal, tickTen, handedOver])).toEqual([[], ['myEmpty'], [], []]);
  });

  it('the clock running out is the timeout, on the message that hands the turn over', () => {
    const three = room({ secondsLeft: 3 });
    const two = room({ secondsLeft: 2 });
    const one = room({ secondsLeft: 1 });
    const zero = room({ secondsLeft: 0 });
    const tickTen = room({ secondsLeft: 10 });
    const handedOver = room({ secondsLeft: 10, currentPlayerId: OPP });
    expect(play([turnStart, three, two, one, zero, tickTen, handedOver])).toEqual([
      [],
      ['tick'],
      ['tick'],
      ['tick'],
      [],
      [],
      ['timeout'],
    ]);
  });

  it('a mine keeps the turn, and the clock then running out is still the timeout', () => {
    const revealed = [cell(0, 0, 'bomb', ME)];
    const found = room({ secondsLeft: 6, revealed, bombsFound: 1 });
    const zero = room({ secondsLeft: 0, revealed, bombsFound: 1 });
    const tickTen = room({ secondsLeft: 10, revealed, bombsFound: 1 });
    const handedOver = room({ secondsLeft: 10, revealed, bombsFound: 1, currentPlayerId: OPP });
    expect(play([turnStart, found, zero, tickTen, handedOver])).toEqual([[], ['myMine'], [], [], ['timeout']]);
  });

  it('a mine, then an empty slot, ends in a plain hand-over', () => {
    const mine = [cell(0, 0, 'bomb', ME)];
    const both = [...mine, cell(0, 1, 'empty', ME, 2)];
    const snapshots = [
      turnStart,
      room({ revealed: mine }),
      room({ revealed: both }),
      room({ revealed: both, secondsLeft: 10 }),
      room({ revealed: both, secondsLeft: 10, currentPlayerId: OPP }),
    ];
    expect(play(snapshots)).toEqual([[], ['myMine'], ['myEmpty'], [], []]);
  });

  it('after a hand-over, a timeout on a later turn is still heard even though my last slot is an old empty one', () => {
    const revealed = [cell(2, 2, 'empty', ME, 4)];
    const snapshots = [
      turnStart,
      // I open an empty slot; the turn goes to them.
      room({ revealed }),
      room({ revealed, secondsLeft: 10, currentPlayerId: OPP }),
      // They let their clock run out, so it is mine again, with no new slot.
      room({ revealed, secondsLeft: 0, currentPlayerId: OPP }),
      room({ revealed, secondsLeft: 10, currentPlayerId: ME }),
      // Now I let mine run out.
      room({ revealed, secondsLeft: 0, currentPlayerId: ME }),
      room({ revealed, secondsLeft: 10, currentPlayerId: ME }),
      room({ revealed, secondsLeft: 10, currentPlayerId: OPP }),
    ];
    expect(play(snapshots)).toEqual([[], ['myEmpty'], [], [], ['myTurn'], [], [], ['timeout']]);
  });

  it('batching the messages together gives the same answers', () => {
    const revealed = [cell(2, 2, 'empty', ME, 4)];
    const handOver = room({ secondsLeft: 10, revealed, currentPlayerId: OPP });
    expect(play([turnStart, handOver])).toEqual([[], ['myEmpty']]);
    expect(play([turnStart, room({ secondsLeft: 10, currentPlayerId: OPP })])).toEqual([[], ['timeout']]);
  });

  it('a state sync in the middle of my turn (someone joins) changes nothing', () => {
    const revealed = [cell(2, 2, 'empty', ME, 4)];
    const snapshots = [
      turnStart,
      room({ revealed }),
      room({ revealed, spectatorCount: 1 }),
      room({ revealed, spectatorCount: 1, currentPlayerId: OPP }),
    ];
    expect(play(snapshots)).toEqual([[], ['myEmpty'], [], []]);
  });
});

describe('the end of a match', () => {
  const ended = (winnerId: string | null, over: Partial<PublicMatchState> = {}) =>
    room({ status: 'ended', currentPlayerId: null, winnerId, ...over });

  it('a win plays the fanfare', () => {
    expect(kinds(matchSoundEvents(room(), ended(ME), ME))).toEqual(['win']);
  });

  it('a loss plays the falling phrase', () => {
    expect(kinds(matchSoundEvents(room(), ended(OPP), ME))).toEqual(['lose']);
  });

  it('a draw plays the neutral two notes', () => {
    expect(kinds(matchSoundEvents(room(), ended(null), ME))).toEqual(['draw']);
  });

  it('a spectator hears the neutral one, whoever wins', () => {
    expect(kinds(matchSoundEvents(room(), ended(ME), WATCHER))).toEqual(['draw']);
    expect(kinds(matchSoundEvents(room(), ended(OPP), WATCHER))).toEqual(['draw']);
    expect(kinds(matchSoundEvents(room(), ended(null), WATCHER))).toEqual(['draw']);
  });

  it('the final slot plays its own sound first, then the result, in one change', () => {
    const final = [cell(5, 5, 'bomb', ME)];
    expect(kinds(matchSoundEvents(room(), ended(ME, { revealed: final }), ME))).toEqual(['myMine', 'win']);
  });

  it('the final slot and the result arriving as two messages still give one end sound', () => {
    const final = [cell(5, 5, 'bomb', OPP)];
    const lastReveal = room({ revealed: final, currentPlayerId: OPP });
    const result = ended(OPP, { revealed: final });
    expect(play([room({ currentPlayerId: OPP }), lastReveal, result])).toEqual([[], ['otherMine'], ['lose']]);
  });

  it('plays once: a snapshot of the finished match after it (a rematch vote) is silent', () => {
    const first = ended(ME);
    const later = ended(ME, { rematchVotes: [OPP] });
    expect(play([room(), first, later, later])).toEqual([[], ['win'], [], []]);
  });

  it('is silent when the match is abandoned back to waiting (the forfeit has its own sound)', () => {
    const waiting = room({ status: 'waiting', currentPlayerId: null, winnerId: null, revealed: [] });
    expect(matchSoundEvents(room(), waiting, ME)).toEqual([]);
  });
});

describe('spectators hear only the other-player sounds and the end', () => {
  it('through a whole stretch of play', () => {
    const revealed1 = [cell(0, 0, 'empty', OPP, 1)];
    const revealed2 = [...revealed1, cell(0, 1, 'bomb', ME)];
    const snapshots = [
      room({ currentPlayerId: OPP, secondsLeft: 6 }),
      room({ currentPlayerId: OPP, secondsLeft: 3 }),
      room({ currentPlayerId: OPP, secondsLeft: 3, revealed: revealed1 }),
      room({ currentPlayerId: ME, secondsLeft: 10, revealed: revealed1 }),
      room({ currentPlayerId: ME, secondsLeft: 2, revealed: revealed1 }),
      room({ currentPlayerId: ME, secondsLeft: 2, revealed: revealed2 }),
      room({ currentPlayerId: OPP, secondsLeft: 10, revealed: revealed2 }),
      room({ status: 'ended', currentPlayerId: null, winnerId: ME, revealed: revealed2 }),
    ];
    expect(play(snapshots, WATCHER)).toEqual([[], [], ['otherEmpty'], [], [], ['otherMine'], [], ['draw']]);
  });
});

describe('the first snapshot of a room is silent', () => {
  const inProgress = room({
    revealed: [cell(0, 0, 'bomb', OPP), cell(1, 1, 'empty', ME, 2), cell(2, 2, 'empty', OPP, 1)],
    secondsLeft: 2,
  });

  it('joining a match in progress plays nothing, my turn and a ticking clock included', () => {
    expect(play([inProgress])).toEqual([[]]);
  });

  it('spectating a match in progress plays nothing', () => {
    expect(play([inProgress], WATCHER)).toEqual([[]]);
  });

  it('joining a finished match plays no end sound', () => {
    expect(play([room({ status: 'ended', currentPlayerId: null, winnerId: ME })])).toEqual([[]]);
  });

  it('comes back silent after reconnecting, however much happened while away', () => {
    const away = room({
      currentPlayerId: ME,
      revealed: [...inProgress.revealed, cell(3, 3, 'bomb', OPP), cell(3, 4, 'bomb', OPP), cell(4, 4, 'empty', OPP, 3)],
    });
    // useGame empties the state on reconnect, then hands over the held seat's room.
    expect(play([inProgress, null, away])).toEqual([[], [], []]);
  });

  it('leaving the room and joining another is silent too', () => {
    const other = room({ roomId: 'OTHER', revealed: [cell(0, 0, 'bomb', OPP)] });
    expect(play([inProgress, null, other])).toEqual([[], [], []]);
  });

  it('moving straight from one room to another is silent', () => {
    const other = room({ roomId: 'OTHER', revealed: [cell(0, 0, 'bomb', OPP), cell(0, 1, 'bomb', OPP)] });
    expect(play([inProgress, other])).toEqual([[], []]);
  });

  it('then plays the next change as usual', () => {
    const next = room({ ...inProgress, revealed: [...inProgress.revealed, cell(4, 0, 'empty', ME, 6)] });
    expect(play([inProgress, next])).toEqual([[], ['myEmpty']]);
  });
});

describe('stepSounds', () => {
  it('plays nothing for a snapshot it has already seen (a re-render, or an effect run twice)', () => {
    const before = room();
    const after = room({ revealed: [cell(0, 0, 'bomb', ME)] });
    const seen = stepSounds(FRESH_MEMORY, before, ME).memory;
    const step = stepSounds(seen, after, ME);
    expect(kinds(step.events)).toEqual(['myMine']);
    expect(stepSounds(step.memory, after, ME).events).toEqual([]);
  });

  it('knows nobody when there is no player id yet, and forgets the room', () => {
    const step = stepSounds({ last: room(), handOverDue: true }, room(), null);
    expect(step.events).toEqual([]);
    expect(step.memory).toEqual(FRESH_MEMORY);
  });

  it('forgets everything once the room is gone', () => {
    const step = stepSounds({ last: room(), handOverDue: true }, null, ME);
    expect(step.memory).toEqual(FRESH_MEMORY);
  });
});

describe('a win by forfeit', () => {
  const notice = (over: Partial<ForfeitNotice> = {}): ForfeitNotice => ({
    roomId: 'ROOM1',
    winnerId: ME,
    winnerNickname: 'me',
    leaverNickname: 'opp',
    players: [],
    ...over,
  });

  it('is a win for the player who stayed', () => {
    expect(forfeitSoundEvents(null, notice(), ME)).toEqual([{ kind: 'win' }]);
  });

  it('is the neutral sound for anyone else in the room, a spectator', () => {
    expect(forfeitSoundEvents(null, notice(), WATCHER)).toEqual([{ kind: 'draw' }]);
  });

  it('plays once for one notice, however often it is looked at', () => {
    const n = notice();
    expect(forfeitSoundEvents(n, n, ME)).toEqual([]);
  });

  it('plays again for a later forfeit', () => {
    expect(forfeitSoundEvents(notice(), notice(), ME)).toEqual([{ kind: 'win' }]);
  });

  it('is silent when the notice is dismissed, or before there is a player', () => {
    expect(forfeitSoundEvents(notice(), null, ME)).toEqual([]);
    expect(forfeitSoundEvents(null, notice(), null)).toEqual([]);
  });
});

describe('puzzle mode', () => {
  it('opening a mine is the explosion', () => {
    expect(puzzleSoundEvents('playing', 'lost')).toEqual([{ kind: 'explosion' }]);
  });

  it('winning is the fanfare', () => {
    expect(puzzleSoundEvents('playing', 'won')).toEqual([{ kind: 'win' }]);
  });

  it('a first click that settles the game still counts', () => {
    expect(puzzleSoundEvents('ready', 'won')).toEqual([{ kind: 'win' }]);
    expect(puzzleSoundEvents('ready', 'lost')).toEqual([{ kind: 'explosion' }]);
  });

  it('plays nothing while the game goes on, or for a new game', () => {
    expect(puzzleSoundEvents('ready', 'playing')).toEqual([]);
    expect(puzzleSoundEvents('playing', 'playing')).toEqual([]);
    expect(puzzleSoundEvents('lost', 'ready')).toEqual([]);
    expect(puzzleSoundEvents('won', 'ready')).toEqual([]);
  });

  it('plays once: a game already over stays over', () => {
    expect(puzzleSoundEvents('lost', 'lost')).toEqual([]);
    expect(puzzleSoundEvents('won', 'won')).toEqual([]);
  });
});
