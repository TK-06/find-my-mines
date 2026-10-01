/**
 * Fetches the Fruit Fly bot's circuit from neuPrint, once. Not run by the game.
 *
 *   node --env-file=.env scripts/fly/fetch-circuit.mjs --date 2026-09-29
 *
 * Needs NEUPRINT_TOKEN (the token from your neuprint.janelia.org account page).
 * It is read from the environment only and never printed; the game server
 * never needs it — the circuit is saved to a JSON file the server reads.
 *
 * The circuit is a small, meaningful piece of the male fruit fly's brain: the
 * smell-learning pathway of the right mushroom body.
 *   inputs   olfactory projection neurons (ALPN), one per glomerulus type
 *   hidden   Kenyon cells those neurons synapse onto, most-mixed first
 *   outputs  mushroom-body output neurons (MBON) those Kenyon cells feed
 * plus every synapse-weighted connection among exactly those neurons.
 *
 * Four small Cypher queries, no bulk download. Options:
 *   --date YYYY-MM-DD   fetch date written into the provenance (required, so
 *                       the file says when it was fetched without a clock)
 *   --inputs N          projection neurons (default 24)
 *   --hidden N          Kenyon cells (default 200)
 *   --outputs N         MBONs (default 20)
 *   --out PATH          default packages/server/src/ai/fly/circuit.json
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = 'https://neuprint.janelia.org';
const DATASET = 'male-cns:v1.0';
const HERE = dirname(fileURLToPath(import.meta.url));

const CREDIT = {
  text: 'Male CNS connectome (MaleCNS), Janelia FlyEM, University of Cambridge, MRC LMB and Google Research',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  url: 'https://male-cns.janelia.org',
};

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

function count(name, fallback, max) {
  const value = Number(option(name, String(fallback)));
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`--${name} must be a whole number from 1 to ${max}`);
  }
  return value;
}

const fetchedOn = option('date', '');
if (!/^\d{4}-\d{2}-\d{2}$/.test(fetchedOn)) {
  console.error('Pass the fetch date: --date YYYY-MM-DD');
  process.exit(1);
}
const INPUTS = count('inputs', 24, 64);
const HIDDEN = count('hidden', 200, 400);
const OUTPUTS = count('outputs', 20, 40);
const OUT = resolve(option('out', resolve(HERE, '../../packages/server/src/ai/fly/circuit.json')));

// .env lines like "NEUPRINT_TOKEN = abc" leave spaces behind; a token never has any.
const TOKEN = (process.env.NEUPRINT_TOKEN ?? '').trim();
if (!TOKEN) {
  console.error('NEUPRINT_TOKEN is not set. Run with: node --env-file=.env scripts/fly/fetch-circuit.mjs');
  process.exit(1);
}

/** One neuPrint call. Errors carry the status and the start of the body — never the token. */
async function call(path, body) {
  const response = await fetch(`${SERVER}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`neuPrint ${path} answered HTTP ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const queries = [];

/** Runs one Cypher query and returns its rows as objects keyed by column. */
async function cypher(label, template, ids = []) {
  // Ids are integers this script got from neuPrint itself; checked anyway,
  // because they are pasted into the query text.
  for (const id of ids) if (!Number.isSafeInteger(id)) throw new Error(`not a body id: ${id}`);
  const text = template.replaceAll('$ids', `[${ids.join(',')}]`);
  queries.push({ label, cypher: template.replace(/\s+/g, ' ').trim(), ids: ids.length });
  const { columns, data } = await call('/api/custom/custom', { cypher: text, dataset: DATASET });
  console.log(`  ${label}: ${data.length} rows`);
  return data.map((row) => Object.fromEntries(columns.map((column, i) => [column, row[i]])));
}

console.log(`neuPrint ${DATASET}`);
const datasets = await call('/api/dbmeta/datasets');
const meta = datasets[DATASET];
if (!meta) throw new Error(`${DATASET} is not offered by this server any more`);

// 1. Inputs: right-side uniglomerular projection neurons, the one of each
//    type that sends the most synapses to Kenyon cells. Multiglomerular types
//    (M_…) and GABAergic ones are skipped, so every input is an excitatory
//    "smell channel" like the real ones.
const pnRows = await cypher(
  'projection neurons',
  `MATCH (p:Neuron)-[w:ConnectsTo]->(k:Neuron)
   WHERE p.class = 'ALPN' AND p.somaSide = 'R' AND p.type ENDS WITH 'PN' AND NOT p.type STARTS WITH 'M_'
     AND p.consensusNt = 'acetylcholine' AND k.class = 'Kenyon_Cell'
   WITH p, sum(w.weight) AS toKC
   RETURN p.bodyId AS id, p.type AS type, p.consensusNt AS nt, toKC
   ORDER BY toKC DESC, id`,
);
const byType = new Map();
for (const row of pnRows) if (!byType.has(row.type)) byType.set(row.type, row);
const inputs = [...byType.values()].slice(0, INPUTS).sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id);
if (inputs.length < INPUTS) throw new Error(`only ${inputs.length} projection neuron types found`);

// 2. Hidden: the Kenyon cells that hear from the most of those inputs — the
//    ones that mix smell channels, which is what Kenyon cells are for.
const kcRows = await cypher(
  'Kenyon cells',
  `MATCH (p:Neuron)-[w:ConnectsTo]->(k:Neuron)
   WHERE p.bodyId IN $ids AND k.class = 'Kenyon_Cell'
   WITH k, sum(w.weight) AS fromPN, count(DISTINCT p) AS channels
   RETURN k.bodyId AS id, k.type AS type, k.consensusNt AS nt, fromPN, channels
   ORDER BY channels DESC, fromPN DESC, id
   LIMIT ${HIDDEN}`,
  inputs.map((n) => n.id),
);
const hidden = kcRows.sort((a, b) => a.id - b.id);
if (hidden.length < HIDDEN) throw new Error(`only ${hidden.length} Kenyon cells found`);

// 3. Outputs: the MBONs those Kenyon cells drive hardest.
const mbonRows = await cypher(
  'mushroom-body output neurons',
  `MATCH (k:Neuron)-[w:ConnectsTo]->(m:Neuron)
   WHERE k.bodyId IN $ids AND m.class = 'MBON'
   WITH m, sum(w.weight) AS fromKC
   RETURN m.bodyId AS id, m.type AS type, m.instance AS instance, m.consensusNt AS nt, fromKC
   ORDER BY fromKC DESC, id
   LIMIT ${OUTPUTS}`,
  hidden.map((n) => n.id),
);
const outputs = mbonRows.sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id);
if (outputs.length < OUTPUTS) throw new Error(`only ${outputs.length} MBONs found`);

