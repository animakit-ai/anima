// Generates a blind labeling sample for precision validation (SPEC §6).
// Stratified by message length (proxy for spread) — the human label column
// is empty; the scorer's own tier is intentionally NOT included (no anchoring).
//
// Run: npx tsx benchmarks/make-labeling-sample.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanCorpus } from './replay.js';

const here = dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(
  readFileSync(join(here, 'data', 'raw', 'daily_logs.json'), 'utf-8').replace(/^﻿/, ''),
);
const { messages } = cleanCorpus(rows);

// Deterministic shuffle (mulberry32, seed 42) so the sample is reproducible
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);

// Stratify: 4 length buckets, ~12-13 samples each
const buckets: string[][] = [[], [], [], []];
for (const m of messages) {
  const b = m.length < 60 ? 0 : m.length < 150 ? 1 : m.length < 400 ? 2 : 3;
  buckets[b]!.push(m);
}
const sample: string[] = [];
for (const bucket of buckets) {
  const shuffled = [...bucket].sort(() => rand() - 0.5);
  sample.push(...shuffled.slice(0, 13));
}
const final = sample.slice(0, 50);

const csv = ['idx;tier_humano;mensaje'];
final.forEach((m, i) => {
  csv.push(`${i + 1};;"${m.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`);
});
const out = join(here, 'data', 'raw', 'labeling_sample.csv');
writeFileSync(out, '﻿' + csv.join('\n'), 'utf-8'); // BOM so Excel reads UTF-8
console.log(`${final.length} mensajes → ${out}`);
console.log('Llena la columna tier_humano con: micro | small | medium | large');
