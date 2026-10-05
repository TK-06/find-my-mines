/**
 * The Fruit Fly bot's brain: a small piece of the male fruit fly connectome,
 * run as a simple rate model, with a trained linear readout on top.
 *
 * Honest about who does what. The wiring — which neuron talks to which, how
 * many synapses, excitatory or inhibitory — is the real fly's (MaleCNS,
 * Janelia & Google, CC BY 4.0; see circuit.json). The neuron model is a
 * textbook leaky rate unit with a few hand-set constants. The readout that
 * turns the output neurons' activity into "open this cell" is trained on
 * seeded games (scripts/fly/train.ts), and like the viral fly-game demos, it
 * does most of the work: the circuit mixes the signal, the readout decides.
 *
 * Pure and deterministic: no clock, no randomness, no I/O. The same features
 * always give the same activity.
 */

import { FLY_FEATURES } from './features.js';

export type NeuronRole = 'input' | 'hidden' | 'output';

export interface FlyNeuron {
  /** neuPrint body id. */
  id: number;
  /** Cell type, e.g. "DA1_lPN", "KCg-m", "MBON01". */
  type: string;
  role: NeuronRole;
  /** Consensus neurotransmitter, e.g. "acetylcholine"; null when unknown. */
  nt: string | null;
}

/** A connection: presynaptic index, postsynaptic index (into `neurons`), synapse count. */
export type FlyEdge = readonly [pre: number, post: number, weight: number];

export interface FlyProvenance {
  dataset: string;
  fetchedOn: string;
  credit: { text: string; license: string; url: string };
}

export interface FlyCircuit {
  provenance: FlyProvenance;
  neurons: FlyNeuron[];
  edges: FlyEdge[];
}

/** Turns the output neurons' rates into a score: higher means "more likely a mine". */
export interface FlyReadout {
  /** Body ids of the output neurons, in the circuit's order — checks the weights fit the circuit. */
  outputIds: number[];
  /** Per output: the rate's mean and spread over the training boards, to standardise it. */
  mean: number[];
  std: number[];
  weights: number[];
  bias: number;
}

/** Simulation steps per cell: enough for input → Kenyon cell → output, and the loops among them, to settle. */
export const FLY_STEPS = 16;

/** How far each neuron moves toward its input per step — one over its time constant. */
const LEAK = 0.25;

/**
 * Rate = gain × (potential − threshold), kept to 0–1. Kenyon cells have a
 * real threshold, so only those whose mix of inputs stands out fire — the
 * sparse coding the mushroom body is known for.
 */
const THRESHOLD: Record<NeuronRole, number> = { input: 0, hidden: 0.3, output: 0 };
const GAIN: Record<NeuronRole, number> = { input: 1, hidden: 4, output: 4 };

/**
 * Feedback inhibition on the Kenyon cells, proportional to their mean rate —
 * the job the fly's APL neuron does. It keeps the layer from all firing at once.
 */
const APL_STRENGTH = 1;

const ROLES: readonly NeuronRole[] = ['input', 'hidden', 'output'];
const INPUT = 0;
const HIDDEN = 1;

/**
 * Excitatory (+1), inhibitory (−1) or neither (0). In the fly, acetylcholine
 * excites; GABA and glutamate (through GluCl channels) inhibit. Dopamine,
 * serotonin, octopamine and unknown transmitters modulate rather than drive,
 * so this simple model leaves them out.
 */
export function transmitterSign(nt: string | null): number {
  if (nt === 'acetylcholine') return 1;
  if (nt === 'gaba' || nt === 'glutamate') return -1;
  return 0;
}

export class FlyBrain {
  private readonly count: number;
  private readonly role: Uint8Array;
  private readonly hidden: Int32Array;
  private readonly inputs: Int32Array;
  private readonly outputIndex: Int32Array;
  /** Incoming connections grouped by postsynaptic neuron: edges start[i]…start[i+1]. */
  private readonly start: Int32Array;
  private readonly pre: Int32Array;
  private readonly weight: Float64Array;

