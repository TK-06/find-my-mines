import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlyBrain, parseCircuit, parseReadout, type FlyCircuit, type FlyReadout } from './brain.js';

/**
 * Reads the fly's two data files, which live beside this module:
 *   circuit.json  the connectome piece (scripts/fly/fetch-circuit.mjs, needs a neuPrint token)
 *   readout.json  the trained readout (scripts/fly/train.ts, needs nothing)
 * The only I/O in the fly; everything it feeds is pure. Throws when a file is
 * missing or malformed, and the bot then plays the solver's pick instead.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

function read(name: string): unknown {
  return JSON.parse(readFileSync(join(HERE, name), 'utf8'));
}

export function loadFlyCircuit(): FlyCircuit {
  return parseCircuit(read('circuit.json'));
}

export function loadFlyReadout(circuit: FlyCircuit = loadFlyCircuit()): FlyReadout {
  return parseReadout(read('readout.json'), circuit);
}

export function loadFlyBrain(): FlyBrain {
  const circuit = loadFlyCircuit();
  return new FlyBrain(circuit, loadFlyReadout(circuit));
}
