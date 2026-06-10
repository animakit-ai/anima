// Replay benchmark over the real production corpus (daily_logs export).
//
// Input:  benchmarks/data/raw/daily_logs.json  (gitignored — never committed)
//         Array of rows: { user_message, created_at, routing_mode, agent_used, ... }
// Output: Table 2 (tier distribution), legacy-vs-word shift, Table 3 (cost simulation)
//
// Run: npx tsx benchmarks/replay.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScorer, presets, type ComplexityTier } from '../src/index.js';

interface LogRow {
  user_message: string | null;
  created_at: string;
  routing_mode: string | null;
  agent_used: string | null;
}

// ── Corpus cleaning ──────────────────────────────────────────────────────────
// The raw export mixes human messages with system-generated rows and
// pipeline-retry duplicates. Cleaning rules (documented in SPEC §6):
//  1. drop null/empty messages
//  2. drop system rows: [META INTERNA...], [SISTEMA...], "Ciclo de sueño:",
//     and rows whose agent is wakeup/sleep_cycle/architect_implant
//  3. collapse retry duplicates: identical message within the same hour → keep first

const SYSTEM_PREFIXES = ['[META INTERNA', '[SISTEMA', 'Ciclo de sueño:'];
const SYSTEM_AGENTS = new Set(['wakeup', 'sleep_cycle', 'architect_implant']);

export function cleanCorpus(rows: LogRow[]): { messages: string[]; dropped: Record<string, number> } {
  const dropped = { empty: 0, system: 0, retryDuplicate: 0 };
  const seen = new Map<string, string>(); // message → hour bucket of first occurrence
  const messages: string[] = [];

  for (const row of rows) {
    const msg = row.user_message?.trim();
    if (!msg) { dropped.empty++; continue; }
    if (SYSTEM_PREFIXES.some((p) => msg.startsWith(p)) || SYSTEM_AGENTS.has(row.agent_used ?? '')) {
      dropped.system++;
      continue;
    }
    const hour = row.created_at.slice(0, 13);
    const prevHour = seen.get(msg);
    if (prevHour !== undefined && prevHour === hour) { dropped.retryDuplicate++; continue; }
    seen.set(msg, hour);
    messages.push(msg);
  }
  return { messages, dropped };
}

// ── Cost model (June 2026 pricing, per 1M tokens; CLEARLY MARKED estimates) ──
// Token estimate: Spanish ≈ 1 token / 3.5 chars. Output assumed 2x input.

const PRICE_PER_M_INPUT: Record<string, number> = {
  'ollama-local': 0, //          local qwen3 — $0
  'deepseek-chat': 0.27, //      published
  'claude-fable-5': 10, //       published (June 2026)
  'claude-mythos-5': 30, //      ESTIMATE — update with published pricing before README
};
const OUTPUT_MULT: Record<string, number> = {
  'ollama-local': 0,
  'deepseek-chat': 1.1 / 0.27,
  'claude-fable-5': 50 / 10,
  'claude-mythos-5': 5, //       ESTIMATE
};

const TIER_MODEL: Record<ComplexityTier, string> = {
  micro: 'ollama-local',
  small: 'deepseek-chat',
  medium: 'claude-fable-5',
  large: 'claude-mythos-5',
};

function costOf(model: string, inputTokens: number): number {
  const inPrice = PRICE_PER_M_INPUT[model]!;
  const outTokens = inputTokens * 2;
  return (inputTokens * inPrice + outTokens * inPrice * (OUTPUT_MULT[model] ?? 1)) / 1_000_000;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = join(here, 'data', 'raw', 'daily_logs.json');

let rows: LogRow[];
try {
  rows = JSON.parse(readFileSync(dataPath, 'utf-8')) as LogRow[];
} catch {
  console.error(`\nNo corpus found at ${dataPath}`);
  console.error('Save the full daily_logs export there (see SPEC §6) and re-run.\n');
  process.exit(1);
}

const { messages, dropped } = cleanCorpus(rows);
console.log(`\n@animakit/complexity-scorer — production corpus replay`);
console.log(`raw rows: ${rows.length} | clean human messages: ${messages.length}`);
console.log(`dropped → system: ${dropped.system}, retry-dupes: ${dropped.retryDuplicate}, empty: ${dropped.empty}\n`);

const word = createScorer(); // bilingual, word matching (the package default)
const legacy = createScorer(presets.animaProduction); // production verbatim

// Table 2 — tier distribution
const dist = { word: new Map<ComplexityTier, number>(), legacy: new Map<ComplexityTier, number>() };
let shifted = 0;
const shifts = new Map<string, number>();

for (const msg of messages) {
  const w = word(msg).tier;
  const l = legacy(msg).tier;
  dist.word.set(w, (dist.word.get(w) ?? 0) + 1);
  dist.legacy.set(l, (dist.legacy.get(l) ?? 0) + 1);
  if (w !== l) {
    shifted++;
    const key = `${l}→${w}`;
    shifts.set(key, (shifts.get(key) ?? 0) + 1);
  }
}

const TIERS: ComplexityTier[] = ['micro', 'small', 'medium', 'large'];
const pct = (n: number) => `${((n / messages.length) * 100).toFixed(1)}%`;

console.log('── Table 2: tier distribution ──────────────────────────────');
console.log(`tier     legacy(prod)   word(default)`);
for (const t of TIERS) {
  const l = dist.legacy.get(t) ?? 0;
  const w = dist.word.get(t) ?? 0;
  console.log(`${t.padEnd(8)} ${String(l).padStart(4)} ${pct(l).padStart(7)}   ${String(w).padStart(4)} ${pct(w).padStart(7)}`);
}
console.log(`\nlegacy-vs-word tier shifts: ${shifted}/${messages.length} (${pct(shifted)})`);
for (const [k, v] of [...shifts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}

// Table 3 — cost simulation
let tieredCost = 0;
let naiveCost = 0;
for (const msg of messages) {
  const tokens = Math.ceil(msg.length / 3.5);
  tieredCost += costOf(TIER_MODEL[word(msg).tier], tokens);
  naiveCost += costOf('claude-mythos-5', tokens);
}

console.log('\n── Table 3: cost simulation (input+output, est. tokens = chars/3.5) ──');
console.log(`naive  (all → Mythos 5):        $${naiveCost.toFixed(4)}`);
console.log(`tiered (scorer routing):        $${tieredCost.toFixed(4)}`);
console.log(`savings: ${(100 * (1 - tieredCost / naiveCost)).toFixed(1)}%`);
console.log('\n⚠ Mythos 5 pricing is an ESTIMATE — replace with published pricing before README.\n');