  constructor(
    circuit: FlyCircuit,
    private readonly readout: FlyReadout | null = null,
  ) {
    const { neurons, edges } = circuit;
    this.count = neurons.length;
    this.role = Uint8Array.from(neurons, (n) => ROLES.indexOf(n.role));
    const where = (role: number) => Int32Array.from(neurons.flatMap((_, i) => (this.role[i] === role ? [i] : [])));
    this.inputs = where(INPUT);
    this.hidden = where(HIDDEN);
    this.outputIndex = where(2);

    // Each neuron's input is a weighted average of its partners' rates: a
    // partner's weight is its share of all the synapses this neuron gets from
    // the circuit, signed by the partner's transmitter. Input neurons are
    // driven by the features alone — in the fly, their drive comes from the
    // antenna, outside this circuit — so connections into them are skipped.
    const used = edges.filter(([, post]) => this.role[post] !== INPUT);
    const total = new Float64Array(this.count);
    for (const [, post, synapses] of used) total[post]! += synapses;
    const sorted = [...used].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    this.start = new Int32Array(this.count + 1);
    for (const [, post] of sorted) this.start[post + 1]!++;
    for (let i = 0; i < this.count; i++) this.start[i + 1]! += this.start[i]!;
    this.pre = Int32Array.from(sorted, ([pre]) => pre);
    this.weight = Float64Array.from(
      sorted,
      ([pre, post, synapses]) => (transmitterSign(neurons[pre]!.nt) * synapses) / total[post]!,
    );
  }

  /**
   * The output neurons' rates, 0–1, after the circuit has run on one cell.
   *
   * Each feature feeds two channels — ON (the value) and OFF (one minus it),
   * as sensory systems do — and the input neurons take the channels in turn,
   * so with 24 inputs and 8 features (16 channels) the first 8 channels — the
   * ON and OFF of the first four features — drive two input neurons each, and
   * the other eight drive one. The mix is slightly lopsided; the readout copes.
   */
  outputs(features: readonly number[]): Float64Array {
    return this.simulate(features, false).outputs;
  }

  /** Every neuron's rate at every simulation step, in circuit order and step-major order. */
  trace(features: readonly number[]): Float64Array {
    return this.simulate(features, true).trace!;
  }

  private simulate(features: readonly number[], captureTrace: boolean): { outputs: Float64Array; trace?: Float64Array } {
    const n = this.count;
    const drive = new Float64Array(n);
    const channels = Math.max(1, features.length * 2);
    this.inputs.forEach((neuron, k) => {
      const channel = k % channels;
      const value = unit(features[Math.floor(channel / 2)] ?? 0);
      drive[neuron] = channel % 2 === 0 ? value : 1 - value;
    });

    const potential = new Float64Array(n);
    let rate = new Float64Array(n);
    let next = new Float64Array(n);
    const trace = captureTrace ? new Float64Array(FLY_STEPS * n) : undefined;
    const hiddenCount = this.hidden.length;
    for (let step = 0; step < FLY_STEPS; step++) {
      let hiddenMean = 0;
      for (let h = 0; h < hiddenCount; h++) hiddenMean += rate[this.hidden[h]!]!;
      const apl = hiddenCount > 0 ? (APL_STRENGTH * hiddenMean) / hiddenCount : 0;

      for (let i = 0; i < n; i++) {
        const role = this.role[i]!;
        let input: number;
        if (role === INPUT) input = drive[i]!;
        else {
          input = role === HIDDEN ? -apl : 0;
          for (let e = this.start[i]!; e < this.start[i + 1]!; e++) input += this.weight[e]! * rate[this.pre[e]!]!;
        }
        potential[i]! += LEAK * (input - potential[i]!);
        const name = ROLES[role]!;
        next[i] = unit(GAIN[name] * (potential[i]! - THRESHOLD[name]));
      }
      [rate, next] = [next, rate];
      trace?.set(rate, step * n);
    }
    return { outputs: Float64Array.from(this.outputIndex, (i) => rate[i]!), trace };
  }

  /** How strongly the fly "wants" this cell: the readout over its output neurons. Higher = likelier a mine. */
  score(features: readonly number[]): number {
    const readout = this.readout;
    if (!readout) throw new Error('This fly brain has no trained readout.');
    const rates = this.outputs(features);
    let score = readout.bias;
    for (let k = 0; k < rates.length; k++) {
      score += readout.weights[k]! * ((rates[k]! - readout.mean[k]!) / readout.std[k]!);
    }
    return score;
  }
}

function unit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

