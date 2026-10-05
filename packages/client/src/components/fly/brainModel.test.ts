import { describe, expect, it } from 'vitest';
import type { FlyThoughtNotice } from '@fmm/shared';
import {
  decodeFlyRates,
  describeFlyThought,
  projectPoint,
  rotationAngle,
  thoughtStep,
} from './brainModel.js';

// Cells 0–17 of a 6-wide board, scored 0–17: row 3, col 2 is not among them, so
// the pick is added as the best score of all — "C4", the top pick.
const thought: FlyThoughtNotice = {
  roomId: 'R1',
  botId: 'bot:fly',
  move: 6,
  pick: { row: 3, col: 2 },
  steps: 16,
  neurons: 244,
  rates: '',
  candidates: [
    ...Array.from({ length: 17 }, (_, i) => ({ row: Math.floor(i / 6), col: i % 6, score: i })),
    { row: 3, col: 2, score: 99 },
  ],
};

describe('decodeFlyRates', () => {
  it('decodes one byte per rate from the base64 payload', () => {
    expect([...decodeFlyRates('AP8=', 1, 2)!]).toEqual([0, 255]);
  });

  it('refuses a payload that is not the announced size, rather than drawing nonsense', () => {
    expect(decodeFlyRates('AP8=', 16, 244)).toBeNull();
    expect(decodeFlyRates('not base64!', 16, 244)).toBeNull();
    expect(decodeFlyRates('', 0, 0)).toBeNull();
  });
});

describe('projectPoint', () => {
  it('leaves the point alone at the top of the turn', () => {
    expect(projectPoint(0.5, 0.25, 0, 0)).toEqual({ x: 0.5, y: 0.25, depth: 0 });
  });

  it('turns a point on the x axis to the front at a quarter turn', () => {
    const quarter = projectPoint(1, 0.5, 0, Math.PI / 2);
    expect(quarter.x).toBeCloseTo(0, 10);
    expect(quarter.y).toBeCloseTo(0.5, 10);
    expect(quarter.depth).toBeCloseTo(-1, 10);
  });
});

describe('rotationAngle', () => {
  it('turns once round per turn length', () => {
    expect(rotationAngle(0, 40_000)).toBe(0);
    expect(rotationAngle(10_000, 40_000)).toBeCloseTo(Math.PI / 2, 10);
    expect(rotationAngle(40_000, 40_000)).toBeCloseTo(Math.PI * 2, 10);
  });
});

describe('thoughtStep', () => {
  it('plays the steps evenly over the play time, then holds the last one', () => {
    expect(thoughtStep(0, 16, 1_000)).toBe(0);
    expect(thoughtStep(62, 16, 1_000)).toBe(0);
    expect(thoughtStep(63, 16, 1_000)).toBe(1);
    expect(thoughtStep(500, 16, 1_000)).toBe(8);
    expect(thoughtStep(999, 16, 1_000)).toBe(15);
    expect(thoughtStep(5_000, 16, 1_000)).toBe(15);
  });

  it('stays on the first step before the thought and with no steps at all', () => {
    expect(thoughtStep(-300, 16, 1_000)).toBe(0);
    expect(thoughtStep(500, 0, 1_000)).toBe(0);
  });
});

describe('describeFlyThought', () => {
  it('names the move, the pick and how many cells the fly chose between', () => {
    expect(describeFlyThought(thought, 20)).toBe(
      "Move 7: the fly's 20 output neurons favoured C4 (its top pick of 18 cells).",
    );
  });

  it('says "or more" when the candidates were capped for display', () => {
    const capped = {
      ...thought,
      candidates: Array.from({ length: 40 }, (_, i) => ({ row: Math.floor(i / 6), col: i % 6, score: i })),
      pick: { row: 6, col: 3 },
    };
    expect(describeFlyThought(capped, 20)).toBe(
      "Move 7: the fly's 20 output neurons favoured D7 (its top pick of 40 or more cells).",
    );
  });

  it('does not call a pick the top pick when a higher score was passed over', () => {
    const loose = { ...thought, pick: { row: 0, col: 0 } };
    expect(describeFlyThought(loose, 20)).toBe(
      "Move 7: the fly's 20 output neurons rated 18 cells; it went for A1.",
    );
  });
});
