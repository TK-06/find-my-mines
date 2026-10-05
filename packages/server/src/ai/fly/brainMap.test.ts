import { describe, expect, it } from 'vitest';
import type { FlyCircuit } from './brain.js';
import { loadFlyCircuit } from './load.js';
import { buildFlyBrainMap } from './brainMap.js';

const fixture: FlyCircuit = {
  provenance: {
    dataset: 'test',
    fetchedOn: '2026-10-05',
    credit: { text: 'test', license: 'CC BY 4.0', url: 'https://example.org' },
  },
  neurons: [
    { id: 1, type: 'DA1_lPN', role: 'input', nt: null },
    { id: 2, type: 'KCg-m', role: 'hidden', nt: null },
    { id: 3, type: 'MBON01', role: 'output', nt: null },
    { id: 4, type: 'KCg-d', role: 'hidden', nt: null },
  ],
  edges: [
    [0, 1, 2],
    [1, 2, 12],
    [2, 3, 5],
  ],
};

describe('buildFlyBrainMap', () => {
  it('keeps the fetched circuit’s neuron order and roles and selects the strongest edges', () => {
    const circuit = loadFlyCircuit();
    const map = buildFlyBrainMap(circuit);

    expect(map.neurons.map(({ id, role }) => [id, role])).toEqual(
      circuit.neurons.map(({ id, role }) => [id, role]),
    );
    expect(map.provenance).toEqual({
      dataset: circuit.provenance.dataset,
      fetchedOn: circuit.provenance.fetchedOn,
      credit: circuit.provenance.credit,
    });
    expect(map.neurons).toHaveLength(244);
    expect(map.edges).toHaveLength(1_500);
    expect(map.edges.map(([, , weight]) => weight)).toEqual(
      [...circuit.edges]
        .sort((a, b) => b[2] - a[2] || a[0] - b[0] || a[1] - b[1])
        .slice(0, 1_500)
        .map(([, , weight]) => weight),
    );
  });

  it('centres and scales real positions, then fills nulls near their layer mean deterministically', () => {
    const positions = {
      '1': [10, 20, 30] as const,
      '2': [20, 40, 60] as const,
      '3': [30, 60, 90] as const,
      '4': null,
    };
    const map = buildFlyBrainMap(fixture, positions);
    const again = buildFlyBrainMap(fixture, positions);

    expect(map.neurons[0]!.position).toEqual([-0.3333, -0.6667, -1]);
    expect(map.neurons[1]!.position).toEqual([0, 0, 0]);
    expect(map.neurons[2]!.position).toEqual([0.3333, 0.6667, 1]);
    expect(map.neurons[3]!.position).toEqual(again.neurons[3]!.position);
    map.neurons[3]!.position.forEach((value, axis) => {
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
      expect(Math.abs(value - map.neurons[1]!.position[axis]!)).toBeLessThan(0.1);
    });
    expect(map.edges).toEqual([
      [1, 2, 12],
      [2, 3, 5],
      [0, 1, 2],
    ]);
  });

  it('uses a stable PN-to-KC-to-MBON schematic when positions are unavailable', () => {
    const map = buildFlyBrainMap(fixture);
    const again = buildFlyBrainMap(fixture);

    expect(map.neurons.map((neuron) => neuron.position)).toEqual(
      again.neurons.map((neuron) => neuron.position),
    );
    expect(map.neurons[0]!.position[0]).toBeLessThan(-0.5);
    expect(Math.abs(map.neurons[1]!.position[0]!)).toBeLessThan(0.7);
    expect(map.neurons[2]!.position[0]).toBeGreaterThan(0.5);
    for (const neuron of map.neurons) {
      for (const value of neuron.position) {
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});