// ── loading ────────────────────────────────────────────────────────────────

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function fail(what: string): never {
  throw new Error(`Fly circuit: ${what}`);
}

/** Checks a circuit file's shape; throws with what is wrong. */
export function parseCircuit(value: unknown): FlyCircuit {
  if (!isObject(value)) fail('not an object');
  if (value.format !== 1) fail(`unknown format ${String(value.format)}`);

  const provenance = value.provenance;
  if (!isObject(provenance) || typeof provenance.dataset !== 'string' || typeof provenance.fetchedOn !== 'string') {
    fail('missing provenance');
  }
  const credit = provenance.credit;
  if (
    !isObject(credit) ||
    typeof credit.text !== 'string' ||
    typeof credit.license !== 'string' ||
    typeof credit.url !== 'string'
  ) {
    fail('missing credit');
  }

  if (!Array.isArray(value.neurons) || value.neurons.length === 0) fail('no neurons');
  const neurons = value.neurons.map((raw, i): FlyNeuron => {
    if (!isObject(raw)) fail(`neuron ${i} is not an object`);
    const { id, type, role, nt } = raw;
    if (!Number.isSafeInteger(id)) fail(`neuron ${i} has no body id`);
    if (typeof type !== 'string') fail(`neuron ${i} has no type`);
    if (!ROLES.includes(role as NeuronRole)) fail(`neuron ${i} has an unknown role`);
    if (nt !== null && typeof nt !== 'string') fail(`neuron ${i} has a bad transmitter`);
    return { id: id as number, type, role: role as NeuronRole, nt };
  });
  if (!neurons.some((n) => n.role === 'input') || !neurons.some((n) => n.role === 'output')) {
    fail('needs at least one input and one output neuron');
  }

  if (!Array.isArray(value.edges)) fail('no edges');
  const inRange = (index: unknown) => Number.isInteger(index) && (index as number) >= 0 && (index as number) < neurons.length;
  const edges = value.edges.map((raw, i): FlyEdge => {
    if (!Array.isArray(raw) || raw.length !== 3) fail(`edge ${i} is not [pre, post, weight]`);
    const [pre, post, weight] = raw as unknown[];
    if (!inRange(pre) || !inRange(post)) fail(`edge ${i} points outside the circuit`);
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) fail(`edge ${i} has a bad weight`);
    return [pre as number, post as number, weight];
  });

  return {
    provenance: {
      dataset: provenance.dataset as string,
      fetchedOn: provenance.fetchedOn as string,
      credit: { text: credit.text as string, license: credit.license as string, url: credit.url as string },
    },
    neurons,
    edges,
  };
}

/** Checks trained weights against the circuit they must fit; throws with what is wrong. */
export function parseReadout(value: unknown, circuit: FlyCircuit): FlyReadout {
  if (!isObject(value)) throw new Error('Fly readout: not an object');
  if (value.format !== 2) throw new Error('Fly readout: unknown format ' + String(value.format) + ' — retrain it (scripts/fly/train.ts)');
  const names = value.features;
  if (!Array.isArray(names) || names.length !== FLY_FEATURES.length || names.some((name, i) => name !== FLY_FEATURES[i])) {
    throw new Error('Fly readout: trained on different features — retrain it (scripts/fly/train.ts)');
  }
  const expected = circuit.neurons.filter((n) => n.role === 'output').map((n) => n.id);
  const numbers = (key: string): number[] => {
    const list = value[key];
    if (!Array.isArray(list) || list.length !== expected.length || !list.every((x) => Number.isFinite(x))) {
      throw new Error(`Fly readout: ${key} must be ${expected.length} numbers`);
    }
    return list as number[];
  };
  const outputIds = numbers('outputIds');
  if (outputIds.some((id, k) => id !== expected[k])) {
    throw new Error('Fly readout: trained on different output neurons — retrain it (scripts/fly/train.ts)');
  }
  const mean = numbers('mean');
  const std = numbers('std');
  if (std.some((s) => !(s > 0))) throw new Error('Fly readout: every std must be above 0');
  const weights = numbers('weights');
  const bias = value.bias;
  if (typeof bias !== 'number' || !Number.isFinite(bias)) throw new Error('Fly readout: bias must be a number');
  return { outputIds, mean, std, weights, bias };
}
