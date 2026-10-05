import type { MatchReplayNotice } from '@fmm/shared';
import { describe, expect, it } from 'vitest';
import { latestFromNotice, replayForPopup, withMatchId } from './latestReplay.js';

const notice: MatchReplayNotice = {
  roomId: 'K7Q2',
  replayId: 'r-1',
  matchId: null,
  coach: true,
  replay: {
    v: 1,
    rows: 3,
    cols: 3,
    mineCount: 1,
    mines: [4],
    seats: [
      { name: 'Ann', bot: false },
      { name: 'Ben', bot: false },
    ],
    moves: [{ i: 4, s: 0 }],
  },
};

const latest = () => latestFromNotice(notice, { matchCount: 2, mode: 'casual', you: 0, now: 1_000 });

describe('latestFromNotice', () => {
  it('keeps what the server sent and adds what this tab knew when it arrived', () => {
    expect(latest()).toEqual({
      roomId: 'K7Q2',
      replayId: 'r-1',
      matchId: null,
      replay: notice.replay,
      coach: true,
      matchCount: 2,
      mode: 'casual',
      you: 0,
      receivedAt: 1_000,
    });
  });

  it('takes a spectator’s missing seat as it is', () => {
    expect(latestFromNotice(notice, { matchCount: 1, mode: null, you: null, now: 5 }).you).toBeNull();
  });
});

describe('withMatchId', () => {
  it('fills in the saved match id once the server says it', () => {
    expect(withMatchId(latest(), 'm-9')?.matchId).toBe('m-9');
  });

  it('keeps the first id: a later one does not change the link', () => {
    const linked = withMatchId(latest(), 'm-9');
    expect(withMatchId(linked, 'm-10')?.matchId).toBe('m-9');
  });

  it('does nothing without a replay', () => {
    expect(withMatchId(null, 'm-9')).toBeNull();
  });

  it('leaves everything else as it was', () => {
    const { matchId: _gone, ...rest } = withMatchId(latest(), 'm-9')!;
    const { matchId: _was, ...before } = latest();
    expect(rest).toEqual(before);
  });
});

describe('replayForPopup', () => {
  it('is the latest replay when it is this room’s and came after the latest start', () => {
    expect(replayForPopup(latest(), 'K7Q2', 2)?.replayId).toBe('r-1');
  });

  it('is null for an older game: a rematch has started since', () => {
    expect(replayForPopup(latest(), 'K7Q2', 3)).toBeNull();
  });

  it('is null for another room, or no room, or no replay', () => {
    expect(replayForPopup(latest(), 'ZZZZ', 2)).toBeNull();
    expect(replayForPopup(latest(), null, 2)).toBeNull();
    expect(replayForPopup(null, 'K7Q2', 2)).toBeNull();
  });
});
