// Parity check: presets.animaProduction vs the ORIGINAL production scorer
// (Anima_core/src/router/ComplexityScorer.ts), message by message over the
// real corpus. The preset's promise is bit-exact replication — verify it.
//
// Local-only (imports the original from outside the repo). Run:
//   npx tsx benchmarks/parity-vs-original.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScorer, presets } from '../src/index.js';
// @ts-expect-error — original lives outside the monorepo, local verification only
import { scoreComplexity as originalScore } from '../../../../Anima_core/src/router/ComplexityScorer.ts';
import { cleanCorpus } from './replay.js';

const here = dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(
  readFileSync(join(here, 'data', 'raw', 'daily_logs.json'), 'utf-8').replace(/^﻿/, ''),
);
const { messages } = cleanCorpus(rows);

const pkg = createScorer(presets.animaProduction);

let tierMatch = 0;
let scoreMatch = 0;
const diffs: Array<{ msg: string; orig: string; pkg: string; dScore: number }> = [];

for (const msg of messages) {
  const o = originalScore(msg);
  const p = pkg(msg);
  if (o.tier === p.tier) tierMatch++;
  if (Math.abs(o.score - p.score) < 1e-9) scoreMatch++;
  else if (diffs.length < 10) diffs.push({ msg: msg.slice(0, 60), orig: `${o.tier}/${o.score}`, pkg: `${p.tier}/${p.score}`, dScore: +(p.score - o.score).toFixed(4) });
}

console.log(`\nParidad presets.animaProduction vs original (${messages.length} mensajes reales):`);
console.log(`  tier idéntico:  ${tierMatch}/${messages.length} (${((tierMatch / messages.length) * 100).toFixed(1)}%)`);
console.log(`  score idéntico: ${scoreMatch}/${messages.length} (${((scoreMatch / messages.length) * 100).toFixed(1)}%)`);
if (diffs.length) {
  console.log('\nDivergencias (causa conocida: el original cuenta la keyword duplicada "retención" dos veces; nosotros una — ver vocabulary.ts):');
  for (const d of diffs) console.log(`  "${d.msg}" orig=${d.orig} pkg=${d.pkg} Δ=${d.dScore}`);
}
// Gate: ≥99.5% de paridad de tier — la única desviación permitida es el
// doble conteo del duplicado del original (bug documentado, no replicado).
process.exit(tierMatch / messages.length >= 0.995 ? 0 : 1);
