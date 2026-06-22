// Bandit-convergence benchmark — proves the README claim "self-tuning 3-arm bandit".
//
// A single bandit run proves nothing (it could be luck). This runs the REAL
// updateBanditState() over MANY independent seeds against a synthetic environment
// with a KNOWN best arm, and reports how reliably it finds it.
//
// Division of labour (kept honest):
//   • This benchmark answers RELIABILITY — does it find the best arm, not by luck?
//     (200 seeds, cold start from the WORST arm — the hardest case.)
//   • SPEED is production's job: this stationary environment converges almost
//     immediately, which is unrealistic. The real-world convergence time (~16 days
//     of exploration before locking onto "Balanced") comes from production data,
//     where the signal is noisy and non-stationary.
//
// Environment (mirrors production, where arm 1 "Balanced" won): each night the
// active arm yields M episodes, each outcome ~ Bernoulli(p[arm]); the engine's
// reward rule takes the nightly majority. Production feeds the bandit the day's
// many interactions, so M≫1 is the faithful regime — we sweep M to show how
// reliability scales with signal strength (M=1 is a deliberately under-powered
// stress case, kept for honesty).
//   p = [0.30, 0.80, 0.55]  → arm 1 is the ground-truth best.
//
// Pre-registered gates (set BEFORE measuring):
//   G1 — production-like regime (M=12): ≥90% of runs converge to the best arm
//   G2 — graceful degradation: even with a single noisy signal/night (M=1), ≥80%
//
// Triangulation: production's final state Beta(71,10) on arm 1 is one real-world
// draw from this same distribution.
//
// Run: pnpm bench:bandit   (node --import tsx benchmarks/bandit-convergence.ts)

import { updateBanditState, type BanditState, type BanditEpisode } from '../src/index.js';

function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const P = [0.3, 0.8, 0.55] as const; // ground-truth reward prob per arm
const BEST_ARM = 1;
const NIGHTS = 60;
const SEEDS = 200;
const TAIL = 15; // tail window used to judge "converged"
const M_SWEEP = [1, 4, 8, 12] as const; // episodes (interactions) per night
const PRODUCTION_M = 12;

function freshState(): BanditState {
  return {
    activeArm: 0, // cold start from the WORST arm — the hardest case
    armsBetaParams: { '0': { alpha: 1, beta: 1 }, '1': { alpha: 1, beta: 1 }, '2': { alpha: 1, beta: 1 } },
  };
}

interface RunResult {
  converged: boolean;
  finalArm: 0 | 1 | 2;
}

function runOne(seed: number, M: number): RunResult {
  const rng = mulberry32(seed);
  let state = freshState();
  const activeByNight: (0 | 1 | 2)[] = [];

  for (let n = 0; n < NIGHTS; n++) {
    const arm = state.activeArm;
    const episodes: BanditEpisode[] = [];
    for (let i = 0; i < M; i++) episodes.push({ activeArm: arm, outcome: rng() < P[arm] });
    state = updateBanditState(episodes, state, rng);
    activeByNight.push(state.activeArm);
  }

  const tail = activeByNight.slice(-TAIL);
  const converged = tail.filter((a) => a === BEST_ARM).length / TAIL >= 0.8;
  return { converged, finalArm: activeByNight[NIGHTS - 1]! };
}

interface Agg {
  M: number;
  convergedRate: number;
  finalDist: number[];
}

function sweep(M: number): Agg {
  const results: RunResult[] = [];
  for (let s = 0; s < SEEDS; s++) results.push(runOne(s * 2654435761 + M * 40503, M));
  const conv = results.filter((r) => r.converged);
  return {
    M,
    convergedRate: conv.length / SEEDS,
    finalDist: [0, 1, 2].map((arm) => results.filter((r) => r.finalArm === arm).length),
  };
}

console.log(`\n@animakit/homeostasis — bandit-convergence benchmark (real updateBanditState)\n`);
console.log(`Environment: p = [${P.join(', ')}]  · best arm = ${BEST_ARM}  · ${NIGHTS} nights × ${SEEDS} seeds · cold start from worst arm (0)\n`);
console.log('signals/night   converged→best (last 15)   final arm dist [0,1,2]');
const aggs = M_SWEEP.map(sweep);
for (const a of aggs) {
  console.log(
    `M=${String(a.M).padStart(2)}            ${(a.convergedRate * 100).toFixed(1).padStart(6)}%                 [${a.finalDist.join(', ')}]`,
  );
}

const prod = aggs.find((a) => a.M === PRODUCTION_M)!;
const single = aggs.find((a) => a.M === 1)!;
const g1 = prod.convergedRate >= 0.9;
const g2 = single.convergedRate >= 0.8;

console.log('\n── Pre-registered gates ──');
console.log(`G1 reliability (M=${PRODUCTION_M}) : ${(prod.convergedRate * 100).toFixed(1)}% ≥ 90%  → ${g1 ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`G2 graceful  (M=1)    : ${(single.convergedRate * 100).toFixed(1)}% ≥ 80%  → ${g2 ? 'PASS ✅' : 'FAIL ❌'}`);
console.log('\nSpeed reference: production explored ~16 days before locking onto arm 1 (Balanced),');
console.log('final Beta(71,10) ≈ 0.88 — one real-world draw from this distribution.');

const allPass = g1 && g2;
console.log(`\nRESULT: ${allPass ? 'ALL GATES PASS ✅' : 'GATE FAILURE ❌'}\n`);
process.exit(allPass ? 0 : 1);
