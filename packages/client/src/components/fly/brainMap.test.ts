import { describe, expect, it } from 'vitest';
import circuit from '../../../../server/src/ai/fly/circuit.json';
import brainMap from './brainMap.json';

describe('static Fruit Fly brain map', () => {
  it('keeps circuit neuron order and roles with normalized display positions', () => {
    expect(brainMap.neurons.map(({ id, role }) => [id, role])).toEqual(
      circuit.neurons.map(({ id, role }) => [id, role]),
    );
    expect(brainMap.neurons).toHaveLength(244);
    expect(brainMap.edges).toHaveLength(1_500);
    for (const neuron of brainMap.neurons) {
      expect(neuron.type.length).toBeLessThanOrEqual(12);
      expect(neuron.position).toHaveLength(3);
      for (const value of neuron.position) {
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});
