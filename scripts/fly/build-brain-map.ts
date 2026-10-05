import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFlyBrainMap, type FlyPosition } from '../../packages/server/src/ai/fly/brainMap.js';
import { loadFlyCircuit } from '../../packages/server/src/ai/fly/load.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FLY_DIR = resolve(HERE, '../../packages/server/src/ai/fly');
const POSITIONS = resolve(FLY_DIR, 'positions.json');
const OUTPUT = resolve(HERE, '../../packages/client/src/components/fly/brainMap.json');

function readPositions(): Readonly<Record<string, FlyPosition | null>> | undefined {
  let text: string;
  try {
    text = readFileSync(POSITIONS, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }

  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('positions.json must be an object');
  }
  const file = value as { format?: unknown; provenance?: { dataset?: unknown }; positions?: unknown };
  if (file.format !== 1 || typeof file.provenance?.dataset !== 'string') {
    throw new Error('positions.json has an unknown format or missing dataset');
  }
  if (file.provenance.dataset !== 'male-cns:v1.0') throw new Error('positions.json is for a different dataset');
  if (typeof file.positions !== 'object' || file.positions === null || Array.isArray(file.positions)) {
    throw new Error('positions.json is missing its positions object');
  }

  const parsed: Record<string, FlyPosition | null> = {};
  for (const [id, point] of Object.entries(file.positions)) {
    if (point === null) parsed[id] = null;
    else if (Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)) {
      parsed[id] = point as unknown as FlyPosition;
    } else throw new Error(`positions.json has an invalid point for body ${id}`);
  }
  return parsed;
}

const circuit = loadFlyCircuit();
const map = buildFlyBrainMap(circuit, readPositions());
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(map)}\n`);
console.log(`Saved ${map.neurons.length} neurons and ${map.edges.length} edges → ${OUTPUT}`);
