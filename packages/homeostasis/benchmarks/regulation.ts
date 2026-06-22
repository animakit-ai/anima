// Regulation benchmark — proves the README claim:
//   "self-regulates without hard-coded rate limits / cost control through biology".
//
// Drives the REAL engine (not a re-implementation) through three phases:
//   1. baseline  — at rest, everything is accepted
//   2. flood     — adversarial failures faster than decay can compensate
//   3. recovery  — pure tick() decay, no manual intervention, no rate limit
//
// Pre-registered gates (computed from the engine constants BEFORE measuring):
//   G1 panic    — stress crosses 0.80 (panic) on the 7th consecutive failure
//   G2 shedding — in panic, trivial work is shed and high-priority work is
//                 protected: accept(0.9) ≈ 3 × accept(0.3) (the sigmoid factor
//                 cancels, so the ratio equals the priority ratio), accept(0.3) < 0.10
//   G3 recovery — decay returns stress below flow (<0.30) within ≤35 ticks
//
// Run: pnpm bench:regulation   (node --import tsx benchmarks/regulation.ts)

import { writeFileSync } from 'node:fs';
import { HomeostasisEngine, getProfile } from '../src/index.js';

// ── Deterministic RNG (so anyone re-running gets the same accept-rates) ────────
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ACCEPT_TRIALS = 1000;

function measureAccept(engine: HomeostasisEngine, priority: number): number {
  let yes = 0;
  for (let i = 0; i < ACCEPT_TRIALS; i++) {
    if (engine.evaluateTaskAcceptance(priority)) yes++;
  }
  return yes / ACCEPT_TRIALS;
}

interface Row {
  phase: string;
  step: number;
  failures: number;
  stress: number;
  dopamine: number;
  mode: string;
  acceptTrivial: number; // priority 0.3
  acceptImportant: number; // priority 0.9
}

const rows: Row[] = [];
const engine = new HomeostasisEngine({ rng: mulberry32(42) });
engine.setProfile(getProfile(1)); // Balanced — stressMult = 1.0 (production default)

// ── Phase 1 — baseline ────────────────────────────────────────────────────────
rows.push({
  phase: 'baseline',
  step: 0,
  failures: 0,
  stress: engine.stress,
  dopamine: engine.dopamine,
  mode: engine.mode,
  acceptTrivial: measureAccept(engine, 0.3),
  acceptImportant: measureAccept(engine, 0.9),
});

// ── Phase 2 — flood (adversarial failures, no decay between them) ──────────────
const FLOOD = 10;
let firstPanicAtFailure: number | null = null;
for (let f = 1; f <= FLOOD; f++) {
  engine.recordInteraction({ success: false, responseTimeMs: 90_000 });
  if (engine.mode === 'panic' && firstPanicAtFailure === null) firstPanicAtFailure = f;
  rows.push({
    phase: 'flood',
    step: f,
    failures: f,
    stress: engine.stress,
    dopamine: engine.dopamine,
    mode: engine.mode,
    acceptTrivial: measureAccept(engine, 0.3),
    acceptImportant: measureAccept(engine, 0.9),
  });
}

const peak = rows[rows.length - 1]!;

// ── Phase 3 — recovery (pure decay, no rate limit, no intervention) ────────────
let ticksToExitPanic: number | null = null;
let ticksToZen: number | null = null;
let monotonic = true;
let prev = engine.stress;
const MAX_TICKS = 120;
for (let t = 1; t <= MAX_TICKS; t++) {
  engine.tick(); // decays toward the resting set-point (0.1)
  if (engine.stress > prev + 1e-9) monotonic = false;
  prev = engine.stress;
  if (ticksToExitPanic === null && engine.mode !== 'panic') ticksToExitPanic = t;
  if (ticksToZen === null && engine.stress < 0.3) ticksToZen = t;
  rows.push({
    phase: 'recovery',
    step: t,
    failures: FLOOD,
    stress: engine.stress,
    dopamine: engine.dopamine,
    mode: engine.mode,
    acceptTrivial: measureAccept(engine, 0.3),
    acceptImportant: measureAccept(engine, 0.9),
  });
  if (engine.stress < 0.12) break;
}

// ── CSV for plotting ──────────────────────────────────────────────────────────
const header = 'phase,step,failures,stress,dopamine,mode,accept_trivial,accept_important';
const csv = [
  header,
  ...rows.map(
    (r) =>
      `${r.phase},${r.step},${r.failures},${r.stress.toFixed(4)},${r.dopamine.toFixed(4)},` +
      `${r.mode},${r.acceptTrivial.toFixed(4)},${r.acceptImportant.toFixed(4)}`,
  ),
].join('\n');
writeFileSync(new URL('./regulation.csv', import.meta.url), csv);

// ── Report ────────────────────────────────────────────────────────────────────
console.log('\n@animakit/homeostasis — regulation benchmark (real engine, Balanced profile)\n');
console.log('Phase / failures →  stress  mode    accept(0.3)  accept(0.9)');
for (const r of rows) {
  if (r.phase === 'recovery' && r.step % 5 !== 0 && r.stress >= 0.12) continue; // thin recovery rows
  const tag = r.phase === 'flood' ? `flood  #${r.failures}` : r.phase === 'recovery' ? `recov  t${r.step}` : 'baseline ';
  console.log(
    `${tag.padEnd(12)}  ${r.stress.toFixed(3).padStart(6)}  ${r.mode.padEnd(6)}  ` +
      `${(r.acceptTrivial * 100).toFixed(1).padStart(7)}%    ${(r.acceptImportant * 100).toFixed(1).padStart(7)}%`,
  );
}

// ── Pre-registered gates ──────────────────────────────────────────────────────
const base = rows[0]!;
const ratio = peak.acceptTrivial > 0 ? peak.acceptImportant / peak.acceptTrivial : Infinity;

const g1 = firstPanicAtFailure !== null && firstPanicAtFailure >= 7 && firstPanicAtFailure <= 8 && peak.stress >= 0.8;
const g2 =
  base.acceptTrivial === 1 &&
  base.acceptImportant === 1 &&
  peak.acceptImportant > peak.acceptTrivial &&
  peak.acceptTrivial < 0.1 &&
  ratio >= 2.4 &&
  ratio <= 3.6;
const g3 = ticksToZen !== null && ticksToZen <= 35 && monotonic;

console.log('\n── Pre-registered gates ──');
console.log(`G1 panic     : panic at failure #${firstPanicAtFailure} (pred 7), peak stress ${peak.stress.toFixed(2)}  → ${g1 ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(
  `G2 shedding  : peak accept trivial ${(peak.acceptTrivial * 100).toFixed(1)}% vs important ${(peak.acceptImportant * 100).toFixed(1)}% (ratio ${ratio.toFixed(2)}, pred ~3.0)  → ${g2 ? 'PASS ✅' : 'FAIL ❌'}`,
);
console.log(`G3 recovery  : exit panic in ${ticksToExitPanic} ticks, back to zen in ${ticksToZen} ticks (pred ~30), monotonic=${monotonic}  → ${g3 ? 'PASS ✅' : 'FAIL ❌'}`);

const allPass = g1 && g2 && g3;
console.log(`\nRESULT: ${allPass ? 'ALL GATES PASS ✅' : 'GATE FAILURE ❌'}  ·  trajectory → benchmarks/regulation.csv\n`);
process.exit(allPass ? 0 : 1);
