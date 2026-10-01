import { describe, expect, it } from 'vitest';
import { FlyBrain, parseCircuit, parseReadout, type FlyCircuit, type FlyReadout } from './brain.js';
import { FLY_FEATURES } from './features.js';
import { loadFlyCircuit, loadFlyReadout } from './load.js';

const PROVENANCE = {
  dataset: 'test',
  fetchedOn: '2026-09-29',
  credit: { text: 'test', license: 'CC BY 4.0', url: 'https://example.org' },
};

/**
 * A toy fly. With two inputs, the first feature's ON channel drives PN_a and
 * its OFF channel PN_b. PN_a excites a Kenyon cell that excites the output;
 * PN_b excites a GABA neuron that inhibits it.
 */
function toyCircuit(overrides: Partial<FlyCircuit> = {}): FlyCircuit {
  return parseCircuit({
    format: 1,
    provenance: PROVENANCE,
    neurons: [
      { id: 1, type: 'PN_a', role: 'input', nt: 'acetylcholine' },
      { id: 2, type: 'PN_b', role: 'input', nt: 'acetylcholine' },
      { id: 3, type: 'KC', role: 'hidden', nt: 'acetylcholine' },
      { id: 4, type: 'LN', role: 'hidden', nt: 'gaba' },
      { id: 5, type: 'MBON', role: 'output', nt: 'glutamate' },
    ],
    edges: [
      [0, 2, 10],
      [1, 3, 10],
      [2, 4, 10],
      [3, 4, 5],
    ],
    ...overrides,
  });
}

const features = (value: number) => FLY_FEATURES.map(() => value);
/** Only the first feature set; the toy has no inputs for the rest. */
const first = (value: number) => FLY_FEATURES.map((_, i) => (i === 0 ? value : 0));

describe('parseCircuit', () => {
  it('accepts a well-formed circuit', () => {
    const circuit = toyCircuit();
    expect(circuit.neurons).toHaveLength(5);
    expect(circuit.edges).toHaveLength(4);
  });

  it.each([
    ['not an object', null],
    ['no neurons', { format: 1, provenance: PROVENANCE, neurons: [], edges: [] }],
    [
      'an unknown role',
      { format: 1, provenance: PROVENANCE, neurons: [{ id: 1, type: 'x', role: 'boss', nt: null }], edges: [] },
    ],
    [
      'an edge to a neuron that is not there',
      {
        format: 1,
        provenance: PROVENANCE,
        neurons: [
          { id: 1, type: 'a', role: 'input', nt: null },
          { id: 2, type: 'b', role: 'output', nt: null },
        ],
        edges: [[0, 7, 3]],
      },
    ],
    [
      'a negative weight',
      {
        format: 1,
        provenance: PROVENANCE,
        neurons: [
          { id: 1, type: 'a', role: 'input', nt: null },
          { id: 2, type: 'b', role: 'output', nt: null },
        ],
        edges: [[0, 1, -3]],
      },
    ],
    ['a later file format', { format: 2, provenance: PROVENANCE, neurons: [], edges: [] }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseCircuit(value)).toThrow();
  });
});

describe('FlyBrain on a toy circuit', () => {
  it('passes a signal from the inputs through to the output', () => {
    const brain = new FlyBrain(toyCircuit());
    expect(brain.outputs(first(1))[0]!).toBeGreaterThan(0);
    // All drive on PN_b: the Kenyon cell is silent and the GABA neuron wins.
    expect(brain.outputs(first(0))[0]!).toBe(0);
  });

  it('lets an inhibitory neuron pull the output down', () => {
    const excitatoryOnly = toyCircuit({ edges: [[0, 2, 10], [1, 3, 10], [2, 4, 10]] });
    const withInhibition = toyCircuit();
    const input = first(0.5);
    expect(new FlyBrain(withInhibition).outputs(input)[0]!).toBeLessThan(
      new FlyBrain(excitatoryOnly).outputs(input)[0]!,
    );
  });

  it('is blind with the wiring cut: no connections, no output', () => {
    const brain = new FlyBrain(toyCircuit({ edges: [] }));
    expect([...brain.outputs(features(1))]).toEqual([0]);
  });
});

