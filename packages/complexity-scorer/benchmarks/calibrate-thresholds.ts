// Threshold calibration against human labels, with leave-one-out CV.
// Grid-searches (micro, small, medium) cutoffs maximizing exact agreement;
// reports LOO accuracy to expose overfitting on n=50.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScorer, type ComplexityTier } from '../src/index.js';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.length > 0)) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.length > 0)) rows.push(row);
  return rows;
}

const TIERS: ComplexityTier[] = ['micro', 'small', 'medium', 'large'];
const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? join(here, 'data', 'raw', 'labeled.csv');
const rows = parseCsv(readFileSync(file, 'utf-8').replace(/^﻿/, ''));
const score = createScorer();

const data = rows.slice(1)
  .map((r) => ({ human: (r[1] ?? '').trim().toLowerCase() as ComplexityTier, s: score(r[2] ?? '').score }))
  .filter((d) => TIERS.includes(d.human));

function tierOf(s: number, t: [number, number, number]): ComplexityTier {
  if (s < t[0]) return 'micro';
  if (s < t[1]) return 'small';
  if (s < t[2]) return 'medium';
  return 'large';
}

function fit(samples: typeof data): { t: [number, number, number]; acc: number } {
  const grid: number[] = [];
  for (let v = 0.02; v <= 0.41; v += 0.005) grid.push(+v.toFixed(3));
  let best: [number, number, number] = [0.25, 0.45, 0.65];
  let bestScore = -1;
  for (const a of grid) for (const b of grid) {
    if (b <= a) continue;
    for (const c of grid) {
      if (c <= b) continue;
      let exact = 0;
      let under = 0;
      for (const d of samples) {
        const p = tierOf(d.s, [a, b, c]);
        if (p === d.human) exact++;
        if (TIERS.indexOf(p) < TIERS.indexOf(d.human)) under++;
      }
      // objetivo: exactitud, con penalización suave del sub-ruteo (riesgo asimétrico)
      const obj = exact - 0.25 * under;
      if (obj > bestScore) { bestScore = obj; best = [a, b, c]; }
    }
  }
  let exact = 0;
  for (const d of samples) if (tierOf(d.s, best) === d.human) exact++;
  return { t: best, acc: exact / samples.length };
}

// Full fit
const full = fit(data);
console.log(`\nUmbrales óptimos (fit completo n=${data.length}): micro<${full.t[0]}, small<${full.t[1]}, medium<${full.t[2]}`);
console.log(`Exactitud in-sample: ${(full.acc * 100).toFixed(1)}%`);

// Leave-one-out CV
let looExact = 0;
let looAdj = 0;
let looUnder = 0;
for (let i = 0; i < data.length; i++) {
  const train = data.filter((_, j) => j !== i);
  const m = fit(train);
  const p = tierOf(data[i]!.s, m.t);
  const dIdx = TIERS.indexOf(p) - TIERS.indexOf(data[i]!.human);
  if (dIdx === 0) looExact++;
  if (Math.abs(dIdx) <= 1) looAdj++;
  if (dIdx < 0) looUnder++;
}
console.log(`\nLeave-one-out CV (honesto):`);
console.log(`  exacto: ${looExact}/${data.length} (${((looExact / data.length) * 100).toFixed(1)}%)`);
console.log(`  ±1 tier: ${looAdj}/${data.length} (${((looAdj / data.length) * 100).toFixed(1)}%)`);
console.log(`  sub-ruteo: ${looUnder}/${data.length} (${((looUnder / data.length) * 100).toFixed(1)}%)`);
console.log(`\nBaseline (umbrales originales 0.25/0.45/0.65): 46.0% exacto, 54% sub-ruteo`);
