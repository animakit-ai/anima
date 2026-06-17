// Latency benchmark — the README claim is "<1µs core ops"; the release gate is
// p99 < 1ms for every operation (Table 1, SPEC §6).
// Run: pnpm bench (from package dir)

import {
  HomeostasisEngine,
  computeAllostaticTarget,
  computeEmotionalState,
  updateBanditState,
  AppraisalEngine,
  predictLoad,
  presets,
  type BanditState,
  type HistoryRecord,
} from '../src/index.js';

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function bench(name: string, fn: () => unknown, iterations = 100_000): void {
  for (let i = 0; i < 2_000; i++) fn(); // warmup (JIT)

  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);

  const p50 = percentile(times, 50);
  const p95 = percentile(times, 95);
  const p99 = percentile(times, 99);
  const gate = p99 < 1.0 ? 'PASS ✅' : 'FAIL ❌';

  console.log(
    `${name.padEnd(34)} p50=${(p50 * 1000).toFixed(2)}µs  p95=${(p95 * 1000).toFixed(2)}µs  ` +
      `p99=${(p99 * 1000).toFixed(2)}µs  | gate p99<1ms: ${gate}`,
  );
}

console.log('\n@animakit/homeostasis — latency benchmark (100k iterations)\n');

const engine = new HomeostasisEngine({ somaticBias: presets.animaProductionRoles });
bench('engine.addStress()', () => engine.addStress(0.001));
bench('engine.tick()', () => engine.tick(0.2));
bench('engine.evaluateTaskAcceptance()', () => engine.evaluateTaskAcceptance(0.5));
bench('engine.getSomaticBias()', () => engine.getSomaticBias());
bench('engine.emotionalState (getter)', () => engine.emotionalState);

bench('computeAllostaticTarget()', () =>
  computeAllostaticTarget({ fepMode: 'active', kappa: 0.5, ceScore: 0.5, recentIgnitions: 1, hourLocal: 10 }),
);
bench('computeEmotionalState()', () => computeEmotionalState(0.4, 0.6));

const appraisal = new AppraisalEngine();
bench('AppraisalEngine.evaluate()', () =>
  appraisal.evaluate('necesito una estrategia de ventas para el producto', { goals: ['ventas'] }),
);

const banditState: BanditState = {
  activeArm: 1,
  armsBetaParams: { '0': { alpha: 4, beta: 2 }, '1': { alpha: 6, beta: 3 }, '2': { alpha: 2, beta: 5 } },
};
bench('updateBanditState()', () =>
  updateBanditState([{ activeArm: 1, outcome: true }], banditState),
);

const history: HistoryRecord[] = Array.from({ length: 1000 }, (_, i) => ({
  timestamp: new Date(Date.UTC(2026, 5, 1 + (i % 30), i % 24, 0, 0)).toISOString(),
  stress: 0.1 + (i % 9) * 0.1,
  reactive: i % 2 === 0,
}));
bench('predictLoad() (1k records)', () => predictLoad(history, { utcOffsetHours: -5 }), 10_000);

console.log('');