describe('FlyBrain on the fetched connectome', () => {
  const circuit = loadFlyCircuit();

  it('is the small mushroom-body circuit, credited', () => {
    const roles = circuit.neurons.map((n) => n.role);
    expect(roles.filter((r) => r === 'input')).toHaveLength(24);
    expect(roles.filter((r) => r === 'hidden')).toHaveLength(200);
    expect(roles.filter((r) => r === 'output')).toHaveLength(20);
    expect(circuit.provenance.dataset).toMatch(/^male-cns/);
    expect(circuit.provenance.credit.license).toBe('CC BY 4.0');
    expect(circuit.edges.length).toBeGreaterThan(1_000);
  });

  it('gives the same activity for the same input, every time', () => {
    const brain = new FlyBrain(circuit);
    const input = [0.4, 0.25, 0.3, 0.125, 0, 0.3];
    expect([...brain.outputs(input)]).toEqual([...brain.outputs(input)]);
    expect([...new FlyBrain(circuit).outputs(input)]).toEqual([...brain.outputs(input)]);
  });

  it('keeps every output a finite rate between 0 and 1', () => {
    const brain = new FlyBrain(circuit);
    for (const value of [0, 0.3, 1]) {
      for (const rate of brain.outputs(features(value))) {
        expect(Number.isFinite(rate)).toBe(true);
        expect(rate).toBeGreaterThanOrEqual(0);
        expect(rate).toBeLessThanOrEqual(1);
      }
    }
  });

  it('answers different cells differently', () => {
    const brain = new FlyBrain(circuit);
    const likely = [...brain.outputs([0.9, 0.5, 0.4, 0, 0, 0.3])];
    const unlikely = [...brain.outputs([0.05, 0.5, 0.4, 0, 0, 0.3])];
    expect(likely).not.toEqual(unlikely);
  });

  it('is blind with the wiring cut, so the readout cannot skip the circuit', () => {
    const brain = new FlyBrain({ ...circuit, edges: [] });
    expect([...brain.outputs(features(1))].every((rate) => rate === 0)).toBe(true);
  });

  it('lets every one of the eight features reach the output neurons (16 channels over 24 inputs)', () => {
    const brain = new FlyBrain(circuit);
    const base = FLY_FEATURES.map(() => 0.5);
    const before = [...brain.outputs(base)];
    FLY_FEATURES.forEach((name, i) => {
      const moved = base.map((v, j) => (j === i ? 0.9 : v));
      expect([...brain.outputs(moved)], name).not.toEqual(before);
    });
  });

  it('scores a whole move — six candidates — well inside 20 ms', () => {
    const brain = new FlyBrain(circuit, loadFlyReadout(circuit));
    const candidates = Array.from({ length: 6 }, (_, i) => [i / 6, 0.5, 0.3, 0.1, 0, 0.3, 0.2, 0.1]);
    for (const input of candidates) brain.score(input); // warm up
    const moves = 20;
    const started = performance.now();
    for (let move = 0; move < moves; move++) for (const input of candidates) brain.score(input);
    expect((performance.now() - started) / moves).toBeLessThan(20);
  });
});

describe('parseReadout', () => {
  const circuit = toyCircuit();
  const good: FlyReadout = { outputIds: [5], mean: [0.2], std: [0.1], weights: [1.5], bias: -0.3 };
  const file = { format: 2, features: [...FLY_FEATURES], ...good };

  it('accepts weights that match the circuit’s outputs and the fly’s features', () => {
    expect(parseReadout(file, circuit)).toEqual(good);
  });

  it('refuses a readout trained on different features, or an older format', () => {
    expect(() => parseReadout({ ...file, features: ['mine chance', ...FLY_FEATURES.slice(1)] }, circuit)).toThrow(
      /different features/,
    );
    expect(() => parseReadout({ ...file, features: FLY_FEATURES.slice(0, 6) }, circuit)).toThrow(/different features/);
    expect(() => parseReadout({ ...file, features: undefined }, circuit)).toThrow(/different features/);
    expect(() => parseReadout({ ...file, format: 1 }, circuit)).toThrow(/format/);
  });

  it('rejects weights trained on a different set of outputs', () => {
    expect(() => parseReadout({ ...file, outputIds: [9] }, circuit)).toThrow();
    expect(() => parseReadout({ ...file, weights: [1, 2] }, circuit)).toThrow();
    expect(() => parseReadout({ ...file, std: [0] }, circuit)).toThrow();
    expect(() => parseReadout({ ...file, bias: Number.NaN }, circuit)).toThrow();
  });

  it('scores through the output neurons only', () => {
    const brain = new FlyBrain(circuit, good);
    const rate = brain.outputs(features(1))[0]!;
    expect(brain.score(features(1))).toBeCloseTo(-0.3 + 1.5 * ((rate - 0.2) / 0.1));
  });

  it('refuses to score without a readout', () => {
    expect(() => new FlyBrain(circuit).score(features(1))).toThrow();
  });
});
