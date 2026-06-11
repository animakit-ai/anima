// Diagnostic: score distribution per human tier — is there separation the
// thresholds could exploit, or is the failure structural?
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
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
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

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? join(here, 'data', 'raw', 'labeled.csv');
const rows = parseCsv(readFileSync(file, 'utf-8').replace(/^﻿/, ''));

const score = createScorer();
const byTier: Record<string, number[]> = { micro: [], small: [], medium: [], large: [] };
for (const r of rows.slice(1)) {
  const t = (r[1] ?? '').trim().toLowerCase();
  const m = r[2] ?? '';
  if (t in byTier && m) byTier[t]!.push(score(m).score);
}

console.log('\nDistribución de SCORES del scorer por tier HUMANO:\n');
for (const [t, scores] of Object.entries(byTier)) {
  if (scores.length === 0) continue;
  scores.sort((a, b) => a - b);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(
    `${t.padEnd(7)} n=${String(scores.length).padEnd(3)} media=${mean.toFixed(3)} ` +
    `min=${scores[0]!.toFixed(3)} p50=${scores[Math.floor(scores.length / 2)]!.toFixed(3)} max=${scores[scores.length - 1]!.toFixed(3)}`,
  );
}
console.log('\nUmbrales actuales: micro<0.25, small<0.45, medium<0.65');
