// Latency benchmark — the README claim is "<1ms"; the release gate is p99 < 1ms.
// Run: pnpm bench (from package dir)
//
// Uses a synthetic corpus spanning all tiers until the real anonymized
// production sample (daily_logs replay) is wired in — see SPEC.md §6.

import { createScorer, presets, scoreComplexity } from '../src/index.js';

const CORPUS: string[] = [
  'hola',
  'ok dale',
  '¿qué hora es?',
  'gracias, perfecto',
  'recuérdame llamar al banco mañana',
  'what time is it in Bogotá?',
  '¿cómo va el RUT de la empresa? necesito la retención al día',
  'deploy the new endpoint and check the database latency',
  'explícame por qué el sistema falla cuando hay mucha latencia en la api',
  'analyze the impact of churn on MRR because we need to decide pricing',
  'Necesito que analices la estrategia de posicionamiento frente a la competencia, dado que el mercado cambió. Sin embargo, antes quiero entender qué factores afectan nuestra propuesta de valor.',
  'I need a full analysis of our market positioning strategy given that the landscape changed. However, first I want to understand what factors affect our value proposition and the impact on churn.',
  'Como te decía, siguiendo con lo anterior: ¿cuál sería el impacto en el flujo de caja si refinanciamos la deuda? Explica por qué cada escenario es viable, qué pasaría si la conversión cae, y analiza la sensibilidad del EBITDA. Además considera la valoración, la inversión pendiente y el financiamiento del capital de trabajo. Por otro lado, en consecuencia de lo dicho, evalúa el riesgo regulatorio y la obligación tributaria del régimen actual.',
  'x'.repeat(2000),
];

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function bench(name: string, fn: (msg: string) => unknown, iterations = 10_000): void {
  // Warmup (JIT)
  for (let i = 0; i < 1_000; i++) fn(CORPUS[i % CORPUS.length]!);

  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const msg = CORPUS[i % CORPUS.length]!;
    const t0 = performance.now();
    fn(msg);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);

  const p50 = percentile(times, 50);
  const p95 = percentile(times, 95);
  const p99 = percentile(times, 99);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const gate = p99 < 1.0 ? 'PASS ✅' : 'FAIL ❌';

  console.log(
    `${name.padEnd(38)} p50=${(p50 * 1000).toFixed(1)}µs  p95=${(p95 * 1000).toFixed(1)}µs  ` +
      `p99=${(p99 * 1000).toFixed(1)}µs  mean=${(mean * 1000).toFixed(1)}µs  | gate p99<1ms: ${gate}`,
  );
}

console.log(`\n@animakit/complexity-scorer — latency benchmark (${CORPUS.length}-msg corpus, 10k iterations)\n`);

const precompiledBilingual = createScorer();
const precompiledAnima = createScorer(presets.animaProduction);

bench('createScorer() bilingual (precompiled)', precompiledBilingual);
bench('createScorer() animaProduction legacy', precompiledAnima);
bench('scoreComplexity() default singleton', (m) => scoreComplexity(m));
bench('scoreComplexity(msg, config) cold path', (m) => scoreComplexity(m, { language: 'en' }), 2_000);

console.log('\nNote: the cold path recompiles vocabulary per call — use createScorer() on hot paths.\n');
