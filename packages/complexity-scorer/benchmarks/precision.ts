// Precision validation: scorer tiers vs blind human labels (SPEC §6).
// Run: npx tsx benchmarks/precision.ts <labeled.csv>

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScorer, presets, type ComplexityTier } from '../src/index.js';

// Minimal RFC-4180 CSV parser (quoted fields, embedded commas/newlines)
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
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
const tierIdx = (t: ComplexityTier) => TIERS.indexOf(t);

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? join(here, 'data', 'raw', 'labeled.csv');
const raw = readFileSync(file, 'utf-8').replace(/^﻿/, '');
const rows = parseCsv(raw);
const header = rows[0]!.map((h) => h.trim().toLowerCase());
const iTier = header.indexOf('tier_humano');
const iMsg = header.indexOf('mensaje');

const samples = rows.slice(1)
  .map((r) => ({ human: r[iTier]?.trim().toLowerCase() as ComplexityTier, msg: r[iMsg] ?? '' }))
  .filter((s) => TIERS.includes(s.human) && s.msg.length > 0);

console.log(`\nMuestras etiquetadas válidas: ${samples.length}\n`);

function evaluate(name: string, score: (m: string) => { tier: ComplexityTier }) {
  let exact = 0;
  let adjacent = 0;
  let under = 0; // scorer dice MENOS que humano → riesgo de calidad
  let over = 0;  // scorer dice MÁS → riesgo de costo
  const confusion = new Map<string, number>();
  for (const s of samples) {
    const pred = score(s.msg).tier;
    const d = tierIdx(pred) - tierIdx(s.human);
    if (d === 0) exact++;
    if (Math.abs(d) <= 1) adjacent++;
    if (d < 0) under++;
    if (d > 0) over++;
    const key = `${s.human}→${pred}`;
    confusion.set(key, (confusion.get(key) ?? 0) + 1);
  }
  const pct = (n: number) => `${((n / samples.length) * 100).toFixed(1)}%`;
  console.log(`── ${name} ──`);
  console.log(`  exacto: ${exact}/${samples.length} (${pct(exact)})  |  ±1 tier: ${adjacent}/${samples.length} (${pct(adjacent)})`);
  console.log(`  sub-ruteo (riesgo calidad): ${under} (${pct(under)})  |  sobre-ruteo (riesgo costo): ${over} (${pct(over)})`);
  console.log(`  matriz (humano→scorer):`);
  for (const h of TIERS) {
    const cells = TIERS.map((p) => String(confusion.get(`${h}→${p}`) ?? 0).padStart(4)).join('');
    const total = TIERS.reduce((a, p) => a + (confusion.get(`${h}→${p}`) ?? 0), 0);
    if (total > 0) console.log(`    ${h.padEnd(7)}${cells}   (n=${total})`);
  }
  console.log(`           ${TIERS.map((t) => t.slice(0, 4).padStart(4)).join('')}\n`);
}

evaluate('word matching (default 0.1.0)', createScorer());
evaluate('legacy animaProduction', createScorer(presets.animaProduction));

// Distribución de etiquetas humanas
const humanDist = new Map<string, number>();
for (const s of samples) humanDist.set(s.human, (humanDist.get(s.human) ?? 0) + 1);
console.log('Distribución de etiquetas humanas:', Object.fromEntries(humanDist));
