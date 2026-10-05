/** Fetches the selected Fruit Fly neurons' soma positions from neuPrint, once. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = 'https://neuprint.janelia.org';
const DATASET = 'male-cns:v1.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const FLY_DIR = resolve(HERE, '../../packages/server/src/ai/fly');

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

/** neuPrint may return a point object or its three coordinates as an array. */
export function parseSomaLocation(value) {
  const point = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null
      ? Array.isArray(value.coordinates)
        ? value.coordinates
        : [value.x, value.y, value.z]
      : null;
  return point?.length === 3 && point.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
    ? point
    : null;
}

/** One neuPrint call. Error messages report status only and never echo credentials or response bodies. */
async function call(path, body, token) {
  const response = await fetch(`${SERVER}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`neuPrint ${path} answered HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const circuitPath = resolve(FLY_DIR, 'circuit.json');
  const circuit = JSON.parse(readFileSync(circuitPath, 'utf8'));
  if (!Array.isArray(circuit.neurons) || !circuit.provenance?.credit) {
    throw new Error('circuit.json is missing neurons or provenance credit');
  }
  const ids = circuit.neurons.map((neuron) => neuron.id);
  if (ids.some((id) => !Number.isSafeInteger(id))) throw new Error('circuit.json contains an invalid body id');

  const token = (process.env.NEUPRINT_TOKEN ?? '').trim();
  if (!token) {
    throw new Error('NEUPRINT_TOKEN is not set. Run with: node --env-file=.env scripts/fly/fetch-positions.mjs');
  }

  const fetchedOn = option('date', new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fetchedOn)) throw new Error('--date must be YYYY-MM-DD');
  const datasets = await call('/api/dbmeta/datasets', undefined, token);
  if (!datasets?.[DATASET]) throw new Error(`${DATASET} is not offered by neuPrint`);

  const cypher =
    `MATCH (n:Neuron) WHERE n.bodyId IN [${ids.join(',')}] ` +
    'RETURN n.bodyId AS id, n.somaLocation AS somaLocation';
  const result = await call('/api/custom/custom', { cypher, dataset: DATASET }, token);
  if (!Array.isArray(result?.columns) || !Array.isArray(result?.data)) {
    throw new Error('neuPrint returned an invalid Cypher result');
  }
  const rows = result.data.map((row) => Object.fromEntries(result.columns.map((column, index) => [column, row[index]])));
  const wanted = new Set(ids);
  const positions = Object.fromEntries(ids.map((id) => [String(id), null]));
  for (const row of rows) {
    const id = typeof row.id === 'number' ? row.id : Number(row.id);
    if (!Number.isSafeInteger(id) || !wanted.has(id)) continue;
    positions[String(id)] = parseSomaLocation(row.somaLocation);
  }

  const output = {
    format: 1,
    provenance: { dataset: DATASET, fetchedOn, credit: circuit.provenance.credit },
    positions,
  };
  const path = resolve(FLY_DIR, option('out', 'positions.json'));
  writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`);
  const located = Object.values(positions).filter((position) => position !== null).length;
  console.log(`Saved soma positions for ${located} of ${ids.length} neurons; ${ids.length - located} are null → ${path}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'neuPrint position fetch failed');
    process.exitCode = 1;
  });
}
