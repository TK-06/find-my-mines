import type { HintReason } from '@fmm/shared';
import { describe, expect, it } from 'vitest';
import {
  WHY_TIMEOUT_MS,
  rewordHint,
  whyStillApplies,
  type RewordDeps,
  type RewordRequest,
  type RoomLook,
} from './hintReword.js';

const REASON: HintReason = {
  goal: 'mine',
  cell: 'C3',
  flagged: false,
  kind: 'forced',
  number: { at: 'B3', value: 2, found: 0, need: 2, covered: 2 },
  cells: ['C3', 'C4'],
  sureMines: [],
  knownSafe: [],
};

const REQUEST: RewordRequest = {
  row: 2,
  col: 2,
  reason: REASON,
  plain: 'The 2 at B3 still needs 2 mines and touches only C3 and C4, so both are mines.',
  stamp: { matchNumber: 1, hintsLeft: 2 },
};

/** The room as the asker sees it when nothing has changed since the hint. */
const SAME: RoomLook = { matchNumber: 1, hintsLeft: 2, playing: true, covered: true };

const WHY = 'C3 is a mine: the 2 at B3 needs 2 mines and only C3 and C4 are left.';

/** Fakes for everything outside: the advisor's answer, the room, the socket. */
function setup(options: { answer?: string | null; look?: () => RoomLook | null; advisor?: RewordDeps['advisor'] } = {}) {
  const sent: { row: number; col: number; why: string }[] = [];
  const asked: { reason: HintReason; plain: string; timeoutMs: number }[] = [];
  const deps: RewordDeps = {
    advisor:
      options.advisor === undefined
        ? {
            explain: async (reason, plain, timeoutMs) => {
              asked.push({ reason, plain, timeoutMs });
              return options.answer === undefined ? WHY : options.answer;
            },
          }
        : options.advisor,
    look: options.look ?? (() => SAME),
    send: (payload) => sent.push(payload),
  };
  return { deps, sent, asked };
}

describe('whyStillApplies', () => {
  it('holds while the asker is in the same match, still playing, with the cell covered and no newer hint', () => {
    expect(whyStillApplies(REQUEST.stamp, SAME)).toBe(true);
  });

  it('fails when they are no longer seated in the room', () => {
    expect(whyStillApplies(REQUEST.stamp, null)).toBe(false);
  });

  it('fails in another match of the same room, even one that has the cell covered', () => {
    expect(whyStillApplies(REQUEST.stamp, { ...SAME, matchNumber: 2 })).toBe(false);
  });

  it('fails once the match is no longer being played, or the cell has been opened', () => {
    expect(whyStillApplies(REQUEST.stamp, { ...SAME, playing: false })).toBe(false);
    expect(whyStillApplies(REQUEST.stamp, { ...SAME, covered: false })).toBe(false);
  });

  it('fails when a newer hint has been taken since', () => {
    expect(whyStillApplies(REQUEST.stamp, { ...SAME, hintsLeft: 1 })).toBe(false);
  });
});

describe('rewordHint', () => {
  it('asks the advisor with the facts and the plain wording, within about four seconds', async () => {
    const { deps, asked } = setup();
    await rewordHint(deps, REQUEST);
    expect(asked).toEqual([{ reason: REASON, plain: REQUEST.plain, timeoutMs: WHY_TIMEOUT_MS }]);
    expect(WHY_TIMEOUT_MS).toBe(4_000);
  });

  it('sends the wording, with the cell it is for, to the asker', async () => {
    const { deps, sent } = setup();
    expect(await rewordHint(deps, REQUEST)).toBe(true);
    expect(sent).toEqual([{ row: 2, col: 2, why: WHY }]);
  });

  it('sends nothing without an advisor — no Groq key', async () => {
    const { deps, sent } = setup({ advisor: null });
    expect(await rewordHint(deps, REQUEST)).toBe(false);
    expect(sent).toEqual([]);
  });

  it('sends nothing when the advisor has no usable wording', async () => {
    for (const answer of [null, '']) {
      const { deps, sent } = setup({ answer });
      expect(await rewordHint(deps, REQUEST)).toBe(false);
      expect(sent).toEqual([]);
    }
  });

  it('looks at the room after the wait, not before — the player may have moved on in the meantime', async () => {
    let waited = false;
    const { deps, sent } = setup({
      advisor: {
        explain: async () => {
          waited = true;
          return WHY;
        },
      },
      // Fine until the model has answered, then the cell is gone.
      look: () => ({ ...SAME, covered: !waited }),
    });
    expect(await rewordHint(deps, REQUEST)).toBe(false);
    expect(sent).toEqual([]);
  });

  it('sends nothing when the asker has left, the match has changed, or a newer hint was taken', async () => {
    const looks: (RoomLook | null)[] = [
      null,
      { ...SAME, matchNumber: 2 },
      { ...SAME, playing: false },
      { ...SAME, covered: false },
      { ...SAME, hintsLeft: 1 },
    ];
    for (const look of looks) {
      const { deps, sent } = setup({ look: () => look });
      expect(await rewordHint(deps, REQUEST)).toBe(false);
      expect(sent).toEqual([]);
    }
  });

  it('never throws, whatever fails underneath, because nobody waits on it', async () => {
    const boom = () => {
      throw new Error('boom');
    };
    const rejecting = setup({ advisor: { explain: async () => boom() } });
    expect(await rewordHint(rejecting.deps, REQUEST)).toBe(false);

    const lookFails = setup({ look: boom });
    expect(await rewordHint(lookFails.deps, REQUEST)).toBe(false);

    const sendFails = setup();
    sendFails.deps.send = boom;
    expect(await rewordHint(sendFails.deps, REQUEST)).toBe(false);
  });
});
