import type { FlyCircuit, FlyProvenance, NeuronRole } from './brain.js';

export type FlyPosition = readonly [x: number, y: number, z: number];

export interface FlyBrainMapNeuron {
  id: number;
  role: NeuronRole;
  type: string;
  position: FlyPosition;
}

export interface FlyBrainMap {
  format: 1;
  provenance: Pick<FlyProvenance, 'dataset' | 'fetchedOn' | 'credit'>;
  neurons: FlyBrainMapNeuron[];
  /** Strongest circuit connections, with indexes into `neurons`. */
  edges: [pre: number, post: number, weight: number][];
}

const EDGE_LIMIT = 1_500;
const ROLES: readonly NeuronRole[] = ['input', 'hidden', 'output'];

/** A compact display map in the circuit's neuron order. Safe to run without positions.json. */
export function buildFlyBrainMap(
  circuit: FlyCircuit,
  positions?: Readonly<Record<string, FlyPosition | null>>,
): FlyBrainMap {
  const raw = new Map<number, FlyPosition>();
  for (const neuron of circuit.neurons) {
    const position = positions?.[String(neuron.id)];
    if (isPosition(position)) raw.set(neuron.id, position);
  }

  const normalized = normalizePositions([...raw.values()]);
  const known = new Map<number, FlyPosition>();
  let positionIndex = 0;
  for (const neuron of circuit.neurons) {
    if (raw.has(neuron.id)) known.set(neuron.id, normalized[positionIndex++]!);
  }

  const byRole = new Map<NeuronRole, FlyPosition[]>();
  for (const neuron of circuit.neurons) {
    const point = known.get(neuron.id);
    if (!point) continue;
    const layer = byRole.get(neuron.role) ?? [];
    layer.push(point);
    byRole.set(neuron.role, layer);
  }

  const roleCounts = new Map<NeuronRole, number>();
  circuit.neurons.forEach((neuron) => roleCounts.set(neuron.role, (roleCounts.get(neuron.role) ?? 0) + 1));
  const roleSeen = new Map<NeuronRole, number>();
  const mapNeurons = circuit.neurons.map((neuron) => {
    const index = roleSeen.get(neuron.role) ?? 0;
    roleSeen.set(neuron.role, index + 1);
    const point = known.get(neuron.id) ?? fallbackPosition(
      neuron.id,
      neuron.role,
      index,
      roleCounts.get(neuron.role) ?? 1,
      byRole.get(neuron.role) ?? [],
    );
    return {
      id: neuron.id,
      role: neuron.role,
      type: shortType(neuron.type),
      position: point,
    };
  });

  const edges = [...circuit.edges]
    .sort((a, b) => b[2] - a[2] || a[0] - b[0] || a[1] - b[1])
    .slice(0, EDGE_LIMIT)
    .map(([pre, post, weight]) => [pre, post, weight] as [number, number, number]);

  return {
    format: 1,
    provenance: {
      dataset: circuit.provenance.dataset,
      fetchedOn: circuit.provenance.fetchedOn,
      credit: circuit.provenance.credit,
    },
    neurons: mapNeurons,
    edges,
  };
}

function isPosition(value: FlyPosition | null | undefined): value is FlyPosition {
  return value !== null && value !== undefined && value.length === 3 && value.every(Number.isFinite);
}

/** Uses one scale for all axes, preserving the real connectome's proportions. */
function normalizePositions(points: readonly FlyPosition[]): FlyPosition[] {
  if (points.length === 0) return [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis]!, point[axis]!);
      max[axis] = Math.max(max[axis]!, point[axis]!);
    }
  }
  const scale = 2 / Math.max(1, ...max.map((value, axis) => value - min[axis]!));
  const center = min.map((value, axis) => (value + max[axis]!) / 2);
  return points.map((point) =>
    point.map((value, axis) => round4((value - center[axis]!) * scale)) as unknown as FlyPosition,
  );
}

function fallbackPosition(
  id: number,
  role: NeuronRole,
  roleIndex: number,
  roleCount: number,
  layer: readonly FlyPosition[],
): FlyPosition {
  const base = layer.length > 0 ? meanPosition(layer) : schematicPosition(role, roleIndex, roleCount, id);
  return base.map((value, axis) => round4(clamp(value + jitter(id, axis) * (layer.length > 0 ? 0.045 : 0.025)))) as unknown as FlyPosition;
}

function meanPosition(points: readonly FlyPosition[]): FlyPosition {
  return [0, 1, 2].map((axis) => points.reduce((sum, point) => sum + point[axis]!, 0) / points.length) as unknown as FlyPosition;
}

function schematicPosition(role: NeuronRole, index: number, count: number, id: number): FlyPosition {
  const y = count > 1 ? 0.8 - (1.6 * index) / (count - 1) : 0;
  if (role === 'input') return [-0.78, round4(y), round4(jitter(id, 2) * 0.12)];
  if (role === 'output') return [0.78, round4(y), round4(jitter(id, 2) * 0.12)];
  return [jitter(id, 0) * 0.65, jitter(id, 1) * 0.65, jitter(id, 2) * 0.65].map(round4) as unknown as FlyPosition;
}

function shortType(type: string): string {
  return type.length <= 12 ? type : `${type.slice(0, 11)}…`;
}

function jitter(id: number, axis: number): number {
  let value = Math.imul((id ^ Math.imul(axis + 1, 0x9e3779b9)) | 0, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return ((value >>> 0) / 0xffffffff) * 2 - 1;
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
