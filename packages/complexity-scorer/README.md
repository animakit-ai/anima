# @animakit/complexity-scorer

> **Classify LLM tasks in <1ms with zero tokens — before you ever call an LLM.**

Five weighted lexical signals → a complexity tier (`micro | small | medium | large`), so your caller decides which model handles each message. Pure functions, zero dependencies, zero I/O. Extracted from the production router of [ANIMA](https://github.com/animakit-ai/anima) — an agent that has been running a real business since February 2026.

```bash
npm install @animakit/complexity-scorer
```

```ts
import { scoreComplexity } from '@animakit/complexity-scorer';

const { tier, score, signals } = scoreComplexity(
  'Analyze the impact of raising prices on churn and MRR under three scenarios',
);
// tier: 'medium' — route to a frontier model
// signals: { length, domain, structure, reasoning, contextRequired } — fully explainable

scoreComplexity('thanks, perfect!').tier; // 'micro' — local model, $0
```

## Why

Most agent frameworks send every message to the same (expensive) model, or spend 200-500 tokens asking an LLM "how hard is this?". On our real production traffic, **85% of messages never needed a frontier model**:

| tier | share of real production traffic (353 human messages) |
|---|---|
| micro | 84.7% |
| small | 4.2% |
| medium | 10.2% |
| large | 0.8% |

Simulated routing cost on that corpus vs sending everything to a frontier model: **~99% cheaper** (local model for micro at $0; exact savings depend on your model prices — reproduce with `benchmarks/replay.ts` on your own traffic).

## Latency

10k iterations over a mixed corpus (Node 24, consumer CPU):

| path | p50 | p95 | p99 |
|---|---|---|---|
| `createScorer()` precompiled (hot path) | 9.4µs | 63.6µs | **86µs** |
| `scoreComplexity()` default singleton | 10.0µs | 63.1µs | 100.1µs |

Release gate: p99 < 1ms — currently passing with 11x margin. A performance regression blocks release (`benchmarks/latency.ts` runs in CI).

## Validated against human judgment — including what it gets wrong

We blind-labeled 50 production messages (the operator who ran the agent for 53 sprints labeled which model tier each message *actually needed*). Results with the default thresholds, leave-one-out cross-validated:

- **52% exact tier agreement, 82% within one tier**
- Errors are asymmetric by design: 38% under-routing vs 4% over-routing after calibration (the original production thresholds under-routed 54% — the calibration data ships in `benchmarks/`)

**The honest part:** the residual failure mode is *short, context-dependent messages* — "so what should the priority be?" needs real reasoning but contains zero lexical complexity markers. **No lexical scorer can see those by definition.** If your traffic is heavy on terse high-stakes questions, pair this scorer with behavioral feedback (that's what we're building next — see the [conformal routing work](https://github.com/animakit-ai/anima/tree/main/experiments/conformal-routing)).

## API

```ts
// One-off (default bilingual EN+ES config)
scoreComplexity(message: string, config?: ComplexityScorerConfig): ComplexityResult;

// Hot path — precompiles vocabulary once
const score = createScorer(config);
score(message); // ~10µs

interface ComplexityResult {
  score: number;                       // 0-1 weighted composite
  signals: ComplexitySignals;          // the 5 sub-signals — explain every decision
  tier: 'micro' | 'small' | 'medium' | 'large';
}
```

Everything is configurable: signal `weights` (validated to sum to 1), `tierThresholds`, saturation, length curve, and the vocabulary itself:

```ts
const score = createScorer({
  language: 'en', // 'es' | 'bilingual' (default)
  vocabulary: {
    domainKeywords: { extend: ['kubernetes-operator', 'sharding'] }, // add your jargon
  },
});
```

`extend` adds to the base vocabulary; `replace` substitutes it — discourse connectors and reasoning patterns are universal, your domain terms are not.

### Matching modes

Default is `matching: 'word'`: whole-word, diacritic-insensitive (`"retencion"` without the accent still matches `'retención'`; `'rut'` does **not** fire inside `"rutina"`). The original production scorer used substring matching — preserved as `matching: 'substring'` for exact replication.

### `presets.animaProduction`

The **exact** configuration that runs in ANIMA's production agent — Colombian tax/legal terminology, business/SaaS vocabulary, Spanish, legacy matching, original thresholds. Use it as a reference for building your own domain vocabulary:

```ts
import { createScorer, presets } from '@animakit/complexity-scorer';
const score = createScorer(presets.animaProduction);
```

## What this is NOT

- Not a model selector — it returns a tier; mapping tier → model is your call (we map micro→local Ollama, small→DeepSeek, medium→Claude Fable 5, large→Claude Mythos 5).
- Not an LLM router with learned weights — deterministic and static by design; same input, same output, every time, explainable via `signals`.
- Not async, no I/O, no network — ever.

## Benchmarks are reproducible

Every number above comes from a script in [`benchmarks/`](./benchmarks): `latency.ts`, `replay.ts` (run it on your own message log), `precision.ts` (validate against your own labels), `calibrate-thresholds.ts` (fit thresholds to your traffic with LOO CV). If a claim isn't reproducible, we don't ship it.

## Part of ANIMA

**A**gentic **N**euro-**I**nspired **M**emory **A**rchitecture — battle-tested cognitive architecture for LLM agents, extracted from 53 sprints in production. This is package 1 of 14. Next: `@animakit/homeostasis`, `@animakit/git-guardrails`.

## License

MIT © Justine Serna Aza