// 4. Every connection among exactly these neurons, in both directions.
const neurons = [
  ...inputs.map((n) => ({ id: n.id, type: n.type, role: 'input', nt: n.nt ?? null })),
  ...hidden.map((n) => ({ id: n.id, type: n.type, role: 'hidden', nt: n.nt ?? null })),
  ...outputs.map((n) => ({ id: n.id, type: n.type, role: 'output', nt: n.nt ?? null })),
];
const index = new Map(neurons.map((n, i) => [n.id, i]));
if (index.size !== neurons.length) throw new Error('a neuron was picked twice');

const edgeRows = await cypher(
  'connections',
  `MATCH (a:Neuron)-[w:ConnectsTo]->(b:Neuron)
   WHERE a.bodyId IN $ids AND b.bodyId IN $ids
   RETURN a.bodyId AS pre, b.bodyId AS post, w.weight AS weight`,
  neurons.map((n) => n.id),
);
const edges = edgeRows
  .filter((e) => index.has(e.pre) && index.has(e.post) && e.pre !== e.post && e.weight > 0)
  .map((e) => [index.get(e.pre), index.get(e.post), e.weight])
  .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

const circuit = {
  format: 1,
  provenance: {
    dataset: DATASET,
    uuid: meta.uuid ?? null,
    lastModified: meta['last-mod'] ?? null,
    server: SERVER,
    fetchedOn,
    selection:
      `Right mushroom body: ${INPUTS} uniglomerular olfactory projection neurons (one per type, most synapses ` +
      `onto Kenyon cells), the ${HIDDEN} Kenyon cells receiving the most of those channels, and the ` +
      `${OUTPUTS} MBONs those Kenyon cells drive hardest. Weights are synapse counts.`,
    queries,
    credit: CREDIT,
  },
  neurons,
  edges,
};

const json = JSON.stringify(circuit);
writeFileSync(OUT, `${json}\n`);
const synapses = edges.reduce((sum, e) => sum + e[2], 0);
console.log(
  `Saved ${neurons.length} neurons (${inputs.length} in, ${hidden.length} hidden, ${outputs.length} out), ` +
    `${edges.length} connections (${synapses} synapses), ${(json.length / 1024).toFixed(0)} KB → ${OUT}`,
);
