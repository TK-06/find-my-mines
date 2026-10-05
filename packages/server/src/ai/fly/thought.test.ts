import { describe, expect, it } from 'vitest';
import { displayFlyCandidates, encodeFlyRates } from './thought.js';

describe('encodeFlyRates', () => {
  it('rounds each rate into one byte and stays within one quantization step', () => {
    const rates = [0, 0.1, 0.5, 1];
    const encoded = encodeFlyRates(rates);

    expect(encoded).toBe('ABqA/w==');
    const decoded = [...Buffer.from(encoded, 'base64')];
    expect(decoded).toEqual([0, 26, 128, 255]);
    decoded.forEach((byte, index) => {
      expect(Math.abs(byte / 255 - rates[index]!)).toBeLessThanOrEqual(1 / 255 + 1e-12);
    });
  });

  it('encodes all 16 frames of a 244-neuron trace in step-major order', () => {
    const trace = Float64Array.from({ length: 16 * 244 }, (_, i) => i / (16 * 244 - 1));
    expect(encodeFlyRates(trace)).toHaveLength(5_208);
  });

  it('keeps the pick and only the 39 highest-scoring alternatives for display', () => {
    const candidates = Array.from({ length: 45 }, (_, i) => ({ row: Math.floor(i / 16), col: i % 16 }));
    const scores = candidates.map((_, i) => i);
    const pick = candidates[4]!;

    const display = displayFlyCandidates(candidates, scores, pick);

    expect(display).toHaveLength(40);
    expect(display[0]).toEqual({ ...pick, score: 4 });
    expect(display.slice(1).map(({ score }) => score)).toEqual(
      Array.from({ length: 39 }, (_, i) => 44 - i),
    );
  });
});
